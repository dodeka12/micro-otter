// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';

import { I18nService } from '../../src/micro_otter/nodes/html/js/i18n/i18n-service.js';
import { ViewManager } from '../../src/micro_otter/nodes/html/js/views/view-manager.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

/**
 * Mock fetch for testing without network requests
 * @param {object} responses - Map of URL to the fake response to return
 */
function mockFetch(responses) {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (url, _options) => {
        const response = responses[url];
        if (!response) {
            return Promise.resolve({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });
        }
        
        if (response.error) {
            return Promise.reject(new Error(response.error));
        }
        
        return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(response.data),
        });
    };
    
    return () => {
        globalThis.fetch = originalFetch;
    };
}

/**
 * Mock DOM element for testing
 */
class MockElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.classList = {
            add: () => {},
            remove: () => {},
            contains: () => false,
        };
    }
    
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    
    replaceChildren(...nodes) {
        this.children = nodes;
    }
    
    querySelector() {
        return null;
    }
    
    querySelectorAll() {
        return [];
    }
    
    setAttribute() {}
    getAttribute() { return null; }
    removeAttribute() {}
}

/**
 * Create a minimal DOM environment for testing
 */
function setupMockDOM() {
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
        createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    };
    
    globalThis.HTMLElement = MockElement;
    globalThis.window = globalThis;
    
    return () => {
        delete globalThis.document;
        delete globalThis.HTMLElement;
        delete globalThis.window;
    };
}

/**
 * Standard mock translations for testing
 */
function getMockTranslations() {
    const mockManifest = {
        defaultLocale: 'en',
        locales: [
            { code: 'en', label: 'English', file: 'en.json', icon: 'icon-en.svg' },
            { code: 'de', label: 'Deutsch', file: 'de.json', icon: 'icon-de.svg' },
        ],
    };
    
    const mockEnTranslations = {
        view: {
            untitled: 'Untitled View',
            splitView: 'Split View',
            tabbedView: 'Tabbed View',
        },
        dialog: {
            confirm: 'Confirm',
            cancel: 'Cancel',
        },
        test: {
            greeting: 'Hello, {{name}}!',
        },
    };
    
    const mockDeTranslations = {
        view: {
            untitled: 'Unbenannte Ansicht',
            splitView: 'Geteilte Ansicht',
            tabbedView: 'Registeransicht',
        },
        dialog: {
            confirm: 'Bestätigen',
            cancel: 'Abbrechen',
        },
        test: {
            greeting: 'Hallo, {{name}}!',
        },
    };
    
    return {
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
        '/html/locales/de.json': { data: mockDeTranslations },
        '/html/themes/themes.json': { data: { themes: [{ id: 'sandbox', file: 'sandbox.css' }] } },
    };
}

test('ViewManager integrates I18nService instance', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const manager = new ViewManager({ 
            i18nService,
            logEvents: false,
        });
        
        assert.strictEqual(manager.i18nService, i18nService);
        assert.strictEqual(manager.i18nService.currentLocale, 'en');
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('ViewManager creates default I18nService if not provided', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        const manager = new ViewManager({ logEvents: false });
        
        // Should create a default I18nService
        assert.ok(manager.i18nService instanceof I18nService);
        
        // Wait for async load to complete
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('ViewBase receives i18nService and can translate', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const view = new ViewBase({
            title: 'Test View',
            i18nService,
        });
        
        // View can translate keys
        assert.equal(view.t('dialog.confirm'), 'Confirm');
        assert.equal(view.t('test.greeting', { name: 'Alice' }), 'Hello, Alice!');
    } finally {
        restoreFetch();
    }
});

test('ViewBase without i18nService returns keys', async () => {
    const view = new ViewBase({
        title: 'Test View',
    });
    
    // Without i18nService, t() returns the key
    assert.equal(view.t('dialog.confirm'), 'dialog.confirm');
    assert.equal(view.t('test.greeting'), 'test.greeting');
});

test('ViewBase subscribes to language changes', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const view = new ViewBase({
            title: 'Test View',
            i18nService,
        });
        
        let changeCount = 0;
        let lastEvent = null;
        
        // Subscribe to language changes
        view._subscribeToLanguageChanges((event) => {
            changeCount++;
            lastEvent = event;
        });
        
        // Change language
        await i18nService.setLocale('de');
        
        assert.equal(changeCount, 1);
        assert.ok(lastEvent);
        assert.equal(lastEvent.detail.locale, 'de');
        assert.equal(lastEvent.detail.previousLocale, 'en');
        
        // Cleanup
        view._unsubscribeFromLanguageChanges();
        
        // Should not receive more events after cleanup
        await i18nService.setLocale('en');
        assert.equal(changeCount, 1); // Still 1, not incremented
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('ViewFactory passes i18nService to deserialized views', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const factory = new ViewFactory({ i18nService });
        
        const viewData = {
            type: 'ViewBase',
            id: 'test-view',
            title: 'Test View',
        };
        
        const view = factory.create(viewData);
        
        // View should have received i18nService
        assert.equal(view.t('dialog.confirm'), 'Confirm');
    } finally {
        restoreFetch();
    }
});

