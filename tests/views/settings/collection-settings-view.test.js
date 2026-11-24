import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AppEvent, AppPayload } from '../../../src/micro_otter/nodes/html/js/core/app-event.js';

import { CollectionSettingsView } from '../../../src/micro_otter/nodes/html/js/views/collection-settings-view.js';

class MockCollectionPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockCollectionManagerPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockCollection {
    constructor({
        id = 'col-1',
        title = 'Collection One',
        runtimeId = 'general',
        targetId = 'esp32',
        version = '1.2.3',
        webAssetGenerationMode = 'compressed',
    } = {}) {
        this._id = id;
        this._title = title;
        this._runtimeId = runtimeId;
        this._targetId = targetId;
        this._version = version;
        this._webAssetGenerationMode = webAssetGenerationMode === 'plain' ? 'plain' : 'compressed';
        this._listeners = new Set();
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

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(
            name,
            new MockCollectionPayload(payloadTypeId, {
                collectionId: this._id,
                ...detail,
            })
        );
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getId() {
        return this._id;
    }

    getTitle() {
        return this._title;
    }

    setTitle(title) {
        this._title = title;
        this._emit('title', 'Collection.TitleChanged.v1', { title });
    }

    getDeviceRuntimeId() {
        return this._runtimeId;
    }

    setDeviceRuntimeId(runtimeId) {
        this._runtimeId = runtimeId;
    }

    getTargetId() {
        return this._targetId;
    }

    setTargetId(targetId) {
        this._targetId = targetId;
        this._emit('targetId', 'Collection.TargetIdChanged.v1', { targetId });
    }

    getVersionString() {
        return this._version;
    }

    getWebAssetGenerationMode() {
        return this._webAssetGenerationMode;
    }

    setWebAssetGenerationMode(mode) {
        this._webAssetGenerationMode = mode === 'plain' ? 'plain' : 'compressed';
        this._emit('webAssetGenerationMode', 'Collection.WebAssetGenerationModeChanged.v1', {
            webAssetGenerationMode: this._webAssetGenerationMode,
        });
    }

    setVersionString(version) {
        this._version = version;
        this._emit('version', 'Collection.VersionChanged.v1', { version });
    }
}

class MockCollectionManager {
    constructor() {
        this._activeCollection = null;
        this._listeners = new Set();
        this._runtimes = [
            { id: 'general', name: 'General Runtime' },
            { id: 'advanced', name: 'Advanced Runtime' },
        ];
        this._targetsByRuntime = {
            general: [
                { id: 'esp32', name: 'ESP32' },
                { id: 'pico', name: 'Raspberry Pi Pico' },
            ],
            advanced: [{ id: 'esp32s3', name: 'ESP32-S3' }],
        };
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollectionManager only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockCollectionManagerPayload(payloadTypeId, detail));
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getActiveCollection() {
        return this._activeCollection;
    }

    setActiveCollection(collection) {
        this._activeCollection = collection;
        this._emit('activeCollectionChanged', 'CollectionManager.ActiveCollectionChanged.v1', {
            collectionId: collection ? collection.getId() : null,
        });
    }

    listAvailableRuntimes() {
        return this._runtimes;
    }

    listTargetsForRuntime(runtimeId) {
        return this._targetsByRuntime[runtimeId] || [];
    }
}

class MockI18nService {
    constructor() {
        this._listeners = new Map();
        this._translations = {
            'settings.collection.title': 'Collection Settings',
            'settings.collection.name.label': 'Collection Name',
            'settings.collection.runtime.label': 'Runtime',
            'settings.collection.runtime.description': 'Select runtime.',
            'settings.collection.target.label': 'Target Device',
            'settings.collection.target.description': 'Select target.',
            'settings.collection.webAssetGenerationMode.label': 'Web Asset Format',
            'settings.collection.webAssetGenerationMode.compressed': 'Compressed (.gz)',
            'settings.collection.webAssetGenerationMode.plain': 'Plain text',
            'settings.collection.version.label': 'Collection Version',
        };
    }

