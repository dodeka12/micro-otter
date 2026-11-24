// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';

const PULSE_CLASS = 'mo-activity-pulse';
const STANDARD_STYLES_URL = new URL(
    '../../src/micro_otter/nodes/html/styles/standard/',
    import.meta.url
);

/**
 * Resolve a dotted key in a locale tree.
 * @param {object} tree Locale document.
 * @param {string} key Dotted key.
 */
function lookup(tree, key) {
    return key.split('.').reduce((node, part) => (node == null ? node : node[part]), tree);
}

const LOCALES = {
    en: JSON.parse(
        readFileSync(
            new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
            'utf8'
        )
    ),
};

/**
 * Minimal i18n double over the shipped English locale.
 */
function createI18nService() {
    return {
        currentLocale: 'en',
        availableLocales: [{ code: 'en', label: 'English', icon: 'en.png' }],
        t(key, params = {}) {
            const value = lookup(LOCALES.en, key);
            if (typeof value !== 'string') {
                return key;
            }
            return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''));
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

/**
 * Device connection monitor double that can push snapshots into the view.
 * @param {object} initial Starting snapshot fields.
 */
function createMonitor(initial = {}) {
    return {
        snapshot: {
            state: initial.state ?? 'disconnected',
            progress: initial.progress ?? null,
            message: initial.message ?? null,
            providerKey: initial.providerKey ?? 'webserial',
            error: initial.error ?? null,
        },
        listeners: new Set(),

        getSnapshot() {
            return { ...this.snapshot };
        },
        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        push(next) {
            this.snapshot = { ...this.snapshot, ...next };
            for (const listener of [...this.listeners]) {
                listener(this.getSnapshot());
            }
        },
    };
}

class MockCollection {
    constructor({ id = 'col-1', title = 'Collection One' } = {}) {
        this._id = id;
        this._title = title;
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

    getVersionString() {
        return '1.0.0';
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
}

class MockWorkspace {
    constructor() {
        this.collections = new Map();
        this._listeners = new Set();
        this.deviceDeployment = null;
        this.deviceConnection = null;
        this.collections.set('col-1', new MockCollection());
        this.activeCollectionId = 'col-1';
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

describe('WorkspaceView activity pulse', () => {
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

    /**
     * Attach a workspace bar with a device connection monitor.
     * @param {object} [options] View wiring overrides.
     * @param {object} [options.monitor] Device connection monitor double.
     */
    function attach({ monitor = createMonitor() } = {}) {
        const view = new WorkspaceView({
            workspace,
            deviceConnection: monitor,
            i18nService: createI18nService(),
        });
        view.attachTo(container);
        return view;
    }

    /**
     * Whether the bar currently carries the pulse class.
     * @param {WorkspaceView} view Attached view.
     */
    function isPulsing(view) {
        return view._titleBarEl?.classList.contains(PULSE_CLASS) === true;
    }

    it('does not pulse while no attempt is running', () => {
        const view = attach();

        assert.equal(isPulsing(view), false);
    });

    it('pulses from connecting through loading', () => {
        const monitor = createMonitor();
        const view = attach({ monitor });

        monitor.push({ state: 'connecting' });
        assert.equal(isPulsing(view), true);

        monitor.push({ state: 'loading' });
        assert.equal(isPulsing(view), true);
    });

    it('stops pulsing on every idle or terminal state', () => {
        const monitor = createMonitor();
        const view = attach({ monitor });

        for (const state of ['connected', 'error', 'disconnected', 'disconnecting']) {
            monitor.push({ state: 'connecting' });
            assert.equal(isPulsing(view), true, `connecting before ${state} should pulse`);

            monitor.push({ state });
            assert.equal(isPulsing(view), false, `${state} should stop the pulse`);
        }
    });

    it('pulses immediately when attached during an in-flight attempt', () => {
        const view = attach({ monitor: createMonitor({ state: 'connecting' }) });

        assert.equal(isPulsing(view), true);
    });

    it('lets other activities drive the pulse independently', () => {
        const monitor = createMonitor();
        const view = attach({ monitor });

        view.setActivityPulse('deploy', true);
        assert.equal(isPulsing(view), true);

        monitor.push({ state: 'connecting' });
        monitor.push({ state: 'connected' });

        assert.equal(isPulsing(view), true, 'the deploy reason is still active');

        view.setActivityPulse('deploy', false);
        assert.equal(isPulsing(view), false);
    });

    it('ignores pulse requests before the bar was rendered', () => {
        const view = new WorkspaceView({
            workspace,
            deviceConnection: createMonitor(),
            i18nService: createI18nService(),
        });

        assert.doesNotThrow(() => view.setActivityPulse('deploy', true));
        assert.equal(view._activityPulse, null);
    });

    it('drops the pulse and the subscription when detached', () => {
        const monitor = createMonitor();
        const view = attach({ monitor });
        const bar = view._titleBarEl;

        monitor.push({ state: 'connecting' });
        assert.equal(bar.classList.contains(PULSE_CLASS), true);

        view.detach();

        assert.equal(bar.classList.contains(PULSE_CLASS), false);
        assert.equal(view._activityPulse, null);
        assert.equal(monitor.listeners.size, 0);
        assert.doesNotThrow(() => view.setActivityPulse('deploy', true));
    });

    it('keeps the activity pulse stylesheet and its registrations in place', () => {
        const css = readFileSync(new URL('activity-pulse.css', STANDARD_STYLES_URL), 'utf8');

        assert.match(css, /@keyframes\s+mo-activity-pulse\s*\{/);
        assert.match(css, /\.mo-activity-pulse\s*\{[^}]*animation:\s*mo-activity-pulse/);
        assert.match(
            css,
            /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.mo-activity-pulse\s*\{[^}]*animation:\s*none/
        );

        const manifest = JSON.parse(
            readFileSync(
                new URL('../../src/micro_otter/nodes/html/styles/themes.json', import.meta.url),
                'utf8'
            )
        );
        assert.ok(manifest.styles.includes('activity-pulse'));

        const registry = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/js/views/view-theme-registry.ts',
                import.meta.url
            ),
            'utf8'
        );
        const defaults = registry.slice(registry.indexOf('DEFAULT_THEME_STYLES'));
        assert.match(defaults, /'activity-pulse'/);
    });

    it('keeps the pulse keyframe name unique across standard styles', () => {
        const occurrences = readdirSync(STANDARD_STYLES_URL)
            .filter((name) => name.endsWith('.css'))
            .map((name) => readFileSync(new URL(name, STANDARD_STYLES_URL), 'utf8'))
            .join('\n')
            .match(/@keyframes\s+mo-activity-pulse\b/g);

        assert.equal(occurrences?.length ?? 0, 1);
    });
});