test('SplitView children receive i18nService through factory', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const factory = new ViewFactory({ i18nService });
        
        const splitData = {
            type: 'SplitView',
            id: 'split-1',
            orientation: 'horizontal',
            views: [
                { type: 'ViewBase', id: 'child-1', title: 'Child 1' },
                { type: 'ViewBase', id: 'child-2', title: 'Child 2' },
            ],
        };
        
        const splitView = factory.create(splitData);
        
        // SplitView should have i18nService
        assert.equal(splitView.t('dialog.confirm'), 'Confirm');
        
        // Children should also have i18nService
        const children = splitView.views;
        assert.equal(children.length, 2);
        assert.equal(children[0].t('dialog.confirm'), 'Confirm');
        assert.equal(children[1].t('dialog.confirm'), 'Confirm');
    } finally {
        restoreFetch();
    }
});

test('TabbedView children receive i18nService through factory', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const factory = new ViewFactory({ i18nService });
        
        const tabbedData = {
            type: 'TabbedView',
            id: 'tabbed-1',
            views: [
                { type: 'ViewBase', id: 'tab-1', title: 'Tab 1' },
                { type: 'ViewBase', id: 'tab-2', title: 'Tab 2' },
            ],
        };
        
        const tabbedView = factory.create(tabbedData);
        
        // TabbedView should have i18nService
        assert.equal(tabbedView.t('dialog.confirm'), 'Confirm');
        
        // Children should also have i18nService
        const children = tabbedView.views;
        assert.equal(children.length, 2);
        assert.equal(children[0].t('dialog.confirm'), 'Confirm');
        assert.equal(children[1].t('dialog.confirm'), 'Confirm');
    } finally {
        restoreFetch();
    }
});

test('Multiple views update when language changes', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const view1 = new ViewBase({ title: 'View 1', i18nService });
        const view2 = new ViewBase({ title: 'View 2', i18nService });
        const view3 = new ViewBase({ title: 'View 3', i18nService });
        
        let view1Updates = 0;
        let view2Updates = 0;
        let view3Updates = 0;
        
        view1._subscribeToLanguageChanges(() => view1Updates++);
        view2._subscribeToLanguageChanges(() => view2Updates++);
        view3._subscribeToLanguageChanges(() => view3Updates++);
        
        // All views start with English
        assert.equal(view1.t('dialog.confirm'), 'Confirm');
        assert.equal(view2.t('dialog.confirm'), 'Confirm');
        assert.equal(view3.t('dialog.confirm'), 'Confirm');
        
        // Switch to German
        await i18nService.setLocale('de');
        
        // All callbacks should have been called
        assert.equal(view1Updates, 1);
        assert.equal(view2Updates, 1);
        assert.equal(view3Updates, 1);
        
        // All views now translate to German
        assert.equal(view1.t('dialog.confirm'), 'Bestätigen');
        assert.equal(view2.t('dialog.confirm'), 'Bestätigen');
        assert.equal(view3.t('dialog.confirm'), 'Bestätigen');
        
        // Switch back to English
        await i18nService.setLocale('en');
        
        assert.equal(view1Updates, 2);
        assert.equal(view2Updates, 2);
        assert.equal(view3Updates, 2);
        
        assert.equal(view1.t('dialog.confirm'), 'Confirm');
        assert.equal(view2.t('dialog.confirm'), 'Confirm');
        assert.equal(view3.t('dialog.confirm'), 'Confirm');
        
        // Cleanup
        view1._unsubscribeFromLanguageChanges();
        view2._unsubscribeFromLanguageChanges();
        view3._unsubscribeFromLanguageChanges();
    } finally {
        restoreFetch();
    }
});

test('Nested views all receive i18nService', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const factory = new ViewFactory({ i18nService });
        
        // Create deeply nested structure
        const data = {
            type: 'SplitView',
            id: 'root',
            views: [
                {
                    type: 'TabbedView',
                    id: 'tabs-1',
                    views: [
                        { type: 'ViewBase', id: 'leaf-1', title: 'Leaf 1' },
                        { type: 'ViewBase', id: 'leaf-2', title: 'Leaf 2' },
                    ],
                },
                {
                    type: 'SplitView',
                    id: 'split-2',
                    orientation: 'vertical',
                    views: [
                        { type: 'ViewBase', id: 'leaf-3', title: 'Leaf 3' },
                        { type: 'ViewBase', id: 'leaf-4', title: 'Leaf 4' },
                    ],
                },
            ],
        };
        
        const rootView = factory.create(data);
        
        // Root can translate
        assert.equal(rootView.t('dialog.confirm'), 'Confirm');
        
        // First level children
        const firstLevel = rootView.views;
        assert.equal(firstLevel.length, 2);
        assert.equal(firstLevel[0].t('dialog.confirm'), 'Confirm');
        assert.equal(firstLevel[1].t('dialog.confirm'), 'Confirm');
        
        // Second level children (leaves)
        const tabbedChildren = firstLevel[0].views;
        assert.equal(tabbedChildren.length, 2);
        assert.equal(tabbedChildren[0].t('dialog.confirm'), 'Confirm');
        assert.equal(tabbedChildren[1].t('dialog.confirm'), 'Confirm');
        
        const splitChildren = firstLevel[1].views;
        assert.equal(splitChildren.length, 2);
        assert.equal(splitChildren[0].t('dialog.confirm'), 'Confirm');
        assert.equal(splitChildren[1].t('dialog.confirm'), 'Confirm');
        
        // Change language - all views should translate to German
        await i18nService.setLocale('de');
        
        assert.equal(rootView.t('dialog.confirm'), 'Bestätigen');
        assert.equal(firstLevel[0].t('dialog.confirm'), 'Bestätigen');
        assert.equal(firstLevel[1].t('dialog.confirm'), 'Bestätigen');
        assert.equal(tabbedChildren[0].t('dialog.confirm'), 'Bestätigen');
        assert.equal(tabbedChildren[1].t('dialog.confirm'), 'Bestätigen');
        assert.equal(splitChildren[0].t('dialog.confirm'), 'Bestätigen');
        assert.equal(splitChildren[1].t('dialog.confirm'), 'Bestätigen');
    } finally {
        restoreFetch();
    }
});

