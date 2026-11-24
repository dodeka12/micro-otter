// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Home Assistant node validation. The network requirement is declared in the package
// manifest (`requiredCapabilities`); this module adds the graph rules that entity nodes
// need a bridge and that only one will fits into the MQTT connect.

/**
 * Register per-node capability checks (none yet).
 * @param {Function} register - Callback that binds a handler to a node type id.
 */
export function registerCapabilityChecks(register) {
    if (typeof register !== 'function') {
        return;
    }
}

const globalScope =
    typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
if (!globalScope.NodeCapabilityChecks) {
    globalScope.NodeCapabilityChecks = {};
}

/** Strip the `package.` prefix from a node type id (`hass.hass-bridge` → `hass-bridge`). */
function bareType(type) {
    const value = String(type ?? '');
    const dot = value.indexOf('.');
    return dot >= 0 ? value.slice(dot + 1) : value;
}

const ENTITY_MESSAGE =
    'Home Assistant entities need a hass-bridge node in the collection: nothing is announced without it.';
const DUPLICATE_MESSAGE =
    'More than one hass-bridge in the collection: the last one wins and replaces the device card.';

function issue(node, message) {
    return {
        nodeId: String(node.id),
        scope: 'node',
        message,
        capability: null,
        controlId: null,
        inputId: null,
        source: 'graphRule',
    };
}

/**
 * Register the package graph rules through the shared registry.
 * @param {Function} register - `registerGraphRule` from `core/graph-rule-registry.ts`.
 */
export function registerGraphRules(register) {
    if (typeof register !== 'function') {
        return;
    }
    register(hassRequiresBridgeRule());
    register(hassBridgeWillConflictRule());
    register(hassAvailabilityDuplicateRule());
    register(hassAvailabilityInvalidIdRule());
    register(hassAvailabilityMissingFlagRule());
    register(hassIconInvalidRule());
}

function hassRequiresBridgeRule() {
    return {
        id: 'hass-requires-bridge',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;
            const bridges = allNodes.filter((node) => bareType(node?.type) === 'hass-bridge');

            if (bridges.length === 0) {
                return graphNodes
                    .filter((node) => bareType(node?.type).startsWith('hass-'))
                    .map((node) => issue(node, ENTITY_MESSAGE));
            }
            if (bridges.length > 1) {
                return graphNodes
                    .filter((node) => bareType(node?.type) === 'hass-bridge')
                    .map((node) => issue(node, DUPLICATE_MESSAGE));
            }
            return [];
        },
    };
}

const sanitizeId = (value) =>
    String(value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
const trimPrefix = (value, fallback) =>
    String(value ?? '').trim().replace(/^\/+|\/+$/g, '') || fallback;
const bridgeWillTopic = (values) =>
    `${trimPrefix(values.topicPrefix, 'otter')}/${sanitizeId(values.deviceId)}/availability`;
const willNodeTopic = (values) => {
    const custom = String(values?.customWillTopic ?? '').trim();
    const topic = String(values?.willTopic ?? '').trim();
    return custom || topic;
};
const isBridgeProvider = (node) => {
    const values = (node && typeof node === 'object' ? node.controlValues : null) || {};
    const deviceId = String(values.deviceId ?? '').trim();
    return Boolean(deviceId) && values.availability !== false && values.will !== false;
};

const ON_WILL = (bridgeTopic) =>
    `Only one will fits into the MQTT connect: the hass-bridge in the collection already sets '${bridgeTopic}'. This node's will replaces it.`;
const ON_BRIDGE = (willTopics) =>
    `Only one will fits into the MQTT connect: the MQTT Will node(s) in the collection set '${willTopics}'. The last one configured wins.`;

function hassBridgeWillConflictRule() {
    return {
        id: 'hass-bridge-will-conflict',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const bridgeProviders = allNodes.filter(
                (node) => bareType(node?.type) === 'hass-bridge' && isBridgeProvider(node)
            );
            if (bridgeProviders.length === 0) {
                return [];
            }

            const willNodes = allNodes.filter(
                (node) =>
                    bareType(node?.type) === 'mqtt-will' &&
                    Boolean(willNodeTopic(node?.controlValues))
            );
            if (willNodes.length === 0) {
                return [];
            }

            const willTopics = willNodes.map((node) => willNodeTopic(node.controlValues));
            const issues = [];

            willNodes.forEach((node) => {
                issues.push(
                    issue(
                        node,
                        ON_WILL(bridgeWillTopic(bridgeProviders[0].controlValues || {}))
                    )
                );
            });
            bridgeProviders.forEach((node) => {
                issues.push(issue(node, ON_BRIDGE(willTopics.join(', '))));
            });

            return issues;
        },
    };
}

