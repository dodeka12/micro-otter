// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Graph rule registry.
 *
 * One registry for every "is this graph (or collection) shaped correctly?" check —
 * singletons, forbidden combinations, topic coherence, package structure rules. Rules
 * are pure functions of a `GraphRuleContext` and report through the same
 * `NodeCapabilityIssue` pipeline as the capability and resource validators, so a
 * structure problem shows up as the familiar node badge.
 *
 * A rule declares a `scope`:
 * - `'graph'` (the default) may read `nodes` only;
 * - `'collection'` may additionally read `collectionNodes` (every node of the
 *   collection, across all graphs), but because node ids are **per graph**, the
 *   registry drops every issue a collection rule anchors outside the validated graph.
 *
 * `graphSettings` (`executionType`, `triggerName`) carries the graph-level settings so a
 * rule can check interrupt-driven graphs; it is read-only and normalised to `{}`.
*
 * This module is deliberately package-agnostic: it knows nothing about any particular
 * node package or topic scheme. The topic-specific helpers live in
 * `graph-topic-validator.ts`, which is a client of this registry.
 */

import type { NodeCapabilityIssue } from './node-capability-validator.js';

type UnknownRecord = Record<string, unknown>;

export type GraphRuleScope = 'graph' | 'collection';

export interface GraphRuleContext {
    graphId: string | null;
    nodes: Array<UnknownRecord>;
    nodeTypesByNodeId: Record<string, UnknownRecord | null | undefined>;
    /** Edges of the validated graph; structural rules may need them. */
    connections?: Array<UnknownRecord>;
    /** Every node of the collection; read-only, and only for `scope: 'collection'` rules. */
    collectionNodes?: Array<UnknownRecord>;
    /**
     * Graph-level settings, read-only. `executionType` is `'irq'` for an interrupt-driven graph
     * and `'event'` for a signal-driven graph; `triggerName` is the interrupt name such a graph
     * runs on; `signalNames` / `signalMode` / `runOnStart` are populated for `event` graphs.
     */
    graphSettings?: {
        executionType?: string;
        triggerName?: string;
        signalNames?: string[];
        signalMode?: string;
        runOnStart?: boolean;
    };
}

export interface GraphRule {
    id: string;
    /** `'graph'` (default) reads `nodes` only; `'collection'` may also read `collectionNodes`. */
    scope?: GraphRuleScope;
    run: (context: GraphRuleContext) => NodeCapabilityIssue[];
}

const rules = new Map<string, GraphRule>();

function normalizeNodeId(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

function nodeIdsIn(nodes: Array<UnknownRecord> | undefined): Set<string> {
    const ids = new Set<string>();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        const id = normalizeNodeId((node as UnknownRecord | null | undefined)?.id);
        if (id) {
            ids.add(id);
        }
    }
    return ids;
}

/**
 * Register (or replace) a graph rule.
 * @param rule - Stable id, declared scope and a pure rule function.
 */
export function registerGraphRule(rule: GraphRule): void {
    if (!rule || typeof rule !== 'object') {
        throw new TypeError('registerGraphRule requires a rule object');
    }
    if (!rule.id || typeof rule.id !== 'string') {
        throw new TypeError('registerGraphRule requires a non-empty rule id');
    }
    if (typeof rule.run !== 'function') {
        throw new TypeError('registerGraphRule requires a rule function');
    }
    rules.set(rule.id, {
        id: rule.id,
        scope: rule.scope === 'collection' ? 'collection' : 'graph',
        run: rule.run,
    });
}

/**
 * The registered rules, in registration order.
 * @returns Rules, each with a concrete `scope`.
 */
export function getGraphRules(): GraphRule[] {
    return Array.from(rules.values());
}

/**
 * Run every registered rule and merge the results.
 * @param context - Rule context built from the current graph.
 * @returns De-duplicated issues in rule-registration order.
 */
export function validateGraphRules(context: GraphRuleContext): NodeCapabilityIssue[] {
    const issues: NodeCapabilityIssue[] = [];
    const seen = new Set<string>();
    const warnedRuleIds = new Set<string>();

    // Normalise the optional context fields so a rule can read them without guarding:
    // the panel always fills them, but direct callers (and the compatibility wrappers)
    // may omit them.
    const normalizedContext: GraphRuleContext = {
        graphId: context?.graphId ?? null,
        nodes: Array.isArray(context?.nodes) ? context.nodes : [],
        nodeTypesByNodeId: context?.nodeTypesByNodeId ?? {},
        connections: Array.isArray(context?.connections) ? context.connections : [],
        collectionNodes: Array.isArray(context?.collectionNodes) ? context.collectionNodes : [],
        graphSettings: context?.graphSettings ?? {},
    };

    rules.forEach((rule, ruleId) => {
        let produced: NodeCapabilityIssue[] = [];
        try {
            produced = rule.run(normalizedContext) || [];
        } catch (error) {
            // A broken extension must never break the badge pipeline.
            console.warn(`Graph rule '${ruleId}' failed:`, error);
            return;
        }

        if (rule.scope === 'collection') {
            // Node ids are per graph (`Init` and `Graph 1` both have node `1`), so an
            // issue anchored outside the validated graph would attach a badge to an
            // unrelated node. Drop those and warn once per rule id.
            const validNodeIds = nodeIdsIn(normalizedContext.nodes);
            const filtered = produced.filter((issue) => {
                if (issue.nodeId === null || issue.nodeId === undefined) {
                    return true;
                }
                return validNodeIds.has(String(issue.nodeId));
            });
            if (filtered.length < produced.length && !warnedRuleIds.has(ruleId)) {
                warnedRuleIds.add(ruleId);
                console.warn(
                    `Collection graph rule '${ruleId}' reported issues outside the validated graph; dropped.`
                );
            }
            produced = filtered;
        }

        produced.forEach((issue) => {
            const key = [
                issue.nodeId || '',
                issue.scope,
                issue.controlId || '',
                issue.inputId || '',
                issue.message,
            ].join('|');
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            issues.push(issue);
        });
    });

    return issues;
}

/** Drop every rule. */
export function clearGraphRules(): void {
    rules.clear();
}
