// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for the structure of the main (hamburger) menu.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

function createGraphStub(id, name) {
    return { getId: () => id, getName: () => name };
}

class MockCollection {
    constructor({ id = 'col-1', title = 'Collection One', graphs = [] } = {}) {
        this._id = id;
        this._title = title;
        this._graphs = graphs;
        this._listeners = new Set();
        this._historyManager = {
            canUndo: () => false,
            canRedo: () => false,
            undo: () => false,
            redo: () => false,
        };
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollection only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    getId() {
        return this._id;
    }

    getTitle() {
        return this._title;
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    getTargetId() {
        return 'esp32';
    }

    getHistoryManager() {
        return this._historyManager;
    }

    getGraphArray() {
        return this._graphs.slice();
    }

    getActiveGraph() {
        return this._graphs[0] || null;
    }
}

class MockWorkspace {
    constructor(collection) {
        this.collections = new Map([[collection.getId(), collection]]);
        this.activeCollectionId = collection.getId();
        this.collectionManager = { removeGraph: () => true };
    }

    on() {
        return () => {};
    }

    getCollectionIds() {
        return Array.from(this.collections.keys());
    }

    getActiveCollectionId() {
        return this.activeCollectionId;
    }

    getActiveCollection() {
        return this.collections.get(this.activeCollectionId) || null;
    }

    listAvailableRuntimes() {
        return [{ id: 'general', name: 'General' }];
    }

    listTargetsForRuntime() {
        return [{ id: 'esp32', name: 'ESP32' }];
    }
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const localeRoot = path.resolve(testDir, '../../src/micro_otter/nodes/html/locales');

function readLocale(name) {
    return JSON.parse(fs.readFileSync(path.join(localeRoot, `${name}.json`), 'utf8'));
}

let dom;
let container;

function setupDom() {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.EventTarget = dom.window.EventTarget;
    global.CustomEvent = dom.window.CustomEvent;
    global.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };

    container = document.createElement('div');
    document.body.appendChild(container);
}

function teardownDom() {
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.HTMLElement;
    delete global.EventTarget;
    delete global.CustomEvent;
    delete global.ResizeObserver;
}

/**
 * Expected top-level hamburger menu: three daily leaves, then the action groups.
 */
const HAMBURGER_LEAVES = [
    {
        id: 'create-collection',
        label: 'menu.item.createCollection',
        icon: IconProvider.addCollection,
    },
    {
        id: 'upload-to-device',
        label: 'menu.item.uploadToDevice',
        icon: IconProvider.deployCollection,
    },
    { id: 'delete-collection', label: 'menu.item.deleteCollection', icon: IconProvider.delete },
];

/**
 * Expected action groups; `children` are the ids of the side menu in order.
 */
const HAMBURGER_GROUPS = [
    {
        id: 'group-collection',
        label: 'menu.group.collection',
        icon: IconProvider.syncCollection,
        children: ['download-json', 'upload-json'],
    },
    {
        id: 'group-database',
        label: 'menu.group.database',
        icon: IconProvider.hardDrive,
        children: ['backup-db', 'restore-db'],
    },
    {
        id: 'group-target-config',
        label: 'menu.group.targetConfig',
        icon: IconProvider.dataObject,
        children: [
            'upload-target-config',
            'download-target-config-template',
            'download-current-target-config',
            'backup-target-config-db',
            'restore-target-config-db',
        ],
    },
    {
        id: 'group-info',
        label: 'menu.group.info',
        icon: IconProvider.info,
        children: ['select-language', 'about', 'privacy-notice'],
    },
];

/**
 * Handler method each menu id has to reach.
 */
const MENU_ID_HANDLERS = {
    'create-collection': '_handleCreateCollection',
    'upload-to-device': '_handleUploadToDevice',
    'delete-collection': '_handleDeleteCollection',
    'download-json': '_handleExportCollection',
    'upload-json': '_handleImportCollection',
    'backup-db': '_handleBackupDB',
    'restore-db': '_handleRestoreDB',
    'upload-target-config': '_handleUploadTargetConfig',
    'download-target-config-template': '_handleDownloadTargetConfigTemplate',
    'download-current-target-config': '_handleDownloadCurrentTargetConfig',
    'backup-target-config-db': '_handleBackupTargetConfigDB',
    'restore-target-config-db': '_handleRestoreTargetConfigDB',
    'select-language': '_handleLanguageSwitch',
    about: '_handleShowAbout',
    'privacy-notice': '_handleOpenPrivacyNotice',
};

describe('WorkspaceView hamburger menu structure', () => {
    beforeEach(setupDom);
    afterEach(teardownDom);

    /**
     * Build a view whose active collection holds `graphCount` graphs.
     * @param {object} [options] - Options.
     * @param {number} [options.graphCount] - Number of graphs of the collection, two by default.
     * @returns {object} The attached view.
     */
    function createView({ graphCount = 2 } = {}) {
        const graphs = [];
        for (let index = 1; index <= graphCount; index += 1) {
            graphs.push(createGraphStub(`graph-${index}`, `Graph ${index}`));
        }

        const collection = new MockCollection({ graphs });
        const workspace = new MockWorkspace(collection);
        const view = new WorkspaceView({ workspace, viewManager: {} });
        view.attachTo(container);

        return view;
    }

    /**
     * Top-level ids of a built menu, with separators spelled out.
     * @param {Array} items - Built menu entries.
     * @returns {string[]} Ids and `'separator'` markers in order.
     */
    function topLevelIds(items) {
        return items.map((item) => (item.type === 'separator' ? 'separator' : item.id));
    }

    it('orders three leaf actions, the action groups and the info group', () => {
        const items = createView()._buildMenuItems({ canUpload: true });

        assert.deepEqual(topLevelIds(items), [
            'create-collection',
            'upload-to-device',
            'delete-collection',
            'separator',
            'group-collection',
            'group-database',
            'group-target-config',
            'separator',
            'group-info',
        ]);

        for (const leaf of HAMBURGER_LEAVES) {
            const entry = items.find((item) => item.id === leaf.id);
            assert.equal(entry.label, leaf.label, `${leaf.id} keeps its translation key`);
            assert.equal(entry.icon, leaf.icon, `${leaf.id} keeps its icon`);
        }
    });

    it('does not offer Delete Graph from the hamburger menu', () => {
        const items = createView()._buildMenuItems({ canUpload: true });

        assert.equal(
            items.find((item) => item.id === 'delete-graph'),
            undefined,
            'Delete Graph belongs to the graph-tab context menu'
        );
    });

    it('hosts one MenuView per group with the expected children', () => {
        const items = createView()._buildMenuItems({ canUpload: true });

        for (const group of HAMBURGER_GROUPS) {
            const entry = items.find((item) => item.id === group.id);
            assert.ok(entry, `missing group ${group.id}`);
            assert.equal(entry.type, 'menuview', `${group.id} renders as a submenu row`);
            assert.equal(entry.label, group.label, `${group.id} label`);
            assert.equal(entry.icon, group.icon, `${group.id} icon`);
            assert.ok(entry.menu instanceof MenuView, `${group.id} hosts a MenuView`);
            assert.equal(entry.menu.title, group.label, `${group.id} menu title`);
            assert.deepEqual(
                entry.menu.items.map((child) => child.id),
                group.children,
                `${group.id} children`
            );
        }
    });

    it('keeps every leaf inside exactly one group', () => {
        const items = createView()._buildMenuItems({ canUpload: true });
        const topLevelIds_ = topLevelIds(items);
        const childIds = HAMBURGER_GROUPS.flatMap((group) => group.children);

        for (const id of childIds) {
            assert.equal(
                topLevelIds_.includes(id),
                false,
                `${id} must not be a top-level row any more`
            );
        }

        const builtChildIds = items
            .filter((item) => item.type === 'menuview')
            .flatMap((item) => item.menu.items.map((child) => child.id));
        assert.deepEqual(builtChildIds.sort(), childIds.slice().sort());
    });

    it('disables upload-to-device without a compatible device', () => {
        const view = createView();

        const blocked = view._buildMenuItems({ canUpload: false });
        assert.equal(blocked.find((item) => item.id === 'upload-to-device').disabled, true);

        const allowed = view._buildMenuItems({ canUpload: true });
        assert.notEqual(allowed.find((item) => item.id === 'upload-to-device').disabled, true);
    });

    it('dispatches every menu id to exactly one handler', () => {
        const view = createView();
        const warnings = [];
        view._log = (event, level) => {
            if (level === 'warn') {
                warnings.push(event);
            }
        };

        const calls = [];
        for (const [id, method] of Object.entries(MENU_ID_HANDLERS)) {
            assert.equal(
                typeof view[method],
                'function',
                `${id} must still be handled by ${method}`
            );
            view[method] = () => calls.push(id);
        }

        for (const id of Object.keys(MENU_ID_HANDLERS)) {
            calls.length = 0;
            view._handleMenuItemSelect({ id, label: id });
            assert.deepEqual(calls, [id], `${id} must reach exactly one handler`);
        }

        assert.deepEqual(warnings, [], 'no unknown-menu-item warning for a known id');
    });

    it('warns about an unknown id instead of throwing', () => {
        const view = createView();
        const warnings = [];
        view._log = (event, level, data) => warnings.push({ event, level, data });

        view._handleMenuItemSelect({ id: 'does-not-exist', label: 'Unknown' });

        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].event, 'unknown-menu-item');
        assert.equal(warnings[0].level, 'warn');
        assert.equal(warnings[0].data.itemId, 'does-not-exist');
    });

    it('defines the same menu.group keys in both locales', () => {
        const en = readLocale('en').menu?.group || {};
        const de = readLocale('de').menu?.group || {};

        assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
        assert.deepEqual(Object.keys(en).sort(), [
            'collection',
            'database',
            'info',
            'targetConfig',
        ]);

        for (const key of Object.keys(en)) {
            assert.ok(en[key].length > 0, `en menu.group.${key} must not be empty`);
            assert.ok(de[key].length > 0, `de menu.group.${key} must not be empty`);
        }
    });
});