test('ViewBase lifecycle cleanup unsubscribes from language changes', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        const i18nService = new I18nService();
        await i18nService.load();
        
        const view = new ViewBase({
            title: 'Test View',
            i18nService,
        });
        
        let changeCount = 0;
        view._subscribeToLanguageChanges(() => changeCount++);
        
        // Attach view to trigger lifecycle
        const container = new MockElement();
        view.attachTo(container);
        
        // Change language - should fire
        await i18nService.setLocale('de');
        assert.equal(changeCount, 1);
        
        // Detach view (triggers beforeDetach and cleanup)
        view.detach();
        
        // Change language again - should NOT fire after detach
        await i18nService.setLocale('en');
        assert.equal(changeCount, 1); // Still 1, not incremented
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('ViewManager exposes i18nEvents for listening', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        const manager = new ViewManager({ logEvents: false });
        
        // Wait for async load
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // i18nEvents should be the EventTarget
        assert.ok(manager.i18nEvents);
        assert.equal(typeof manager.i18nEvents.addEventListener, 'function');
        
        let eventFired = false;
        manager.i18nEvents.addEventListener('languagechange', () => {
            eventFired = true;
        });
        
        await manager.i18nService.setLocale('de');
        assert.ok(eventFired);
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('I18nService integration with ViewManager and ViewFactory', async () => {
    const restoreFetch = mockFetch(getMockTranslations());
    const restoreDOM = setupMockDOM();
    
    try {
        // Create manager with default i18n (will create its own)
        const manager = new ViewManager({ logEvents: false });
        
        // Wait for async load
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Create a view through the factory
        const viewData = {
            type: 'ViewBase',
            id: 'test-1',
            title: 'Test View',
        };
        
        const view = manager.viewFactory.create(viewData);
        
        // View should be able to translate
        assert.equal(view.t('dialog.confirm'), 'Confirm');
        
        // Change language
        await manager.i18nService.setLocale('de');
        
        // View should now translate to German
        assert.equal(view.t('dialog.confirm'), 'Bestätigen');
    } finally {
        restoreFetch();
        restoreDOM();
    }
});

test('GraphPanelView updates node control labels on language change', async () => {
    const restoreFetch = mockFetch(getMockTranslations());

    try {
        const i18nService = new I18nService();
        await i18nService.load();

        const node = new NodeData({
            id: 'node-1',
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            controls: [
                {
                    id: 'value',
                    type: 'text',
                    label: { en: 'Value', de: 'Wert' },
                    default: '',
                },
            ],
            controlValues: {},
            inputs: [],
            outputs: [],
            inputDefaults: {},
            collapsed: false,
        });

        const graph = {
            id: 'graph-1',
            getName: () => 'Graph 1',
            getNodeIds: () => [node.getId()],
            getNodes: () => [node],
            getNode: (nodeId) => (nodeId === node.getId() ? node : null),
            getConnections: () => [],
            on: () => () => {},
            updateNode: (nodeId, patch) => {
                if (nodeId !== node.getId()) {
                    return null;
                }
                Object.assign(node, patch);
                return node;
            },
        };

        const view = new GraphPanelView({
            graph,
            i18nService,
        });

        view.syncNodeUisFromGraph();
        const nodeUi = view.nodeUiMap.get(node.getId());
        assert.ok(nodeUi, 'Expected node UI to exist');

        const controlUi = nodeUi.controlInstances.get('value');
        assert.ok(controlUi, 'Expected control UI instance to exist');
        assert.equal(controlUi._getLocalizedLabel(), 'Value');

        let renderCalls = 0;
        view.renderPanel = () => {
            renderCalls += 1;
        };

        view.afterAttach();
        await i18nService.setLocale('de');

        assert.equal(i18nService.currentLocale, 'de');
        assert.equal(controlUi._getLocalizedLabel(), 'Wert');
        assert.ok(renderCalls >= 1, 'Expected GraphPanelView to react to languagechange');

        view.beforeDetach();
        view.dispose();
    } finally {
        restoreFetch();
    }
});
