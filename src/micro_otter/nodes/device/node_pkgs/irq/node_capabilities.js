// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Interrupt node validation.
//
// The `irq` capability is derived by the device target from the digital input pins, so the pin
// requirement is fully declarative (`resourceUsage`); the one bespoke check below covers the
// optional pull resistor, exactly like core's `digitalInput` check.
//
// The graph rules keep interrupt *names* coherent: an `interrupt-input` node declares a channel,
// `interrupt-enable` nodes and `irq`-mode graphs reference it. "One irq graph per name" is a
// runtime constraint enforced by the transpiler (Locked Decision 15), not by these rules; the
// editor only badges the structural mistakes it can see (blank name, duplicate declaration,
// dangling reference, irq graph pointing at no channel, two inputs claiming one GPIO).

/**
 * Register the per-node capability check for `interrupt-input`.
 * @param {Function} register - Callback that binds a handler to a node type id.
 */
export async function registerCapabilityChecks(register) {
    if (typeof register !== 'function') {
        return;
    }
    register('irq.interrupt-input', interruptInputPullCheck);
}

/**
 * Re-check the optional pull resistor against the selected pin.
 *
 * Mirrors core's `digitalInput` check: `pull === 'up'` needs `pull.up`, `pull === 'down'` needs
 * `pull.down`, and a target without `hasPinCapability` reports nothing.
 *
 * @param {{ nodeData?: object, deviceTarget?: object }} args - Validation arguments.
 * @returns {Array<object>} Capability issues, empty when the selection is fine.
 */
function interruptInputPullCheck({ nodeData, deviceTarget } = {}) {
    const issues = [];
    if (!nodeData || !deviceTarget || typeof deviceTarget.hasPinCapability !== 'function') {
        return issues;
    }

    const controls = nodeData.controlValues || {};
    const pin = controls.pin;
    const pull = controls.pull;

    if (pull === 'up' && !deviceTarget.hasPinCapability(pin, 'pull.up')) {
        issues.push({
            nodeId: nodeData.id ?? null,
            capability: 'pull.up',
            message: `Selected pin ${pin} does not support pull-up.`,
        });
    } else if (pull === 'down' && !deviceTarget.hasPinCapability(pin, 'pull.down')) {
        issues.push({
            nodeId: nodeData.id ?? null,
            capability: 'pull.down',
            message: `Selected pin ${pin} does not support pull-down.`,
        });
    }

    return issues;
}

/** Strip the `package.` prefix from a node type id (`irq.interrupt-input` → `interrupt-input`). */
function bareType(type) {
    const value = String(type ?? '');
    const dot = value.indexOf('.');
    return dot >= 0 ? value.slice(dot + 1) : value;
}

const INPUT_TYPE = 'interrupt-input';
const ENABLE_TYPE = 'interrupt-enable';

const text = (value) => String(value ?? '').trim();

const isInputNode = (node) => bareType(node?.type) === INPUT_TYPE;

const isEnableNode = (node) => bareType(node?.type) === ENABLE_TYPE;

/** Interrupt name a node stores, trimmed. */
const nameOf = (node) => text(node?.controlValues?.triggerName);

/**
 * Stable comparison key for the GPIO an `interrupt-input` claims.
 *
 * Mirrors the effective pin of `irq/node_generators.js` (`undefined`, `null`, and blank all mean
 * `0`, the generator default) so the badge and the generated `Pin(...)` cannot disagree.
 * `js/proc/transpiler.ts#irqPinKey()` mirrors this function; keep both copies in sync — they are
 * pinned by their own tests (`tests/nodes/irq-graph-rules.test.js`,
 * `tests/proc/irq-graph-transpiler.test.js`).
 *
 * @param {object} node - Node to read the `pin` control from.
 * @returns {string} `'0'` for an unset pin, the string of a finite number, or `raw:<trimmed>` for
 *   anything else so an unsupported value only groups with an identical unsupported value.
 */
