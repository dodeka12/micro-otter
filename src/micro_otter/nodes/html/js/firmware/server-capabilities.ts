// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Client for ``GET /api/server-capabilities``.
 *
 * This module is the only place the capability payload is decoded. The view reads
 * a typed snapshot and never re-parses the wire shape, so the server can add keys
 * without touching the UI (the documented forward-compatibility rule).
 *
 * The payload shape mirrors ``micro_otter.tools.server_capabilities`` exactly; see
 * ``docs/dev/firmware-compile/server-firmware-api.md``.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Capability endpoint served by the local backend. */
export const SERVER_CAPABILITIES_URL = '/api/server-capabilities';

/** How long one probe may wait before the store reports ``unreachable``. */
export const CAPABILITY_TIMEOUT_MS = 2000;

/** How long a snapshot is considered fresh before a user action refreshes it. */
export const CAPABILITY_TTL_MS = 30_000;

/** Known firmware feature ids (unknown ids are kept verbatim for forward compat). */
export type FirmwareFeatureId =
    | 'firmware-compile'
    | 'firmware-deploy'
    | 'local-package-scan'
    | 'serial-bridge'
    | 'node-package-addons'
    | 'local-file-access'
    | (string & {});

/**
 * Availability snapshot of one build or flash backend, mirroring
 * ``BackendDescriptor.to_payload``.
 */
export interface FirmwareBackendDescriptor {
    id: string;
    available: boolean;
    version: string | null;
    reason: string | null;
    targets: string[];
}

/** The seven documented capability keys. Unknown keys are ignored by the client. */
export interface ServerCapabilities {
    serverType: string;
    version: string;
    features: string[];
    buildBackends: FirmwareBackendDescriptor[];
    flashBackends: FirmwareBackendDescriptor[];
    firmwareSources: string[];
    releaseIndexUrl: string;
}

/**
 * Why a probe produced no usable capabilities. Each value is a kebab id so it maps
 * directly to a ``notice.reason.<reason>`` locale key without a translation table.
 */
export type CapabilityUnavailableReason = 'unreachable' | 'not-micro-otter' | 'malformed';

/**
 * Result of one probe: either a usable payload or a stable reason plus optional
 * human detail. ``detail`` is the raw context (e.g. ``HTTP 500``) appended to the
 * reason line, never a full sentence.
 */
export type ServerCapabilitiesSnapshot =
    | {
          state: 'ready';
          capabilities: ServerCapabilities;
          reason: null;
          detail: null;
      }
    | {
          state: 'unavailable';
          capabilities: null;
          reason: CapabilityUnavailableReason;
          detail: string | null;
      };

interface ProbeOptions {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    signal?: AbortSignal;
}

/**
 * Probe the capability endpoint once and normalise the answer into a snapshot.
 *
 * This function never throws: every failure mode is mapped to a stable
 * ``unavailable`` reason so the view has exactly one branch to render.
 */
export async function probeServerCapabilities(
    options: ProbeOptions = {}
): Promise<ServerCapabilitiesSnapshot> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? CAPABILITY_TIMEOUT_MS;

    const controller = new AbortController();
    const abortListener = options.signal ? () => controller.abort() : null;
    if (abortListener) {
        options.signal.addEventListener('abort', abortListener, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let response: Response;
        try {
            response = await fetchImpl(SERVER_CAPABILITIES_URL, { signal: controller.signal });
        } catch {
            return { state: 'unavailable', capabilities: null, reason: 'unreachable', detail: null };
        }

        if (!response.ok) {
            return {
                state: 'unavailable',
                capabilities: null,
                reason: 'unreachable',
                detail: `HTTP ${response.status}`,
            };
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            return { state: 'unavailable', capabilities: null, reason: 'malformed', detail: null };
        }

        return normalizeCapabilitiesPayload(payload);
    } finally {
        clearTimeout(timeout);
        if (abortListener) {
            options.signal?.removeEventListener('abort', abortListener);
        }
    }
}

/**
 * Validate and normalise a raw capability payload into a snapshot.
 *
 * Exported for tests so the payload rules can be exercised without a live fetch.
 */