describe('WorkspaceView hamburger menu submenus', () => {
    let layer;
    let overlays;
    let view;

    beforeEach(async () => {
        setupDom();

        layer = document.createElement('div');
        layer.className = 'overlay-layer';
        // JSDOM has no layout: stub the host bounds OverlayWindow clamps against.
        Object.defineProperty(layer, 'clientWidth', { value: 1024, configurable: true });
        Object.defineProperty(layer, 'clientHeight', { value: 768, configurable: true });
        document.body.appendChild(layer);

        overlays = [];
        const viewManager = {
            addOverlay: (overlay) => {
                overlays.push(overlay);
                overlay.attachTo(layer);
                return overlay;
            },
            showConfirmation: async () => true,
            showModal: () => {},
        };

        const collection = new MockCollection({
            graphs: [createGraphStub('graph-1', 'Graph 1'), createGraphStub('graph-2', 'Graph 2')],
        });
        view = new WorkspaceView({ workspace: new MockWorkspace(collection), viewManager });
        view.attachTo(container);

        await view._handleHamburgerClick();
    });

    afterEach(async () => {
        for (const overlay of overlays) {
            overlay.detach?.();
        }
        // Flush the deferred click-away registration of the menus before the DOM globals go away.
        await new Promise((resolve) => setTimeout(resolve, 0));
        teardownDom();
    });

    /**
     * Row of a menu id inside any open menu.
     * @param {string} id - Entry id.
     * @returns {HTMLElement} The rendered row.
     */
    function row(id) {
        return layer.querySelector(`[data-item-id="${id}"]`);
    }

    /**
     * Overlay windows currently in the layer.
     * @returns {HTMLElement[]} Overlay window elements.
     */
    function windows() {
        return Array.from(layer.querySelectorAll('.overlay-window'));
    }

    it('registers the root menu as the only overlay', () => {
        assert.equal(overlays.length, 1);
        assert.equal(windows().length, 1);
        assert.ok(row('group-collection'), 'group row rendered');
        assert.equal(row('download-json'), null, 'children stay hidden until the group opens');
    });

    it('opens a group next to the parent menu and keeps the parent open', () => {
        row('group-collection').click();

        assert.equal(windows().length, 2, 'child window attached to the same layer');
        assert.equal(row('group-collection').getAttribute('aria-expanded'), 'true');

        const child = windows()[1].querySelector('.menu');
        assert.equal(child.getAttribute('aria-label'), 'menu.group.collection');
        assert.deepEqual(
            Array.from(child.querySelectorAll('[data-item-id]')).map((el) =>
                el.getAttribute('data-item-id')
            ),
            ['download-json', 'upload-json']
        );
        assert.equal(
            windows()[0].contains(row('create-collection')),
            true,
            'parent still attached'
        );
    });

    it('closes only the child when another group opens', () => {
        row('group-collection').click();
        row('group-database').click();

        assert.equal(windows().length, 2, 'one child at a time');
        assert.equal(row('group-collection').getAttribute('aria-expanded'), 'false');
        assert.equal(row('group-database').getAttribute('aria-expanded'), 'true');
        assert.ok(row('backup-db'), 'database child rows are rendered');
        assert.equal(row('download-json'), null, 'collection child is gone');
    });

    it('routes a child selection into the workspace handler and closes the stack', () => {
        const selected = [];
        view._handleExportCollection = () => selected.push('export');

        row('group-collection').click();
        row('download-json').click();

        assert.deepEqual(selected, ['export']);
        assert.equal(windows().length, 0, 'parent and child are both gone');
    });
});