// --- Availability flags ---------------------------------------------------------------
// The sanitisation mirrors `_sanitize_id()` in `otter_hass/runtime.py` and
// `sanitizeAvailabilityId()` in `nodes/availability-flags.ts`: the runtime builds the topic,
// so a second, different rule would badge the wrong pairs.

const FLAG_NODE_TYPE = 'hass-availability';
const FLAG_CONTROL_ID = 'id';
const FLAG_REFERENCE_CONTROL_ID = 'availabilityFlags';
/** Mirrors `DEVICE_AVAILABILITY_ENTRY` in `nodes/availability-flags.ts`. */
const DEVICE_AVAILABILITY_ENTRY = '__device__';
const ENTITY_NODE_TYPES = [
    'hass-sensor',
    'hass-binary-sensor',
    'hass-number',
    'hass-switch',
    'hass-select',
    'hass-text',
    'hass-button',
];

const flagIdOf = (node) => {
    const values = (node && typeof node === 'object' ? node.controlValues : null) || {};
    return String(values[FLAG_CONTROL_ID] ?? '').trim();
};

const referencedFlagsOf = (node) => {
    const values = (node && typeof node === 'object' ? node.controlValues : null) || {};
    const raw = values[FLAG_REFERENCE_CONTROL_ID];
    const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
    return entries
        .map((entry) => String(entry === undefined || entry === null ? '' : entry).trim())
        .filter((entry) => entry.length > 0 && entry !== DEVICE_AVAILABILITY_ENTRY);
};

const DUPLICATE_FLAG_MESSAGE = (segment) =>
    `Two hass-availability nodes publish '${segment}': they overwrite each other's retained ` +
    'payload, so Home Assistant cannot tell which flag it is reading.';
const INVALID_FLAG_MESSAGE =
    'This availability flag has no usable Availability ID: nothing is published and no entity ' +
    'can reference it.';
const MISSING_FLAG_MESSAGE = (flagId) =>
    `Availability flag '${flagId}' is not defined by any hass-availability node in the ` +
    'collection: the entity stays unavailable until that flag exists.';

function hassAvailabilityDuplicateRule() {
    return {
        id: 'hass-availability-duplicate-id',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const ownersBySegment = new Map();
            allNodes.forEach((node) => {
                if (bareType(node?.type) !== FLAG_NODE_TYPE) {
                    return;
                }
                const segment = sanitizeId(flagIdOf(node));
                if (!segment) {
                    return;
                }
                const owners = ownersBySegment.get(segment) || [];
                owners.push(node);
                ownersBySegment.set(segment, owners);
            });

            const issues = [];
            ownersBySegment.forEach((owners, segment) => {
                if (owners.length < 2) {
                    return;
                }
                // One issue per node on screen; the registry drops issues from other graphs.
                owners.forEach((node) => issues.push(issue(node, DUPLICATE_FLAG_MESSAGE(segment))));
            });
            return issues;
        },
    };
}