export function normalizeCapabilitiesPayload(payload: unknown): ServerCapabilitiesSnapshot {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { state: 'unavailable', capabilities: null, reason: 'malformed', detail: null };
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.serverType !== 'string' || record.serverType.trim() === '') {
        return { state: 'unavailable', capabilities: null, reason: 'malformed', detail: null };
    }
    if (!Array.isArray(record.features)) {
        return { state: 'unavailable', capabilities: null, reason: 'malformed', detail: null };
    }

    const serverType = record.serverType.trim();
    if (serverType !== 'micro-otter') {
        return { state: 'unavailable', capabilities: null, reason: 'not-micro-otter', detail: null };
    }

    return {
        state: 'ready',
        capabilities: {
            serverType,
            version: typeof record.version === 'string' ? record.version : 'unknown',
            features: record.features.filter((id): id is string => typeof id === 'string'),
            buildBackends: normalizeBackends(record.buildBackends),
            flashBackends: normalizeBackends(record.flashBackends),
            firmwareSources: Array.isArray(record.firmwareSources)
                ? record.firmwareSources.filter((id): id is string => typeof id === 'string')
                : [],
            releaseIndexUrl: typeof record.releaseIndexUrl === 'string' ? record.releaseIndexUrl : '',
        },
        reason: null,
        detail: null,
    };
}

/**
 * Normalise an unknown backend list into typed descriptors, dropping entries the
 * client cannot render.
 */
function normalizeBackends(value: unknown): FirmwareBackendDescriptor[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id : '',
            available: entry.available === true,
            version: typeof entry.version === 'string' ? entry.version : null,
            reason: typeof entry.reason === 'string' ? entry.reason : null,
            targets: Array.isArray(entry.targets)
                ? entry.targets.filter((id): id is string => typeof id === 'string')
                : [],
        }));
}


/**
 * Cached, single-flight capability store.
 *
 * The view is the only subscriber and owns the ``probing`` render; this store never
 * clears to ``probing`` on its own. A stale snapshot is refreshed by a user action
 * (Retry, Build, Deploy) — there is no polling.
 */
export class ServerCapabilitiesStore {
    #snapshot: ServerCapabilitiesSnapshot | null = null;
    #probedAt = 0;
    #inFlight: Promise<ServerCapabilitiesSnapshot> | null = null;
    #listeners = new Set<() => void>();

    /**
     * Return the current snapshot, or ``null`` before the first probe completes.
     */
    getSnapshot(): ServerCapabilitiesSnapshot | null {
        return this.#snapshot;
    }

    /**
     * Return whether the snapshot is missing or older than the TTL.
     */
    isStale(now = Date.now()): boolean {
        return this.#snapshot === null || now - this.#probedAt > CAPABILITY_TTL_MS;
    }

    /**
     * Probe the endpoint, sharing one in-flight request between concurrent callers.
     *
     * Without ``force`` a fresh snapshot is returned immediately. A failed re-probe
     * keeps the previous snapshot so a transient outage does not blank a working form.
     */
    async refresh(
        options: { force?: boolean; fetchImpl?: FetchLike } = {}
    ): Promise<ServerCapabilitiesSnapshot> {
        if (!options.force && !this.isStale() && this.#snapshot) {
            return this.#snapshot;
        }
        if (this.#inFlight) {
            return this.#inFlight;
        }
        this.#inFlight = probeServerCapabilities({ fetchImpl: options.fetchImpl }).finally(() => {
            this.#inFlight = null;
        });
        const next = await this.#inFlight;
        this.#apply(next);
        return next;
    }

    /**
     * Subscribe to snapshot changes. Fires only when the snapshot shape changes,
     * never on an identical re-probe. Returns an unsubscribe function.
     */
    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /**
     * Store a snapshot and notify listeners only when it actually changed.
     */
    #apply(next: ServerCapabilitiesSnapshot): void {
        const changed = !this.#snapshot || !sameSnapshot(this.#snapshot, next);
        this.#snapshot = next;
        this.#probedAt = Date.now();
        if (changed) {
            for (const listener of this.#listeners) {
                listener();
            }
        }
    }
}

/**
 * Return whether two snapshots are structurally identical.
 */
function sameSnapshot(a: ServerCapabilitiesSnapshot, b: ServerCapabilitiesSnapshot): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

