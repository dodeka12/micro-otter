// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Palette entries generated from function graphs.
 *
 * A function graph is published as an ordinary node type under its own palette category
 * and under the `function` package group. The tests cover the grouping, the runtime-wins
 * dedupe, the self-call and disabled exclusions, and the refresh seams.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { NodePaletteView } from '../../src/micro_otter/nodes/html/js/views/node-palette-view.js';

const I18N = {
    t: (key) => (key === 'nodePalette.functionPackage' ? 'Functions' : key),
    addEventListener: () => {},
    removeEventListener: () => {},
    getCurrentLanguage: () => 'en',
};

/**
 * Minimal function-graph stub with an event emitter.
 * @param {object} [options] - Graph fields.
 * @returns {object} Graph stub.
 */
function createGraph({
    id = 'fn-1',
    name = 'Scale Values',
    executionType = 'function',
    enabled = true,
    category = 'math',
} = {}) {
    const listeners = new Map();
    const state = { name, executionType, enabled, category };

    return {
        state,
        getId: () => id,
        getName: () => state.name,
        getExecutionType: () => state.executionType,
        getEnabled: () => state.enabled,
        getFunctionCategory: () => state.category,
        getFunctionSignature: () => ({
            category: state.category,
            inputs: [{ id: 'in_0', name: 'pin', types: ['int'] }],
            outputs: [],
        }),
        getFunctionNodeTypeId: () => `function_graph.${id}`,
        on: (eventName, listener) => {
            if (!listeners.has(eventName)) {
                listeners.set(eventName, []);
            }
            listeners.get(eventName).push(listener);
            return () => {};
        },
        emit: (eventName) => {
            (listeners.get(eventName) ?? []).forEach((listener) => listener({}));
        },
    };
}

/**
 * Collection stub exposing graphs, an active graph and an event emitter.
 * @param {object[]} graphs - Graph stubs in collection order.
 * @param {object} [options] - Options.
 * @param {string | null} [options.activeGraphId] - Id of the active graph (defaults to the first).
 * @returns {object} Collection stub.
 */
function createCollection(graphs, { activeGraphId = null } = {}) {
    const listeners = new Map();
    const findActive = () =>
        (activeGraphId ? graphs.find((graph) => graph.getId() === activeGraphId) : null) ??
        graphs[0] ??
        null;
    return {
        getGraphArray: () => graphs,
        getActiveGraph: findActive,
        on: (eventName, listener) => {
            if (!listeners.has(eventName)) {
                listeners.set(eventName, []);
            }
            listeners.get(eventName).push(listener);
            return () => {};
        },
        emit: (eventName) => {
            (listeners.get(eventName) ?? []).forEach((listener) => listener({}));
        },
    };
}

/**
 * Minimal non-function graph stub used as the graph being edited.
 * @param {string} [id] - Graph id.
 * @returns {object} Graph stub.
 */
function createEditingGraph(id = 'main') {
    return {
        getId: () => id,
        getName: () => 'Main',
        getExecutionType: () => 'continuous',
        getEnabled: () => true,
        on: () => () => {},
    };
}


/**
 * Collection-manager stub around one collection.
 * @param {object} collection - Collection stub.
 * @returns {object} Manager stub.
 */
function createCollectionManager(collection) {
    return {
        getActiveCollection: () => collection,
        on: () => () => {},
    };
}

/**
 * Build a palette view over the given collection.
 * @param {object} collection - Collection stub.
 * @param {object} [runtimeNodeTypes] - Runtime node types keyed by type id.
 * @param {string} [organizationMode] - Initial organization mode.
 * @returns {NodePaletteView} Palette view.
 */
function createPalette(collection, runtimeNodeTypes = {}, organizationMode = 'category') {
    return new NodePaletteView({
        deviceRuntime: {
            nodePackages: Object.keys(runtimeNodeTypes).length
                ? [
                      {
                          id: 'core',
                          name: 'Core',
                          nodeTypes: new Map(Object.entries(runtimeNodeTypes)),
                      },
                  ]
                : [],
            getNodeType: (typeId) => runtimeNodeTypes[typeId] ?? null,
        },
        collectionManager: createCollectionManager(collection),
        workspaceConfig: { nodePalette: { organizationMode, viewSize: 'large' } },
        i18nService: I18N,
        logger: { log: () => {} },
    });
}

/**
 * Section headings currently rendered for node types.
 *
 * The pinned Organizational section is excluded: it lists graph items, not node types.
 * @param {HTMLElement} container - Palette container.
 * @returns {string[]} Heading texts.
 */
