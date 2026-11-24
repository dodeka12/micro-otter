import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AppEvent, AppPayload } from '../../../src/micro_otter/nodes/html/js/core/app-event.js';
import { AllSettingsView } from '../../../src/micro_otter/nodes/html/js/views/all-settings-view.js';

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

class MockI18nService {
    constructor() {
        this.currentLocale = 'en';
        this.availableLocales = [
            { code: 'en', label: 'English' },
            { code: 'de', label: 'Deutsch' },
        ];
        this._listeners = new Map();
        this._translations = {
            'settings.all.title': 'Settings',
            'settings.section.general': 'General Settings',
            'settings.section.collection': 'Collection Settings',
            'settings.section.graph': 'Graph Settings',
            'settings.collapse.tooltip': 'Collapse section',
            'settings.expand.tooltip': 'Expand section',
            'settings.general.title': 'General Settings',
            'settings.general.theme.label': 'Theme',
            'settings.general.theme.description': 'Choose theme.',
            'settings.general.language.label': 'Language',
            'settings.general.language.description': 'Choose language.',
            'settings.collection.title': 'Collection Settings',
            'settings.collection.name.label': 'Collection Name',
            'settings.collection.runtime.label': 'Runtime',
            'settings.collection.runtime.description': 'Runtime description',
            'settings.collection.target.label': 'Target Device',
            'settings.collection.target.description': 'Target description',
            'settings.collection.version.label': 'Collection Version',
            'settings.graph.title': 'Graph Settings',
            'settings.graph.name.label': 'Graph Name',
            'settings.graph.executionType.label': 'Execution Type',
            'settings.graph.executionType.startup': 'Run once on startup',
            'settings.graph.executionType.continuous': 'Run continuously in loop',
            'settings.graph.sleepDuration.label': 'Interval (ms)',
            'settings.graph.sleepDuration.description':
                'Time between the start of consecutive loop iterations. 0 yields without waiting.',
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

class MockGraph {
    constructor({ name = 'Boot Graph', executionType = 'startup', interval = 300 } = {}) {
        this._name = name;
        this._executionType = executionType;
        this._interval = interval;
        this._listeners = new Set();
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockGraph only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockCollectionManagerPayload(payloadTypeId, detail));
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getName() {
        return this._name;
    }

    setName(name) {
        this._name = name;
        this._emit('name', { name });
    }

    getExecutionType() {
        return this._executionType;
    }

    setExecutionType(nextValue) {
        this._executionType = nextValue;
        this._emit('executionType', { executionType: nextValue });
    }

    getTriggerInterval() {
        return this._interval;
    }

    setTriggerInterval(nextValue) {
        this._interval = nextValue;
        this._emit('interval', { triggerIntervalMs: nextValue });
    }
}

class MockCollection {
    constructor({
        title = 'Collection A',
        runtimeId = 'general',
        targetId = 'esp32',
        version = '1.0.0',
        graphs = [],
    } = {}) {
        this._title = title;
        this._runtimeId = runtimeId;
        this._targetId = targetId;
        this._webAssetGenerationMode = 'compressed';
        this._version = version;
        this._graphs = graphs;
        this._activeGraphIdx = 0;
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
                collectionId: 'col-1',
                ...detail,
            })
        );
        for (const listener of this._listeners) {
            listener(event);
        }
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

    getActiveGraph() {
        return this._graphs[this._activeGraphIdx] || null;
    }

    setActiveGraphIdx(index) {
        this._activeGraphIdx = index;
        this._emit('activeGraphIdx', 'Collection.ActiveGraphIndexChanged.v1', {
            activeGraphIdx: index,
        });
    }
}

class MockCollectionManager {
    constructor() {
        this._activeCollection = null;
        this._listeners = new Set();
        this._runtimes = [{ id: 'general', name: 'General Runtime' }];
        this._targetsByRuntime = {
            general: [{ id: 'esp32', name: 'ESP32' }],
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

    _emit(type, data = {}) {
        for (const listener of this._listeners) {
            listener({ type, data });
        }
    }

    getActiveCollection() {
        return this._activeCollection;
    }

    setActiveCollection(collection) {
        this._activeCollection = collection;
        this._emit('activeCollectionChanged', 'CollectionManager.ActiveCollectionChanged.v1', {
            collectionId: collection ? 'col-1' : null,
        });
    }

    listAvailableRuntimes() {
        return this._runtimes;
    }

    listTargetsForRuntime(runtimeId) {
        return this._targetsByRuntime[runtimeId] || [];
    }
}

function createWorkspace(i18nService) {
    const listeners = new Set();
    return {
        config: { theme: 'standard', locale: 'en' },
        i18nService,
        viewManager: {
            themeEvents: new EventTarget(),
            getAvailableThemes() {
                return [{ id: 'standard', label: 'Standard' }];
            },
            setTheme(themeId) {
                return themeId;
            },
        },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        on(eventName, listener) {
            if (eventName !== '*') {
                throw new Error('Workspace mock only supports wildcard listeners in tests');
            }
            return this.onChange(listener);
        },
        getTheme() {
            return this.config.theme;
        },
        listAvailableThemes() {
            return this.viewManager.getAvailableThemes();
        },
        async setTheme(themeId) {
            this.config.theme = themeId;
        },
        async setLocale(localeCode) {
            this.config.locale = localeCode;
        },
    };
}

describe('AllSettingsView', () => {
    let dom;
    let container;
    let i18nService;
    let workspace;
    let collectionManager;
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

        i18nService = new MockI18nService();
        workspace = createWorkspace(i18nService);
        collectionManager = new MockCollectionManager();
        collection = new MockCollection({
            title: 'Collection A',
            graphs: [
                new MockGraph({ name: 'Boot Graph', executionType: 'startup', interval: 300 }),
                new MockGraph({ name: 'Loop Graph', executionType: 'continuous', interval: 900 }),
            ],
        });
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

    it('requires workspace and collectionManager instances', () => {
        assert.throws(() => new AllSettingsView({ collectionManager }), /workspace instance/);
        assert.throws(() => new AllSettingsView({ workspace }), /collectionManager instance/);
    });

    it('renders split layout with all three settings views visible', () => {
        const view = new AllSettingsView({ workspace, collectionManager, i18nService });
        view.attachTo(container);

        const splitHost = container.querySelector('.view-all-settings__split-host > .split-view');
        const splitters = container.querySelectorAll('.split-view__splitter');

        // Settings views are created with showTitle: false, so we check for the content instead
        const generalSettings = container.querySelector('.view-general-settings');
        const collectionSettings = container.querySelector('.view-collection-settings');
        const graphSettings = container.querySelector('.view-graph-settings');

        assert.ok(splitHost, 'Split view host should exist');
        assert.equal(splitHost.style.flexDirection, 'column', 'Split view should be vertical');
        assert.equal(splitters.length, 2, 'Should have 2 splitters for 3 panes');
        assert.ok(generalSettings, 'General settings view should be rendered');
        assert.ok(collectionSettings, 'Collection settings view should be rendered');
        assert.ok(graphSettings, 'Graph settings view should be rendered');
    });

    it('sizes all settings panes to their measured content', () => {
        const view = new AllSettingsView({ workspace, collectionManager, i18nService });
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                let height = 0;
                if (this.classList?.contains('split-view')) {
                    height = 600;
                } else if (this.classList?.contains('view-general-settings')) {
                    height = 80;
                } else if (this.classList?.contains('view-collection-settings')) {
                    height = 120;
                } else if (this.classList?.contains('view-graph-settings')) {
                    height = 160;
                }

                return {
                    width: 800,
                    height,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: height,
                    toJSON: () => ({}),
                };
            };

            view.attachTo(container);

            const collapsibles = container.querySelectorAll('.collapsible-view');
            assert.equal(collapsibles.length, 3);
            collapsibles.forEach((collapsible) => {
                assert.ok(collapsible.classList.contains('collapsible-view--fit-content'));
            });

            const outerSplit = container.querySelector(
                '.view-all-settings__split-host > .split-view'
            );
            const panes = Array.from(outerSplit.children).filter((child) =>
                child.classList.contains('split-view__pane')
            );
            assert.deepEqual(
                panes.map((pane) => pane.style.maxHeight),
                ['110px', '150px', '190px']
            );

            const factors = panes.map((pane) => Number(pane.style.flexGrow));
            const filler = Array.from(outerSplit.children).find((child) =>
                child.classList.contains('split-view__filler')
            );
            assert.ok(filler, 'a residual filler should be present');
            // Factors are expressed in units of the smallest cap (110px) instead of normalized
            // ratios, so every pane weighs at least 1 and the space freed by a capped pane is
            // distributed completely instead of leaving an empty band below the panes.
            assert.ok(
                factors.every((factor) => factor >= 1 - 1e-9),
                `every pane factor should be at least 1 (got ${factors.join(', ')})`
            );
            assert.ok(Math.abs(factors[0] - 1) < 1e-6);
            assert.ok(Math.abs(factors[1] - 150 / 110) < 0.01);
            assert.ok(Math.abs(factors[2] - 190 / 110) < 0.01);
            assert.ok(
                Math.abs(
                    factors.reduce((sum, factor) => sum + factor, 0) +
                        Number(filler.style.flexGrow) -
                        588 / 110
                ) < 0.01,
                'pane and filler flex factors should add up to the scale (span / smallest cap)'
            );
            assert.ok(
                Math.abs(Number(filler.style.flexGrow) - 138 / 110) < 0.01,
                `filler should only absorb the unused ratio (got ${filler.style.flexGrow})`
            );
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('removes the residual filler when a settings section is collapsed', () => {
        const view = new AllSettingsView({ workspace, collectionManager, i18nService });
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                let height = 0;
                if (this.classList?.contains('split-view')) {
                    height = 600;
                } else if (this.classList?.contains('view-general-settings')) {
                    height = 80;
                } else if (this.classList?.contains('view-collection-settings')) {
                    height = 120;
                } else if (this.classList?.contains('view-graph-settings')) {
                    height = 160;
                }

                return {
                    width: 800,
                    height,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: height,
                    toJSON: () => ({}),
                };
            };

            view.attachTo(container);
            const outerSplit = container.querySelector(
                '.view-all-settings__split-host > .split-view'
            );
            assert.ok(
                Array.from(outerSplit.children).some((child) =>
                    child.classList.contains('split-view__filler')
                )
            );

            view._generalCollapsible.collapse();

            const panes = Array.from(outerSplit.children).filter((child) =>
                child.classList.contains('split-view__pane')
            );
            const factors = panes.map((pane) => Number(pane.style.flexGrow));

            assert.equal(view._splitView._filler, null);
            assert.equal(
                Array.from(outerSplit.children).some((child) =>
                    child.classList.contains('split-view__filler')
                ),
                false
            );
            // The collapsed 28px section sets the unit and its splitter turns inactive (4px), so
            // 590px is available; the two remaining sections share 562px = 10.0357 units each.
            const flexibleFactor = (590 - 28) / 2 / 28;
            assert.ok(Math.abs(factors[0] - 1) < 1e-6);
            assert.ok(Math.abs(factors[1] - flexibleFactor) < 0.01);
            assert.ok(Math.abs(factors[2] - flexibleFactor) < 0.01);
            assert.ok(
                Math.abs(factors.reduce((sum, factor) => sum + factor, 0) - 590 / 28) < 0.01,
                'flex factors should add up to the scale (span / collapsed section height)'
            );
            assert.equal(panes[0].style.maxHeight, '28px');
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('does not render collapsible section headers', () => {
        const view = new AllSettingsView({ workspace, collectionManager, i18nService });
        view.attachTo(container);

        const headers = container.querySelectorAll('.view-all-settings__section-header');
        assert.equal(headers.length, 0);
    });

    it('updates nested graph controls when active graph changes', () => {
        const view = new AllSettingsView({ workspace, collectionManager, i18nService });
        view.attachTo(container);

        const graphNameInput = () =>
            container.querySelector('.view-graph-settings__input[type="text"]');

        assert.equal(graphNameInput().value, 'Boot Graph');

        collection.setActiveGraphIdx(1);
        assert.equal(graphNameInput().value, 'Loop Graph');
    });

    it('serializes and deserializes with context', () => {
        const view = new AllSettingsView({
            workspace,
            collectionManager,
            i18nService,
            id: 'all-settings-test',
        });
        view.attachTo(container);

        const data = view.serialize();
        assert.equal(data.type, 'AllSettingsView');

        const restored = AllSettingsView.deserialize(data, null, {
            workspace,
            collectionManager,
            i18nService,
        });

        assert.ok(restored instanceof AllSettingsView);
        assert.equal(restored.id, 'all-settings-test');
    });
});