function pinKey(node) {
    const raw = node?.controlValues?.pin;
    if (raw === undefined || raw === null || text(raw) === '') {
        return '0';
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? String(numeric) : `raw:${String(raw).trim()}`;
}

/**
 * Text shown in the GPIO rule message for a {@link pinKey} value.
 * @param {string} key - Comparison key from {@link pinKey}.
 * @returns {string} The raw label of a `raw:` key, otherwise the numeric key itself.
 */
function pinLabel(key) {
    return key.startsWith('raw:') ? key.slice(4) : key;
}

/**
 * A node-scoped graph-rule issue in the shape the badge pipeline expects.
 * @param {object} node - Node the issue is anchored to.
 * @param {string|null} controlId - Control to highlight, or `null`.
 * @param {string} message - Message text.
 */
function issue(node, controlId, message) {
    return {
        nodeId: String(node.id),
        scope: 'node',
        message,
        capability: null,
        controlId: controlId ?? null,
        inputId: null,
        source: 'graphRule',
    };
}

/** A graph-level graph-rule issue (no node anchor). */
function graphIssue(message) {
    return {
        nodeId: null,
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
    register(nameRequiredRule());
    register(nameDuplicateRule());
    register(enableDanglingRule());
    register(graphTriggerRule());
    register(pinDuplicateRule());
}

/** A declaring `interrupt-input` needs a name, otherwise nothing can target it. */
function nameRequiredRule() {
    return {
        id: 'irq-name-required',
        scope: 'graph',
        run: ({ nodes }) =>
            (Array.isArray(nodes) ? nodes : [])
                .filter((node) => isInputNode(node) && !nameOf(node))
                .map((node) =>
                    issue(
                        node,
                        'triggerName',
                        'This interrupt input has no name: irq-mode graphs and interrupt-enable nodes cannot target it.'
                    )
                ),
    };
}

/**
 * Two declarations of the same name make the channel ambiguous.
 *
 * Like `vars-duplicate-declaration`, the rule reads the whole collection but only reports nodes of
 * the validated graph; the registry drops the rest.
 */
function nameDuplicateRule() {
    return {
        id: 'irq-name-duplicate',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const byName = new Map();
            allNodes.forEach((node) => {
                if (!isInputNode(node)) {
                    return;
                }
                const name = nameOf(node);
                if (!name) {
                    return;
                }
                if (!byName.has(name)) {
                    byName.set(name, []);
                }
                byName.get(name).push(node);
            });

            const graphNodeIds = new Set(graphNodes.map((node) => String(node.id)));
            const issues = [];
            byName.forEach((declarations, name) => {
                if (declarations.length < 2) {
                    return;
                }
                declarations.forEach((node) => {
                    if (!graphNodeIds.has(String(node.id))) {
                        return;
                    }
                    issues.push(
                        issue(
                            node,
                            'triggerName',
                            `The interrupt name '${name}' is declared by more than one interrupt input.`
                        )
                    );
                });
            });
            return issues;
        },
    };
}

/** An `interrupt-enable` pointing at a channel no declaration covers. */
function enableDanglingRule() {
    return {
        id: 'irq-enable-dangling',
        scope: 'graph',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;
            const declared = new Set(allNodes.filter(isInputNode).map(nameOf).filter(Boolean));

            return graphNodes
                .filter((node) => isEnableNode(node))
                .filter((node) => {
                    const name = nameOf(node);
                    return Boolean(name) && !declared.has(name);
                })
                .map((node) =>
                    issue(
                        node,
                        'triggerName',
                        `No interrupt input declares the name '${nameOf(node)}'.`
                    )
                );
        },
    };
}

/** An `irq`-mode graph must name an interrupt input of its own graph. */
function graphTriggerRule() {
    return {
        id: 'irq-graph-trigger',
        scope: 'graph',
        run: ({ nodes, graphSettings }) => {
            if (text(graphSettings?.executionType) !== 'irq') {
                return [];
            }
            const name = text(graphSettings?.triggerName);
            if (!name) {
                return [
                    graphIssue(
                        'This irq-mode graph has no interrupt name: pick the interrupt input it runs on.'
                    ),
                ];
            }
            const declared = (Array.isArray(nodes) ? nodes : []).filter(isInputNode).map(nameOf);
            if (declared.includes(name)) {
                return [];
            }
            return [
                graphIssue(
                    `The interrupt name '${name}' is not declared by an interrupt input in this graph.`
                ),
            ];
        },
    };
}

/**
 * One GPIO may be armed by at most one `interrupt-input`.
 *
 * `pin.irq(handler=…)` on a GPIO that a second channel already armed replaces the first handler,
 * leaving the first channel registered but deaf (`count()` stays `0`, `take()` stays `False`).
 * Like `nameDuplicateRule`, the rule reads the whole collection but only reports nodes of the
 * validated graph; the registry drops the rest.
 */
function pinDuplicateRule() {
    return {
        id: 'irq-pin-duplicate',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const byPin = new Map();
            allNodes.forEach((node) => {
                if (!isInputNode(node)) {
                    return;
                }
                const key = pinKey(node);
                if (!byPin.has(key)) {
                    byPin.set(key, []);
                }
                byPin.get(key).push(node);
            });

            const graphNodeIds = new Set(graphNodes.map((node) => String(node.id)));
            const issues = [];
            byPin.forEach((declarations, key) => {
                if (declarations.length < 2) {
                    return;
                }
                declarations.forEach((node) => {
                    if (!graphNodeIds.has(String(node.id))) {
                        return;
                    }
                    issues.push(
                        issue(
                            node,
                            'pin',
                            `GPIO ${pinLabel(key)} is used by more than one interrupt input: only one interrupt can own a GPIO.`
                        )
                    );
                });
            });
            return issues;
        },
    };
}
