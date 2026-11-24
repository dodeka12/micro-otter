// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared graph-topic collector: one definition of "the MQTT topics this graph already
 * uses". Consumed by the `graphTopics` dynamic-control source and by the graph-level
 * topic-coherence validator, so both agree on what a topic of the graph is.
 *
 * The module is deliberately free of MQTT package imports: it only looks at node types,
 * control ids and control values.
 */

/** Option value that reveals the free-text "new topic" control. */
export const GRAPH_TOPIC_NEW_SENTINEL = '__new__';

/** Control ids harvested by default (the topic controls of the MQTT package). */
export const GRAPH_TOPIC_CONTROL_IDS = ['topic', 'willTopic', 'announceTopic', 'triggerTopic'];

/** Node-type prefixes whose controls always count as graph topics. */
const GRAPH_TOPIC_NODE_TYPE_PREFIXES = ['mqtt-', 'hass-'];

export interface GraphTopicEntry {
    topic: string;
    nodeId: string;
    controlId: string;
}

export interface GraphTopicSourceLike {
    getNodes?: () => unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeId(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

/**
 * Control id paired with a `graphTopics` dropdown that reveals it ("topic" → "customTopic").
 * @param controlId - Id of the dropdown control.
 * @returns The id of the free-text control that holds a newly typed topic.
 */
export function customTopicControlId(controlId: string): string {
    return `custom${controlId.charAt(0).toUpperCase()}${controlId.slice(1)}`;
}

/**
 * Bare node type id with the `package.` prefix stripped: `mqtt.mqtt-read` → `mqtt-read`,
 * `hass.hass-bridge` → `hass-bridge`. A type without a package prefix is returned as-is.
 * @param nodeType - A node type id as stored on a graph node.
 * @returns The bare type id.
 */
export function bareNodeTypeId(nodeType: unknown): string {
    const type = typeof nodeType === 'string' ? nodeType.trim() : '';
    if (!type) {
        return '';
    }
    const dot = type.indexOf('.');
    return dot >= 0 ? type.slice(dot + 1) : type;
}

/**
 * Topic a control actually stands for, applying the `__new__` sentinel contract.
 * @param controlId - Id of the topic control.
 * @param controlValues - The node's control values.
 * @returns The effective topic, or an empty string when none is set.
 */
export function effectiveTopicValue(
    controlId: string,
    controlValues: Record<string, unknown> | undefined
): string {
    const raw = String(controlValues?.[controlId] ?? '').trim();
    if (raw !== GRAPH_TOPIC_NEW_SENTINEL) {
        return raw;
    }
    const customId = customTopicControlId(controlId);
    return String(controlValues?.[customId] ?? '').trim();
}

/**
 * Whether a control declares the `graphTopics` dynamic source.
 * @param control - A node control definition.
 * @returns True when the control is a graph-topic dropdown.
 */
export function isGraphTopicControl(control: unknown): boolean {
    const descriptor = asRecord(asRecord(control)?.dynamicOptions);
    return descriptor?.source === 'graphTopics';
}

function isGraphTopicNodeType(rawType: unknown): boolean {
    const type = bareNodeTypeId(rawType);
    if (!type) {
        return false;
    }
    return GRAPH_TOPIC_NODE_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Collect every topic used in the graph, de-duplicated and sorted.
 * @param graph - Graph exposing `getNodes()`.
 * @param controlIds - Control ids to harvest (defaults to the MQTT topic controls).
 * @returns One entry per unique topic, naming the first node/control that uses it.
 */
export function collectGraphTopics(
    graph: GraphTopicSourceLike | null | undefined,
    controlIds: string[] = GRAPH_TOPIC_CONTROL_IDS
): GraphTopicEntry[] {
    const nodes = typeof graph?.getNodes === 'function' ? graph.getNodes() : [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return [];
    }

    const wanted = new Set((Array.isArray(controlIds) ? controlIds : []).map((id) => String(id)));
    const seen = new Set<string>();
    const entries: GraphTopicEntry[] = [];

    nodes.forEach((rawNode) => {
        const node = asRecord(rawNode);
        if (!node) {
            return;
        }
        const controls = Array.isArray(node.controls) ? node.controls : [];
        if (controls.length === 0) {
            return;
        }
        const nodeId = normalizeId(node.id);
        const controlValues = asRecord(node.controlValues) || {};
        const harvestAll = isGraphTopicNodeType(node.type);

        controls.forEach((rawControl) => {
            const control = asRecord(rawControl);
            const controlId = normalizeId(control?.id);
            if (!controlId || !wanted.has(controlId)) {
                return;
            }
            if (!harvestAll && !isGraphTopicControl(control)) {
                return;
            }
            const topic = effectiveTopicValue(controlId, controlValues);
            if (!topic || seen.has(topic)) {
                return;
            }
            seen.add(topic);
            entries.push({ topic, nodeId, controlId });
        });
    });

    entries.sort((left, right) => left.topic.localeCompare(right.topic));
    return entries;
}
