// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Graph-level MQTT topic coherence checks.
 *
 * Rules are pure functions of the graph and report through the same
 * `NodeCapabilityIssue` pipeline as the capability and resource validators, so an MQTT
 * problem shows up as the familiar node badge. The registry itself is the shared
 * `core/graph-rule-registry.ts` (scope-aware, package-agnostic); this module is its MQTT
 * client — it contributes the built-in topic rules and keeps the historical
 * `registerGraphTopicRule()` / `globalThis.GraphTopicRules` entry points working as thin
 * wrappers over the shared registry.
 */

import type { NodeCapabilityIssue } from './node-capability-validator.js';
import { bareNodeTypeId, effectiveTopicValue } from '../nodes/graph-topics.js';
import {
    clearGraphRules,
    getGraphRules,
    registerGraphRule,
    validateGraphRules,
} from './graph-rule-registry.js';
import type { GraphRuleContext } from './graph-rule-registry.js';

type UnknownRecord = Record<string, unknown>;

export type GraphTopicRuleContext = GraphRuleContext;

export type GraphTopicRule = (context: GraphTopicRuleContext) => NodeCapabilityIssue[];

export interface GraphTopicBinding {
    nodeId: string;
    controlId: string;
    topic: string;
}

export interface GraphTopicNodeInfo {
    nodeId: string;
    nodeType: string;
    controlValues: UnknownRecord;
    topics: Record<string, string>;
    retain: boolean | null;
    willPayload: string | null;
}

export interface GraphTopicBindings {
    nodes: GraphTopicNodeInfo[];
    publishers: GraphTopicBinding[];
    subscribers: GraphTopicBinding[];
}

/** Topic control ids together with the free-text control that holds a typed topic. */
const TOPIC_CONTROL_IDS = [
    'topic',
    'willTopic',
    'announceTopic',
    'triggerTopic',
    'stateTopic',
    'commandTopic',
];


interface NodeTopicRoles {
    publish: string[];
    subscribe: string[];
}

const NODE_TOPIC_ROLES: Record<string, NodeTopicRoles> = {
    'mqtt-read': { publish: [], subscribe: ['topic'] },
    'mqtt-write': { publish: ['topic'], subscribe: [] },
    'mqtt-will': { publish: [], subscribe: [] },
    'mqtt-announce': { publish: ['announceTopic'], subscribe: ['triggerTopic'] },
};

const HASS_NODE_TOPIC_ROLES: NodeTopicRoles = {
    publish: ['stateTopic'],
    subscribe: ['commandTopic'],
};

function topicRolesFor(nodeType: string): NodeTopicRoles {
    const bare = bareNodeTypeId(nodeType);
    if (NODE_TOPIC_ROLES[bare]) {
        return NODE_TOPIC_ROLES[bare];
    }
    if (bare.startsWith('hass-')) {
        return HASS_NODE_TOPIC_ROLES;
    }
    return { publish: [], subscribe: ['topic'] };
}

const NODE_KIND_LABELS: Record<string, string> = {
    'mqtt-read': 'MQTT Read',
    'mqtt-write': 'MQTT Write',
    'mqtt-will': 'MQTT Will',
    'mqtt-announce': 'MQTT Announce',
};