function hassAvailabilityInvalidIdRule() {
    return {
        id: 'hass-availability-invalid-id',
        scope: 'graph',
        run: ({ nodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            return graphNodes
                .filter(
                    (node) =>
                        bareType(node?.type) === FLAG_NODE_TYPE &&
                        !sanitizeId(flagIdOf(node))
                )
                .map((node) => issue(node, INVALID_FLAG_MESSAGE));
        },
    };
}

function hassAvailabilityMissingFlagRule() {
    return {
        id: 'hass-availability-missing-flag',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const defined = new Set();
            allNodes.forEach((node) => {
                if (bareType(node?.type) !== FLAG_NODE_TYPE) {
                    return;
                }
                const segment = sanitizeId(flagIdOf(node));
                if (segment) {
                    defined.add(segment);
                }
            });

            const issues = [];
            graphNodes
                .filter((node) => ENTITY_NODE_TYPES.includes(bareType(node?.type)))
                .forEach((node) => {
                    const missing = referencedFlagsOf(node).filter(
                        (flagId) => !defined.has(sanitizeId(flagId))
                    );
                    missing.forEach((flagId) =>
                        issues.push(issue(node, MISSING_FLAG_MESSAGE(sanitizeId(flagId) || flagId)))
                    );
                });
            return issues;
        },
    };
}

// --- Entity icons ---------------------------------------------------------------------
// Syntax only. Whether an icon *name* exists in the bundled MDI release is the picker's
// business: `GraphRule.run()` is synchronous while the icon index is an async fetch, so a
// rule that checked the index would either never fire or need a preloaded index. The picker
// shows a soft hint for an unknown-but-well-formed name instead.

const ICON_CONTROL_ID = 'icon';
// Icons come from any set (`mdi`, `ph`, `hue`, …), so a custom prefix must stay legal.
const ICON_SET_PATTERN = /^[a-z][a-z0-9-]*$/;
const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const iconValueOf = (node) => {
    const values = (node && typeof node === 'object' ? node.controlValues : null) || {};
    return String(values[ICON_CONTROL_ID] ?? '').trim();
};

const INVALID_ICON_MESSAGE = (value) =>
    `icon '${value}' must be written as '<set>:<name>', e.g. 'mdi:thermometer'.`;

/** `<set>:<name>` with exactly one colon and lower-case, hyphen-separated segments. */
function isIconSyntaxValid(value) {
    const separator = value.indexOf(':');
    if (separator <= 0 || separator !== value.lastIndexOf(':')) {
        return false;
    }
    const set = value.slice(0, separator);
    const name = value.slice(separator + 1);
    return ICON_SET_PATTERN.test(set) && ICON_NAME_PATTERN.test(name);
}

function hassIconInvalidRule() {
    return {
        id: 'hass-icon-invalid',
        scope: 'graph',
        run: ({ nodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const issues = [];
            graphNodes.forEach((node) => {
                if (!ENTITY_NODE_TYPES.includes(bareType(node?.type))) {
                    return;
                }
                const value = iconValueOf(node);
                if (!value || isIconSyntaxValid(value)) {
                    return;
                }
                // No `severity`: Home Assistant drops an unparsable icon, so it stays an error.
                issues.push(issue(node, INVALID_ICON_MESSAGE(value)));
            });
            return issues;
        },
    };
}

// Script-load path (tests): node packages run as plain scripts and cannot import core
// modules, so register through the global bridge when present. The package hook
// (`registerGraphRules`) above is what `data/node-package.ts` calls in the app.
const graphRules = globalScope.GraphRules;
if (graphRules && typeof graphRules.register === 'function') {
    graphRules.register(hassRequiresBridgeRule());
    graphRules.register(hassBridgeWillConflictRule());
    graphRules.register(hassAvailabilityDuplicateRule());
    graphRules.register(hassAvailabilityInvalidIdRule());
    graphRules.register(hassAvailabilityMissingFlagRule());
    graphRules.register(hassIconInvalidRule());
}
