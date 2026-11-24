// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import type { DeviceTargetPayload } from './device-target.js';
import type { TargetConfigRecord } from './target-config-store.js';
import { mergeTargetPayload } from './target-resolution.js';

/**
 * The effective result of resolving a target id through its derivation chain.
 *
 * ``payload`` is the fully merged plain payload (id-normalized to ``targetId``);
 * ``buildBaseId`` is the terminal id of the chain — the id whose
 * ``compile_target_mappings.json`` rule a firmware build actually uses — or
 * ``null`` when the chain ends at an id with no such rule.
 */
export interface EffectiveTarget {
    targetId: string;
    payload: DeviceTargetPayload;
    buildBaseId: string | null;
    chain: string[];
}

/** One shipped target registration: its catalog id and its raw file payload. */
export interface ShippedTargetEntry {
    id: string;
    payload: DeviceTargetPayload;
}

type CodedError = Error & { code?: string };

function codedError(code: string, message: string): CodedError {
    const error = new Error(message) as CodedError;
    error.code = code;
    return error;
}

function asString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

const MAX_CHAIN_DEPTH = 8;

/**
 * Resolve target ids to effective payloads and a terminal build base id.
 *
 * One shared authority for the derivation chain (shipped and user hops): the
 * merge semantics live in :func:`mergeTargetPayload`, and this class owns the
 * chain walk, the identity injection, and the chain guards. ``buildBaseId`` is
 * the terminal id without a base; every id in the chain must resolve to a
 * shipped target except a user leaf, whose base must be shipped (M4w rule).
 */
export class TargetResolver {
    #shippedById = new Map<string, DeviceTargetPayload>();
    #shippedOrder: string[] = [];
    #userById = new Map<string, TargetConfigRecord>();

    /**
     * Replace the shipped targets this resolver knows about.
     *
     * @param entries Shipped targets in catalog order.
     */
    setShippedTargets(entries: ShippedTargetEntry[]): void {
        this.#shippedById.clear();
        this.#shippedOrder = [];
        for (const entry of entries) {
            if (!entry || !entry.id) {
                continue;
            }
            this.#shippedById.set(entry.id, entry.payload ?? {});
            this.#shippedOrder.push(entry.id);
        }
    }

    /**
     * Replace the derived user-target records this resolver knows about.
     *
     * @param records User target records keyed by id.
     */
    setUserTargets(records: TargetConfigRecord[]): void {
        this.#userById.clear();
        for (const record of records) {
            if (record && record.id) {
                this.#userById.set(record.id, record);
            }
        }
    }

    /**
     * Return whether *targetId* names a shipped target.
     */
    hasShipped(targetId: string): boolean {
        return this.#shippedById.has(targetId);
    }

    /**
     * Resolve *targetId* to an effective payload plus its build base id.
     *
     * An unknown leaf id answers ``null``; a broken chain (unknown base, cycle,
     * excessive depth, duplicate ``openPins``) raises a coded error so a data
     * authoring mistake is visible instead of silently degrading to an empty
     * target.
     */
    resolve(targetId: string): EffectiveTarget | null {
        if (!targetId) {
            return null;
        }

        const chain = this.#walkChain(targetId);
        if (chain === null) {
            return null;
        }

        const buildBaseId = chain[chain.length - 1];
        const terminal = this.#shippedById.get(buildBaseId);
        if (!terminal) {
            throw codedError(
                'ERR_TARGET_BASE_UNKNOWN',
                `Target config base '${buildBaseId}' is not a shipped target.`
            );
        }

        let merged: Record<string, unknown> = { ...terminal };
        let openPinsSeen = terminal.openPins != null;

        // Fold leaf-ward: each non-terminal hop contributes its sparse targetData.
        for (let index = chain.length - 2; index >= 0; index -= 1) {
            const id = chain[index];
            const overrides = this.#overrideFor(id);
            if (!overrides) {
                continue;
            }
            merged = mergeTargetPayload(merged as DeviceTargetPayload, overrides) as Record<
                string,
                unknown
            >;
            if (merged.openPins != null) {
                if (openPinsSeen) {
                    throw codedError(
                        'ERR_TARGET_OPEN_PINS_OVERRIDE',
                        `Target chain declares openPins more than once ('${id}').`
                    );
                }
                openPinsSeen = true;
            }
        }

        const leaf = chain[0];
        merged = { ...merged, id: leaf, targetId: leaf };
        this.#applyLeafIdentity(leaf, merged);

        return {
            targetId: leaf,
            payload: merged as DeviceTargetPayload,
            buildBaseId,
            chain,
        };
    }