    addEventListener(type, listener) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this._listeners.get(type)?.delete(listener);
    }

    t(key) {
        return this._translations[key] || key;
    }
}

describe('CollectionSettingsView', () => {
    let dom;
    let container;
    let collectionManager;
    let i18nService;
    let collection;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

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

        collectionManager = new MockCollectionManager();
        i18nService = new MockI18nService();
        collection = new MockCollection();
        collectionManager.setActiveCollection(collection);
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.EventTarget = undefined;
        global.CustomEvent = undefined;
        global.ResizeObserver = undefined;
        dom.window.close();
    });

    it('requires a collectionManager instance', () => {
        assert.throws(() => new CollectionSettingsView(), /collectionManager instance/);
    });

    it('renders collection controls with current values', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const nameInput = container.querySelector('.view-collection-settings__input');
        const selects = container.querySelectorAll('.view-collection-settings__select');
        const version = container.querySelector('.view-collection-settings__readonly');

        assert.equal(nameInput.value, 'Collection One');
        assert.equal(selects[0].value, 'general');
        assert.equal(selects[1].value, 'esp32');
        assert.equal(selects[2].value, 'compressed');
        assert.equal(version.textContent, '1.2.3');
    });

    it('updates collection title when name changes', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const nameInput = container.querySelector('.view-collection-settings__input');
        nameInput.value = 'Renamed Collection';
        nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(collection.getTitle(), 'Renamed Collection');
    });

    it('updates runtime and target when runtime changes', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const runtimeSelect = container.querySelectorAll('.view-collection-settings__select')[0];
        runtimeSelect.value = 'advanced';
        runtimeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        const targetSelect = container.querySelectorAll('.view-collection-settings__select')[1];
        assert.equal(collection.getDeviceRuntimeId(), 'advanced');
        assert.equal(collection.getTargetId(), 'esp32s3');
        assert.equal(targetSelect.value, 'esp32s3');
    });

    it('updates collection target when target changes', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const targetSelect = container.querySelectorAll('.view-collection-settings__select')[1];
        targetSelect.value = 'pico';
        targetSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(collection.getTargetId(), 'pico');
    });

    it('updates collection web asset mode when dropdown changes', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const modeSelect = container.querySelectorAll('.view-collection-settings__select')[2];
        modeSelect.value = 'plain';
        modeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(collection.getWebAssetGenerationMode(), 'plain');
    });

    it('switches to active collection changes from manager', () => {
        const view = new CollectionSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const nextCollection = new MockCollection({
            id: 'col-2',
            title: 'Collection Two',
            runtimeId: 'advanced',
            targetId: 'esp32s3',
            version: '2.0.0',
            webAssetGenerationMode: 'plain',
        });

        collectionManager.setActiveCollection(nextCollection);

        const nameInput = container.querySelector('.view-collection-settings__input');
        const selects = container.querySelectorAll('.view-collection-settings__select');
        const version = container.querySelector('.view-collection-settings__readonly');

        assert.equal(nameInput.value, 'Collection Two');
        assert.equal(selects[0].value, 'advanced');
        assert.equal(selects[1].value, 'esp32s3');
        assert.equal(selects[2].value, 'plain');
        assert.equal(version.textContent, '2.0.0');
    });

    it('serializes and deserializes with collectionManager context', () => {
        const view = new CollectionSettingsView({
            collectionManager,
            i18nService,
            id: 'collection-settings-test',
        });

        const data = view.serialize();
        assert.equal(data.type, 'CollectionSettingsView');

        const restored = CollectionSettingsView.deserialize(data, null, {
            collectionManager,
            i18nService,
        });

        assert.ok(restored instanceof CollectionSettingsView);
        assert.equal(restored.id, 'collection-settings-test');
    });
});