function normalizeNodeId(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

function nodeKindLabel(nodeType: string): string {
    const bare = bareNodeTypeId(nodeType);
    if (NODE_KIND_LABELS[bare]) {
        return NODE_KIND_LABELS[bare];
    }
    return bare
        .split('-')
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(' ');
}

function isMqttNode(nodeType: string): boolean {
    const bare = bareNodeTypeId(nodeType);
    return bare.startsWith('mqtt-') || bare.startsWith('hass-');
}

/**
 * Collect the topic roles of every MQTT node in the graph.
 * @param context - Rule context.
 * @returns Node infos plus the publisher/subscriber bindings of the graph.
 */
export function collectTopicBindings(context: GraphTopicRuleContext): GraphTopicBindings {
    const nodes: GraphTopicNodeInfo[] = [];
    const publishers: GraphTopicBinding[] = [];
    const subscribers: GraphTopicBinding[] = [];

    (Array.isArray(context?.nodes) ? context.nodes : []).forEach((rawNode) => {
        const nodeId = normalizeNodeId(rawNode?.id);
        const nodeType = bareNodeTypeId(rawNode?.type);
        if (!nodeId || !nodeType || !isMqttNode(nodeType)) {
            return;
        }

        const nodeTypeDefinition = context.nodeTypesByNodeId?.[nodeId] || null;
        const declaredControls = Array.isArray(nodeTypeDefinition?.controls)
            ? (nodeTypeDefinition?.controls as UnknownRecord[])
            : [];
        const declaredIds = new Set(
            declaredControls
                .map((control) => (typeof control?.id === 'string' ? control.id : ''))
                .filter((id) => id.length > 0)
        );
        const controlValues =
            rawNode.controlValues && typeof rawNode.controlValues === 'object'
                ? (rawNode.controlValues as UnknownRecord)
                : {};

        const topics: Record<string, string> = {};
        TOPIC_CONTROL_IDS.forEach((controlId) => {
            // Without a definition every known control id counts; with one, only the
            // controls the node really declares are considered.
            if (declaredIds.size > 0 && !declaredIds.has(controlId)) {
                return;
            }
            topics[controlId] = effectiveTopicValue(controlId, controlValues);
        });

        const retainRaw = controlValues.retain;
        const retain = typeof retainRaw === 'boolean' ? retainRaw : null;
        const willPayload =
            typeof controlValues.willPayload === 'string' ? controlValues.willPayload : null;

        nodes.push({ nodeId, nodeType, controlValues, topics, retain, willPayload });

        const roles = topicRolesFor(nodeType);
        roles.publish.forEach((controlId) => {
            const topic = topics[controlId];
            if (topic) {
                publishers.push({ nodeId, controlId, topic });
            }
        });
        roles.subscribe.forEach((controlId) => {
            const topic = topics[controlId];
            if (topic) {
                subscribers.push({ nodeId, controlId, topic });
            }
        });
    });

    return { nodes, publishers, subscribers };
}

/**
 * Register (or replace) a topic rule as a graph rule.
 * @param id - Stable rule id used for de-duplication and documentation.
 * @param rule - Pure rule function.
 */
export function registerGraphTopicRule(id: string, rule: GraphTopicRule): void {
    if (!id || typeof id !== 'string') {
        throw new TypeError('registerGraphTopicRule requires a non-empty rule id');
    }
    if (typeof rule !== 'function') {
        throw new TypeError('registerGraphTopicRule requires a rule function');
    }
    registerGraphRule({ id, run: rule });
}

/**
 * Ids of the registered rules, in registration order.
 * @returns Rule ids.
 */
export function getGraphTopicRuleIds(): string[] {
    return getGraphRules().map((rule) => rule.id);
}

/**
 * Run every registered rule and merge the results.
 * @param context - Rule context built from the current graph.
 * @returns De-duplicated issues in rule-registration order.
 */
export function validateGraphTopics(context: GraphTopicRuleContext): NodeCapabilityIssue[] {
    return validateGraphRules(context);
}

function makeIssue(
    nodeId: string,
    message: string,
    controlId: string | null,
    scope: 'node' | 'control' = 'control'
): NodeCapabilityIssue {
    return {
        nodeId,
        scope,
        message,
        capability: null,
        controlId,
        inputId: null,
        source: 'graphRule',
    };
}

// A status/birth topic (`.../status`, e.g. `homeassistant/status`) is published by
// another system by convention, so reading it is never a graph mistake.
const externalStatusTopic = /\/status$/;

/**
 * Collection view of `collectTopicBindings()`. Node ids are per graph, so the graph-keyed
 * `nodeTypesByNodeId` map must NOT be reused for nodes of other graphs — it would resolve a
 * colliding id to the wrong node type and drop real topics. Without a definition,
 * `collectTopicBindings()` treats every known topic control as declared (permissive), which
 * can only remove false positives.
 */
function collectCollectionTopicBindings(context: GraphRuleContext): GraphTopicBindings {
    const collectionNodes =
        Array.isArray(context.collectionNodes) && context.collectionNodes.length > 0
            ? context.collectionNodes
            : context.nodes;
    return collectTopicBindings({ ...context, nodes: collectionNodes, nodeTypesByNodeId: {} });
}

/**
 * One will fits into the MQTT connect; a second will node — in this graph or another graph of
 * the collection — overwrites the first, so the earlier one is flagged.
 */
export function mqttWillDuplicate(context: GraphRuleContext): NodeCapabilityIssue[] {
    const wills = collectCollectionTopicBindings(context).nodes.filter(
        (node) => node.nodeType === 'mqtt-will' && node.topics.willTopic
    );
    if (wills.length <= 1 || new Set(wills.map((node) => node.topics.willTopic)).size <= 1) {
        return [];
    }
    const lastWill = wills[wills.length - 1];
    return wills
        .filter((node) => node !== lastWill)
        .map((node) =>
            makeIssue(
                node.nodeId,
                `Only one will fits into the MQTT connect: the last MQTT Will node in the collection wins over '${node.topics.willTopic}'.`,
                'willTopic'
            )
        );
}

/**
 * A read on a topic nobody in the collection publishes; the subscriber side stays graph-local
 * so the badge only ever lands on a node of the validated graph.
 */
export function mqttReadUnpublished(context: GraphRuleContext): NodeCapabilityIssue[] {
    const published = new Set(
        collectCollectionTopicBindings(context).publishers.map((entry) => entry.topic)
    );
    return collectTopicBindings(context).subscribers
        .filter((entry) => !published.has(entry.topic))
        .filter((entry) => !externalStatusTopic.test(entry.topic))
        .map((entry) =>
            makeIssue(
                entry.nodeId,
                `No node in the collection publishes to '${entry.topic}': the messages must come from another device.`,
                entry.controlId
            )
        );
}

/** Register the built-in rules (idempotent: re-registering replaces them). */
function registerBuiltInGraphTopicRules(): void {
    registerGraphTopicRule('mqtt-topic-empty', (context) => {
        const issues: NodeCapabilityIssue[] = [];
        collectTopicBindings(context).nodes.forEach((node) => {
            ['topic', 'announceTopic', 'stateTopic'].forEach((controlId) => {
                if (!(controlId in node.topics) || node.topics[controlId]) {
                    return;
                }
                issues.push(
                    makeIssue(
                        node.nodeId,
                        `${nodeKindLabel(node.nodeType)} has no topic: this node never reaches the broker.`,
                        controlId
                    )
                );
            });
        });
        return issues;
    });

    registerGraphTopicRule('mqtt-will-require-topic', (context) => {
        const issues: NodeCapabilityIssue[] = [];
        collectTopicBindings(context).nodes.forEach((node) => {
            if (node.nodeType !== 'mqtt-will' || node.topics.willTopic) {
                return;
            }
            issues.push(
                makeIssue(
                    node.nodeId,
                    'MQTT Will has no topic: the broker rejects a will without a topic.',
                    'willTopic'
                )
            );
        });
        return issues;
    });

    registerGraphRule({ id: 'mqtt-will-duplicate', scope: 'collection', run: mqttWillDuplicate });

    registerGraphRule({
        id: 'mqtt-read-unpublished',
        scope: 'collection',
        run: mqttReadUnpublished,
    });

    registerGraphTopicRule('mqtt-announce-unretained', (context) => {
        return collectTopicBindings(context)
            .nodes.filter(
                (node) =>
                    node.nodeType === 'mqtt-announce' &&
                    node.retain === false &&
                    Boolean(node.topics.announceTopic)
            )
            .map((node) =>
                makeIssue(
                    node.nodeId,
                    `MQTT Announce is not retained: a subscriber that connects later will not see '${node.topics.announceTopic}'.`,
                    'retain'
                )
            );
    });
}

registerBuiltInGraphTopicRules();

/** Drop every rule (including package extensions) and restore the built-ins. */
export function clearGraphTopicRules(): void {
    clearGraphRules();
    registerBuiltInGraphTopicRules();
}

// Package bridge: node packages run as plain scripts and cannot import core modules by
// path, so the registry is also published on the global scope (same pattern as
// NodeCodeGenerators / NodeCapabilityChecks).
const globalScope =
    typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
(globalScope as unknown as Record<string, unknown>).GraphTopicRules = {
    register: registerGraphTopicRule,
    validate: validateGraphTopics,
    getRuleIds: getGraphTopicRuleIds,
    clear: clearGraphTopicRules,
};
// Object-shaped register({ id, scope, run }) for packages written against the shared
// registry directly (GraphTopicRules keeps the positional `register(id, fn)` form).
(globalScope as unknown as Record<string, unknown>).GraphRules = {
    register: registerGraphRule,
    validate: validateGraphRules,
    getRuleIds: () => getGraphRules().map((rule) => rule.id),
    clear: clearGraphRules,
};
