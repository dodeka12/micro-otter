import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';
import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import {
    ProgressEvent,
    ProgressEventBus,
    ProgressEventType,
} from '../../src/micro_otter/nodes/html/js/core/progress-events.js';

class MockPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

// Mock Collection
class MockCollection {
    constructor({ id = 'col-1', title = 'Collection One' } = {}) {
        this._id = id;
        this._title = title;
        this._targetId = 'esp32';
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

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockPayload(payloadTypeId, detail));
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
        this._emit('title', 'Collection.TitleChanged.v1', {
            collectionId: this._id,
            title,
        });
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    getTargetId() {
        return this._targetId;
    }

    setTargetId(targetId) {
        this._targetId = targetId;
        this._emit('targetId', 'Collection.TargetIdChanged.v1', {
            collectionId: this._id,
            targetId,
        });
    }

    getHistoryManager() {
        return this._historyManager;
    }
}

// Mock Workspace
class MockWorkspace {
    constructor() {
        this.collections = new Map();
        this.activeCollectionId = null;
        this._listeners = new Set();
        
        // Create a default collection
        const col1 = new MockCollection({ id: 'col-1', title: 'Collection One' });
        this.collections.set('col-1', col1);
        this.activeCollectionId = 'col-1';

        // Title-bar target selector mirrors the settings view's manager-backed options.
        this.collectionManager = {
            listTargetsForRuntime: () => this.listTargetsForRuntime(),
        };
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockWorkspace only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockPayload(payloadTypeId, detail));
        for (const listener of this._listeners) {
            listener(event);
        }
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
        return [
            { id: 'general', name: 'General' },
            { id: 'advanced', name: 'Advanced' },
        ];
    }

    listTargetsForRuntime() {
        return [
            { id: 'esp32', name: 'ESP32' },
            { id: 'esp32s3', name: 'ESP32-S3' },
        ];
    }

    // Simulate a collection title change
    updateCollectionTitle(collectionId, newTitle) {
        const collection = this.collections.get(collectionId);
        if (collection) {
            collection.setTitle(newTitle);
            // Emit workspace-level collectionChanged event
            this._emit('collectionChanged', 'Workspace.CollectionChanged.v1', {
                collectionId,
                changeType: 'title',
                collectionEventName: 'title',
                collectionEventPayloadTypeId: 'Collection.TitleChanged.v1',
                collectionEventDetail: {
                    collectionId,
                    title: newTitle,
                },
            });
        }
    }
}

describe('WorkspaceView collection title updates', () => {
    let dom;
    let container;
    let workspace;

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

        workspace = new MockWorkspace();
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        delete global.ResizeObserver;
    });

    it('updates collection dropdown when collection title changes', () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        // Find the collection dropdown
        const dropdown = container.querySelector('select');
        assert.ok(dropdown, 'Collection dropdown should exist');

        // Check initial title
        const initialOption = dropdown.querySelector('option[value="col-1"]');
        assert.equal(initialOption.textContent, 'Collection One');

        // Simulate collection title change
        workspace.updateCollectionTitle('col-1', 'Updated Collection Name');

        // Check that dropdown was updated
        const updatedOption = dropdown.querySelector('option[value="col-1"]');
        assert.equal(updatedOption.textContent, 'Updated Collection Name');
    });

    it('shows collection selector deploy progress backdrop during collection sync', async () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        const progressFill = container.querySelector('.workspace-collection-progress__fill');
        const progressBackdrop = container.querySelector('.workspace-collection-progress');
        const progressText = container.querySelector('.workspace-collection-progress__text');
        const dropdown = container.querySelector('select');

        assert.ok(progressFill, 'Progress fill should exist');
        assert.ok(progressBackdrop, 'Progress backdrop should exist');
        assert.ok(progressText, 'Progress text should exist');
        assert.ok(dropdown, 'Collection dropdown should exist');

        ProgressEventBus.emit(
            new ProgressEvent({
                source: 'collection-sync',
                type: ProgressEventType.START,
                message: 'Syncing collection',
                progress: 0,
            })
        );

        ProgressEventBus.emit(
            new ProgressEvent({
                source: 'collection-sync',
                type: ProgressEventType.UPDATE,
                message: 'Uploading files',
                progress: 42,
            })
        );

        assert.equal(progressFill.style.width, '42%');
        assert.equal(progressBackdrop.style.opacity, '1');
        assert.equal(progressText.textContent, '42%');
        assert.equal(dropdown.style.backgroundColor, 'rgba(30, 35, 50, 0.55)');

        ProgressEventBus.emit(
            new ProgressEvent({
                source: 'collection-sync',
                type: ProgressEventType.COMPLETE,
                message: 'Collection synced',
                progress: 100,
            })
        );

        assert.equal(progressFill.style.width, '100%');

        await new Promise((resolve) => setTimeout(resolve, 900));

        assert.equal(progressBackdrop.style.opacity, '0');
        assert.equal(progressFill.style.width, '0%');
        assert.equal(progressText.textContent, '');

        view.detach();
    });

    it('renders the active collection target in the title bar selector', () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        const targetSelect = view._targetSelect;
        assert.ok(targetSelect, 'Target selector should exist');
        assert.equal(targetSelect.hidden, false, 'Target selector should be visible');

        const options = Array.from(targetSelect.querySelectorAll('option')).map((option) => ({
            value: option.value,
            label: option.textContent,
        }));
        assert.deepEqual(options, [
            { value: 'esp32', label: 'ESP32' },
            { value: 'esp32s3', label: 'ESP32-S3' },
        ]);
        assert.equal(targetSelect.value, 'esp32', 'Active target should be selected');
    });

    it('writes title bar target changes through Collection.setTargetId', () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        const targetSelect = view._targetSelect;
        targetSelect.value = 'esp32s3';
        targetSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        assert.equal(workspace.getActiveCollection().getTargetId(), 'esp32s3');
    });

    it('refreshes the title bar target selector when the target changes elsewhere', () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        workspace.getActiveCollection().setTargetId('esp32s3');
        workspace._emit('collectionChanged', 'Workspace.CollectionChanged.v1', {
            collectionId: 'col-1',
            changeType: 'targetId',
        });

        assert.equal(view._targetSelect.value, 'esp32s3');
    });
});