    /**
     * Return the terminal build base id for *targetId*, or ``null``.
     *
     * Broken chains (cycle, unknown base, excessive depth) also answer ``null``
     * here, so a buildability check never throws.
     */
    resolveBuildBaseId(targetId: string): string | null {
        if (!targetId) {
            return null;
        }
        try {
            const resolved = this.resolve(targetId);
            return resolved ? resolved.buildBaseId : null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve every registered target (shipped first, then user), dedup by id.
     *
     * A target whose chain cannot be resolved is skipped, so the list never
     * contains a half-resolved entry.
     */
    listEffective(): EffectiveTarget[] {
        const result: EffectiveTarget[] = [];
        const seen = new Set<string>();
        const push = (id: string): void => {
            if (seen.has(id)) {
                return;
            }
            const effective = this.resolve(id);
            if (effective) {
                seen.add(id);
                result.push(effective);
            }
        };
        for (const id of this.#shippedOrder) {
            push(id);
        }
        for (const id of this.#userById.keys()) {
            push(id);
        }
        return result;
    }

    /**
     * Walk the ``baseTargetId`` chain leaf → terminal base.
     *
     * Returns ``null`` when the leaf id is unknown; raises for a cycle, an
     * unknown base, or excessive depth.
     */
    #walkChain(targetId: string): string[] | null {
        const chain: string[] = [];
        const visited = new Set<string>();
        let current = targetId;

        while (true) {
            const isLeaf = chain.length === 0;
            if (!this.#shippedById.has(current) && !this.#userById.has(current)) {
                if (isLeaf) {
                    return null;
                }
                throw codedError(
                    'ERR_TARGET_BASE_UNKNOWN',
                    `Target config base '${current}' is not a shipped target.`
                );
            }
            if (visited.has(current)) {
                throw codedError(
                    'ERR_TARGET_CYCLE',
                    `Target config chain contains a cycle at '${current}'.`
                );
            }
            visited.add(current);
            chain.push(current);
            if (chain.length > MAX_CHAIN_DEPTH) {
                throw codedError(
                    'ERR_TARGET_CHAIN_LIMIT',
                    `Target config chain exceeds ${MAX_CHAIN_DEPTH} hops.`
                );
            }

            const baseId = this.#baseOf(current);
            if (!baseId) {
                return chain;
            }
            current = baseId;
        }
    }

    #baseOf(id: string): string | null {
        const shipped = this.#shippedById.get(id);
        const shippedBase = asString(shipped?.baseTargetId);
        if (shippedBase) {
            return shippedBase;
        }
        const user = this.#userById.get(id);
        return user?.baseTargetId ? user.baseTargetId : null;
    }

    #overrideFor(id: string): Record<string, unknown> | null {
        const shipped = this.#shippedById.get(id);
        const shippedTargetData = asRecord(shipped?.targetData);
        if (shippedTargetData) {
            return shippedTargetData;
        }
        const user = this.#userById.get(id);
        return asRecord(user?.targetData);
    }

    #applyLeafIdentity(leaf: string, merged: Record<string, unknown>): void {
        const shipped = this.#shippedById.get(leaf);
        if (shipped) {
            if (asString(shipped.displayName) !== null) {
                merged.displayName = asString(shipped.displayName);
            }
            if (asString(shipped.description) !== null) {
                merged.description = asString(shipped.description);
            }
            return;
        }
        const user = this.#userById.get(leaf);
        if (user?.displayName) {
            merged.displayName = user.displayName;
        }
    }
}

export default TargetResolver;