function sectionNames(container) {
    const grid =
        container.querySelector('.node-palette-view__sections') ??
        container.querySelector('.node-palette-view__grid');
    return [...(grid?.querySelectorAll('.collapsible-section__name') ?? [])].map((element) =>
        element.textContent
    );
}

/**
 * Card labels of the listed node types (graph items excluded).
 * @param {HTMLElement} container - Palette container.
 * @returns {string[]} Card labels.
 */
function cardNames(container) {
    const grid =
        container.querySelector('.node-palette-view__sections') ??
        container.querySelector('.node-palette-view__grid');
    return [...(grid?.querySelectorAll('.node-type-ui__name') ?? [])].map((element) =>
        element.textContent
    );
}

describe('node palette function graphs', () => {
    let harness;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        // jsdom queues `<details>` toggle events; let them run while the DOM globals still
        // exist, otherwise the handler throws on the deleted `HTMLDetailsElement`.
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('lists a function graph under its own palette category', () => {
        const graph = createGraph({ name: 'Scale Values', category: 'math' });
        const view = createPalette(createCollection([createEditingGraph(), graph]));
        view.attachTo(container);

        assert.deepEqual(sectionNames(container), ['math']);
        assert.deepEqual(cardNames(container), ['Scale Values']);

        view.detach();
    });

    it('lists every function graph in the collection', () => {
        const first = createGraph({ id: 'fn-1', name: 'Scale Values', category: 'math' });
        const second = createGraph({ id: 'fn-2', name: 'Clamp', category: 'math' });
        const view = createPalette(createCollection([createEditingGraph(), first, second]));
        view.attachTo(container);

        assert.deepEqual(cardNames(container), ['Clamp', 'Scale Values']);

        view.detach();
    });

    it('groups function graphs under the function package', () => {
        const graph = createGraph({ name: 'Scale Values' });
        const view = createPalette(createCollection([createEditingGraph(), graph]), {}, 'package');
        view.attachTo(container);

        assert.deepEqual(sectionNames(container), ['Functions']);
        assert.deepEqual(cardNames(container), ['Scale Values']);

        view.detach();
    });

    it('keeps a runtime node type that already claims the generated id', () => {
        const graph = createGraph({ id: 'fn-1', name: 'Scale Values' });
        const view = createPalette(createCollection([createEditingGraph(), graph]), {
            'function_graph.fn-1': {
                title: 'Runtime Function',
                category: 'math',
                color: '#112233',
                inputs: [],
                outputs: [],
            },
        });
        view.attachTo(container);

        assert.deepEqual(cardNames(container), ['Runtime Function']);

        view.detach();
    });

    it('never lists the graph being edited or a disabled function graph', () => {
        const activeGraph = createGraph({ id: 'fn-self', name: 'Self' });
        const disabledGraph = createGraph({ id: 'fn-off', name: 'Disabled', enabled: false });
        const view = createPalette(
            createCollection([activeGraph, disabledGraph], { activeGraphId: 'fn-self' })
        );
        view.attachTo(container);

        assert.deepEqual(cardNames(container), []);
        assert.deepEqual(sectionNames(container), []);

        view.detach();
    });

    it('refreshes the label when the function graph is renamed', () => {
        const graph = createGraph({ name: 'Scale Values' });
        const collection = createCollection([createEditingGraph(), graph]);
        const view = createPalette(collection);
        view.attachTo(container);

        // The collection reports a rename of any of its graphs as `graphUpdated`.
        graph.state.name = 'Scale Twice';
        collection.emit('graphUpdated');

        assert.deepEqual(cardNames(container), ['Scale Twice']);

        view.detach();
    });

    it('drops the entry when the function graph is disabled', () => {
        const graph = createGraph({ name: 'Scale Values' });
        const collection = createCollection([createEditingGraph(), graph]);
        const view = createPalette(collection);
        view.attachTo(container);
        assert.deepEqual(cardNames(container), ['Scale Values']);

        graph.state.enabled = false;
        collection.emit('graphUpdated');

        assert.deepEqual(cardNames(container), []);

        view.detach();
    });

    it('follows a graph switch to another function graph', () => {
        const editingGraph = createGraph({ id: 'fn-self', name: 'Editing', category: 'math' });
        const otherGraph = createGraph({ id: 'fn-other', name: 'Other', category: 'logic' });
        const collection = createCollection([editingGraph], { activeGraphId: 'fn-self' });
        const view = createPalette(collection);
        view.attachTo(container);
        assert.deepEqual(cardNames(container), []);

        collection.getGraphArray = () => [editingGraph, otherGraph];
        collection.emit('graphAdded');

        assert.deepEqual(cardNames(container), ['Other']);
        assert.deepEqual(sectionNames(container), ['logic']);

        view.detach();
    });
});
