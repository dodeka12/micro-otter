// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Organizational palette entries: graph items in the node palette and their drag payload.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import {
    DOCUMENTATION_AREA_GRAPH_ITEM_ID,
    FUNCTION_INPUT_GRAPH_ITEM_ID,
    FUNCTION_OUTPUT_GRAPH_ITEM_ID,
    ORGANIZATIONAL_CATEGORY,
    ORGANIZATIONAL_PALETTE_ENTRIES,
    isOrganizationalEntry,
} from '../../src/micro_otter/nodes/html/js/nodes/organizational-palette.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import { NodePaletteView } from '../../src/micro_otter/nodes/html/js/views/node-palette-view.js';

const NODE_TYPES = {
    console: {
        title: 'Console',
        category: 'debug',
        color: '#334455',
        info: 'Prints to the console',
        inputs: [],
        outputs: [],
    },
};

function createRuntime({ withNodeTypes = true } = {}) {
    return {
        nodePackages: withNodeTypes
            ? [
                  {
                      id: 'core',
                      name: 'Core',
                      nodeTypes: new Map(Object.entries(NODE_TYPES)),
                  },
              ]
            : [],
        getNodeType: (typeId) => NODE_TYPES[typeId] ?? null,
    };
}

function createI18n(translations = {}) {
    return {
        t: (key) => translations[key] ?? key,
        addEventListener: () => {},
        removeEventListener: () => {},
        getCurrentLanguage: () => 'en',
    };
}

/**
 * Minimal observable graph whose execution type the tests can change.
 * @param {string} executionType - Initial execution type.
 * @returns {object} Graph stub with `getExecutionType`, `setExecutionType` and `on`.
 */
function createPaletteGraph(executionType) {
    const listeners = new Map();
    return {
        getExecutionType: () => executionType,
        setExecutionType: (value) => {
            executionType = value;
            (listeners.get('executionType') ?? []).forEach((listener) => listener({}));
        },
        on: (eventName, listener) => {
            if (!listeners.has(eventName)) {
                listeners.set(eventName, []);
            }
            listeners.get(eventName).push(listener);
            return () => {};
        },
    };
}

/**
 * Minimal collection manager exposing one active collection with one graph.
 * @param {object} graph - Graph stub returned as the active graph.
 * @returns {object} Collection-manager stub.
 */
function createPaletteCollectionManager(graph) {
    return {
        getActiveCollection: () => ({
            getActiveGraph: () => graph,
            on: () => () => {},
        }),
        on: () => () => {},
    };
}

describe('organizational palette entries', () => {
    it('exposes the documentation area and both structural function nodes', () => {
        assert.deepEqual(
            ORGANIZATIONAL_PALETTE_ENTRIES.map((entry) => entry.id),
            [DOCUMENTATION_AREA_GRAPH_ITEM_ID, FUNCTION_INPUT_GRAPH_ITEM_ID, FUNCTION_OUTPUT_GRAPH_ITEM_ID]
        );

        for (const entry of ORGANIZATIONAL_PALETTE_ENTRIES) {
            assert.equal(entry.type, 'graph-item');
            assert.equal(entry.category, ORGANIZATIONAL_CATEGORY);
            assert.equal(typeof entry.title.en, 'string');
            assert.equal(typeof entry.title.de, 'string');
        }
    });

    it('marks only the structural nodes as function-graph only', () => {
        const byId = new Map(ORGANIZATIONAL_PALETTE_ENTRIES.map((entry) => [entry.id, entry]));

        assert.equal(byId.get(DOCUMENTATION_AREA_GRAPH_ITEM_ID).visibleFor, undefined);
        assert.equal(byId.get(FUNCTION_INPUT_GRAPH_ITEM_ID).visibleFor, 'function-graph');
        assert.equal(byId.get(FUNCTION_OUTPUT_GRAPH_ITEM_ID).visibleFor, 'function-graph');
    });

    it('uses an icon that already exists in the IconProvider registry', () => {
        for (const entry of ORGANIZATIONAL_PALETTE_ENTRIES) {
            assert.equal(IconProvider.has(entry.icon), true, `${entry.icon} is not registered`);
        }
    });

    it('recognizes its own ids only', () => {
        assert.equal(isOrganizationalEntry(DOCUMENTATION_AREA_GRAPH_ITEM_ID), true);
        assert.equal(isOrganizationalEntry('console'), false);
    });
});

