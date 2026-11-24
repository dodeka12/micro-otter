// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Variable node validation. With the store-only model there are no bespoke per-node capability
// checks; entries are created on first write and reads default to 0. The graph rule below flags
// the one structural mistake the declare/use model allows: a second node declaring the same
// variable.

/**
 * Register per-node capability checks.
 * @param {Function} register - Callback that binds a handler to a node type id.
 */
export async function registerCapabilityChecks(register) {
    if (typeof register !== 'function') {
        return;
    }
    register('vars.signal-post', signalPostCheck);
}

// `MAX_SIGNAL_NAME_LENGTH = 64` also lands as a shared constant in
// `js/data/graph-execution-settings.ts` (phase 6); keep this local literal in sync.
// Do not import editor code from this device-package JS file.
const MAX_SIGNAL_NAME_LENGTH = 64;
const SIGNAL_NAME_AMBIGUOUS = /[^A-Za-z0-9._-]/;

/** Signal name a `signal-post` node posts, applying the `__new__` sentinel contract. */
function signalNameOf(node) {
    const controlValues = (node && node.controlValues) || {};
    const raw = text(controlValues.signal);
    if (raw === NEW_SENTINEL) {
        return text(controlValues.customSignal);
    }
    return raw;
}

/**
 * Re-check the `signal-post` name: over-long, or ambiguous characters.
 *
 * A blank effective name is the picker's `(not set)` disabled state: the generator emits
 * only a comment, so it is valid. The runtime accepts any non-blank name, but the
 * settings picker and the logs become ambiguous for names outside `[A-Za-z0-9._-]`, so
 * those are warnings rather than errors.
 *
 * @param {{ nodeData?: object }} args - Validation arguments.
 * @returns {Array<object>} Issues, empty when the name is fine or the node is disabled.
 */
function signalPostCheck({ nodeData } = {}) {
    const issues = [];
    if (!nodeData) {
        return issues;
    }
    const name = signalNameOf(nodeData);
    const nodeId = nodeData.id ?? null;

    if (!name) {
        return issues;
    }

    if (name.length > MAX_SIGNAL_NAME_LENGTH) {
        issues.push({
            nodeId,
            scope: 'node',
            message: `the signal name is longer than ${MAX_SIGNAL_NAME_LENGTH} characters`,
            capability: null,
            controlId: 'signal',
            inputId: null,
        });
    }

    if (SIGNAL_NAME_AMBIGUOUS.test(name)) {
        issues.push({
            nodeId,
            scope: 'node',
            message: 'the signal name contains characters outside [A-Za-z0-9._-]',
            capability: null,
            controlId: 'signal',
            inputId: null,
            severity: 'warn',
        });
    }

    return issues;
}

/** Strip the `package.` prefix from a node type id (`vars.var-read` → `var-read`). */
function bareType(type) {
    const value = String(type ?? '');
    const dot = value.indexOf('.');
    return dot >= 0 ? value.slice(dot + 1) : value;
}

const NEW_SENTINEL = '__new__';
const DEFAULT_STORE = 'default';

const text = (value) => String(value ?? '').trim();

const isVarNameNode = (node) => {
    const type = bareType(node?.type);
    return type === 'var-read' || type === 'var-write';
};

/** Namespace a node actually uses, applying the `__new__` sentinel contract. */
function storeOf(node) {
    const inputDefaults = (node && node.inputDefaults) || {};
    const controlValues = (node && node.controlValues) || {};
    const raw = text(inputDefaults.store ?? controlValues.store);
    if (raw === NEW_SENTINEL) {
        return text(controlValues.customStore) || DEFAULT_STORE;
    }
    return raw || DEFAULT_STORE;
}

/**
 * The `{ store, name }` a node declares, or `null` when it declares nothing.
 * Mirrors `declaredVarEntry()` in `nodes/var-stores.ts`.
 */
function declaredEntry(node) {
    if (!isVarNameNode(node)) {
        return null;
    }
    const controlValues = (node && node.controlValues) || {};
    if (text(controlValues.name) !== NEW_SENTINEL) {
        return null;
    }
    const name = text(controlValues.customName);
    if (!name) {
        return null;
    }
    return { store: storeOf(node), name };
}

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
    register(duplicateDeclarationRule());
    register(eventSignalSelectionRule());
    register(eventSignalProducerRule());
}

function duplicateDeclarationRule() {
    return {
        id: 'vars-duplicate-declaration',
        scope: 'collection',
        run: ({ nodes, collectionNodes }) => {
            const graphNodes = Array.isArray(nodes) ? nodes : [];
            const allNodes =
                Array.isArray(collectionNodes) && collectionNodes.length > 0
                    ? collectionNodes
                    : graphNodes;

            const byKey = new Map();
            allNodes.forEach((node) => {
                const entry = declaredEntry(node);
                if (!entry) {
                    return;
                }
                const key = `${entry.store}\u0000${entry.name}`;
                if (!byKey.has(key)) {
                    byKey.set(key, []);
                }
                byKey.get(key).push(node);
            });

            const issues = [];
            byKey.forEach((duplicates) => {
                if (duplicates.length < 2) {
                    return;
                }
                duplicates.forEach((node) => {
                    const entry = declaredEntry(node);
                    issues.push(
                        issue(
                            node,
                            `The variable '${entry.name}' in store '${entry.store}' is declared by more than one node.`
                        )
                    );
                });
            });
            return issues;
        },
    };
}

/** An `event` graph must watch at least one signal. */
function eventSignalSelectionRule() {
    return {
        id: 'event-signal-selection',
        scope: 'graph',
        run: ({ graphSettings }) => {
            if (text(graphSettings?.executionType) !== 'event') {
                return [];
            }
            const signalNames = Array.isArray(graphSettings?.signalNames)
                ? graphSettings.signalNames.map(text).filter(Boolean)
                : [];
            if (signalNames.length > 0) {
                return [];
            }
            return [
                graphIssue(
                    'This event graph has no signals selected: pick at least one signal in the graph settings.'
                ),
            ];
        },
    };
}

/** Every watched signal must be produced by a `signal-post` node in the collection. */
function eventSignalProducerRule() {
    return {
        id: 'event-signal-producer',
        scope: 'collection',
        run: ({ graphSettings, collectionNodes }) => {
            if (text(graphSettings?.executionType) !== 'event') {
                return [];
            }
            const signalNames = Array.isArray(graphSettings?.signalNames)
                ? graphSettings.signalNames.map(text).filter(Boolean)
                : [];
            if (signalNames.length === 0) {
                return [];
            }
            const allNodes = Array.isArray(collectionNodes) ? collectionNodes : [];
            const produced = new Set(
                allNodes
                    .filter((node) => bareType(node?.type) === 'signal-post')
                    .map((node) => signalNameOf(node))
                    .filter(Boolean)
            );
            return signalNames
                .filter((name) => !produced.has(name))
                .map((name) =>
                    graphIssue(`No signal-post node produces the signal '${name}'.`)
                );
        },
    };
}