describe('NodePaletteView organizational section', () => {
    let harness;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        harness.cleanup();
    });

    function createView({ withNodeTypes = true, i18nService = createI18n() } = {}) {
        return new NodePaletteView({
            deviceRuntime: createRuntime({ withNodeTypes }),
            workspaceConfig: {},
            i18nService,
            logger: { log: () => {} },
        });
    }

    function createCollectionView(graph) {
        return new NodePaletteView({
            deviceRuntime: createRuntime(),
            collectionManager: createPaletteCollectionManager(graph),
            workspaceConfig: {},
            i18nService: createI18n(),
            logger: { log: () => {} },
        });
    }

    it('hides the structural function nodes outside a function graph', () => {
        const view = createCollectionView(createPaletteGraph('continuous'));
        view.attachTo(container);

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.equal(organizational.querySelectorAll('.node-type-ui[data-graph-item="true"]').length, 1);

        view.detach();
    });

    it('lists the structural function nodes for a function graph', () => {
        const view = createCollectionView(createPaletteGraph('function'));
        view.attachTo(container);

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.equal(organizational.querySelectorAll('.node-type-ui[data-graph-item="true"]').length, 3);

        view.detach();
    });

    it('re-renders when the active graph switches to function', () => {
        const graph = createPaletteGraph('continuous');
        const view = createCollectionView(graph);
        view.attachTo(container);

        graph.setExecutionType('function');

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.equal(organizational.querySelectorAll('.node-type-ui[data-graph-item="true"]').length, 3);

        view.detach();
    });

    it('pins an Organizational section above the node categories', () => {
        const view = createView();
        view.attachTo(container);
        // Small cards show only the icon; switch to large so the labels are rendered.
        container.querySelector('.node-palette-view__size-toggle')?.click();

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.ok(organizational, 'expected a pinned Organizational section');
        assert.equal(
            organizational.querySelector('.node-palette-view__section-heading').textContent,
            'Organizational'
        );

        // The section sits directly below the toolbar, above Favorites and the node list.
        const wrapper = container.querySelector('.node-palette-view');
        assert.equal(wrapper.children[0], container.querySelector('.node-palette-view__toolbar'));
        assert.equal(wrapper.children[1], organizational);

        // Graph items never appear as a node category group.
        const sectionNames = Array.from(
            container.querySelectorAll('.collapsible-section__name')
        ).map((element) => element.textContent);
        assert.deepEqual(sectionNames, ['debug']);

        const graphItemCards = Array.from(
            container.querySelectorAll('.node-type-ui[data-graph-item="true"]')
        );
        assert.equal(graphItemCards.length, 1);
        assert.equal(graphItemCards[0].parentElement, organizational.querySelector(
            '.node-palette-view__section-grid'
        ));
        assert.equal(
            graphItemCards[0].querySelector('.node-type-ui__name').textContent,
            'Documentation Area'
        );

        view.detach();
    });

    it('keeps the Organizational section when sorting alphabetically', () => {
        const view = createView();
        view.attachTo(container);

        container.querySelector('.node-palette-view__org-button[data-mode="alphabetical"]')?.click();

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.ok(organizational);
        assert.equal(
            organizational.querySelectorAll('.node-type-ui[data-graph-item="true"]').length,
            1
        );

        const grid = container.querySelector('.node-palette-view__grid');
        assert.ok(grid);
        assert.equal(
            grid.querySelectorAll('.node-type-ui[data-graph-item="true"]').length,
            0,
            'graph items must stay out of the alphabetical grid'
        );
        assert.equal(grid.querySelectorAll('.node-type-ui').length, 1);

        view.detach();
    });

    it('renders only the Organizational section without node packages', () => {
        const view = createView({ withNodeTypes: false });
        view.attachTo(container);

        const organizational = container.querySelector('.node-palette-view__organizational');
        assert.ok(organizational);
        assert.equal(
            organizational.querySelectorAll('.node-type-ui[data-graph-item="true"]').length,
            1
        );
        assert.equal(container.querySelectorAll('.collapsible-section').length, 0);

        view.detach();
    });

    it('filters down to the entry when searching for doc', async () => {
        const view = createView();
        view.attachTo(container);

        const search = container.querySelector('.node-palette-view__search-input');
        search.value = 'doc';
        search.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 220));

        const cards = container.querySelectorAll('.node-type-ui');
        assert.equal(cards.length, 1);
        assert.equal(cards[0].getAttribute('data-graph-item'), 'true');

        view.detach();
    });

    it('takes the labels from the locale when translations exist', () => {
        const view = createView({
            i18nService: createI18n({
                'nodePalette.organizational': 'Organisatorisch',
                'nodePalette.graphItems.documentationArea.title': 'Dokumentationsbereich',
            }),
        });
        view.attachTo(container);
        container.querySelector('.node-palette-view__size-toggle')?.click();

        assert.equal(
            container.querySelector('.node-palette-view__organizational .node-palette-view__section-heading')
                .textContent,
            'Organisatorisch'
        );
        assert.equal(
            container.querySelector('.node-type-ui[data-graph-item="true"] .node-type-ui__name')
                .textContent,
            'Dokumentationsbereich'
        );

        view.detach();
    });

    it('never records a graph item as favorite or recently used', () => {
        const workspaceConfig = {};
        const view = new NodePaletteView({
            deviceRuntime: createRuntime(),
            workspaceConfig,
            i18nService: createI18n(),
            logger: { log: () => {} },
        });
        view.attachTo(container);

        view.onNodeTypeUsed(DOCUMENTATION_AREA_GRAPH_ITEM_ID);
        view.toggleFavorite(DOCUMENTATION_AREA_GRAPH_ITEM_ID);

        assert.deepEqual(workspaceConfig.nodePalette?.recentlyUsed ?? [], []);
        assert.deepEqual(workspaceConfig.nodePalette?.favorites ?? [], []);

        view.detach();
    });

    it('starts a drag with a graph-item payload for every structural card', () => {
        const view = createCollectionView(createPaletteGraph('function'));
        view.attachTo(container);

        const cards = Array.from(
            container.querySelectorAll('.node-type-ui[data-graph-item="true"]')
        );
        assert.equal(cards.length, 3);

        const payloads = cards.map((card) => {
            const written = new Map();
            const start = new harness.window.Event('dragstart', { bubbles: true });
            start.dataTransfer = {
                setData: (type, value) => written.set(type, value),
                setDragImage: () => {},
            };
            card.dispatchEvent(start);
            card.dispatchEvent(new harness.window.Event('dragend', { bubbles: true }));
            return JSON.parse(written.get('application/json'));
        });

        assert.deepEqual(
            payloads.map(({ type, graphItemId }) => ({ type, graphItemId })),
            [
                { type: 'graph-item', graphItemId: DOCUMENTATION_AREA_GRAPH_ITEM_ID },
                { type: 'graph-item', graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID },
                { type: 'graph-item', graphItemId: FUNCTION_OUTPUT_GRAPH_ITEM_ID },
            ]
        );
        for (const payload of payloads) {
            assert.equal(
                typeof payload.nodeTypeName,
                'string',
                'the drop path forwards the display name'
            );
        }

        view.detach();
    });
});

