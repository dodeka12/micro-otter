import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { TranspilerView } from '../../src/micro_otter/nodes/html/js/views/transpiler-view.js';
import { Workspace } from '../../src/micro_otter/nodes/html/js/core/workspace.js';
import { ViewManager } from '../../src/micro_otter/nodes/html/js/views/view-manager.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

describe('TranspilerView - Steps 1-3: Foundation', () => {
    let dom;
    let document;
    let container;
    let collectionManager;
    let runtimeCollection;
    let transpiler;
    let viewOptions;
    let viewManager;
    let i18nService;
    let view;

    beforeEach(async () => {
        // Setup DOM environment
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.Image = dom.window.Image;
        global.indexedDB = indexedDB; // Mock IndexedDB
        document = dom.window.document;

        // Create container
        container = document.createElement('div');
        document.body.appendChild(container);

        // Setup test dependencies - use a mock workspace for steps 1-3
        collectionManager = {
            getActiveCollection: () => null,
            onChange: () => () => {},
            transpileActiveCollection: async () => ({
                code: '',
                assets: { packages: {} },
            }),
        };

        runtimeCollection = {
            getRuntime: () => null,
        };

        transpiler = {
            needsTranspile: () => false,
            clearCache: () => {},
        };

        // Create view manager mount
        const mount = document.createElement('div');
        document.body.appendChild(mount);

        viewManager = new ViewManager({
            mount,
            i18nService: null, // ViewManager creates its own
            theme: 'standard',
        });

        i18nService = viewManager.i18nService;

        viewOptions = {
            collectionManager,
            runtimeCollection,
            transpiler,
            viewManager,
            i18nService,
        };

        // Don't await i18n load - tests below don't need actual translations
        // Just test structure and button creation
    });

    afterEach(() => {
        if (view && view.isAttached) {
            view.detach();
        }
        container.remove();
        global.document = undefined;
        global.window = undefined;
        global.HTMLElement = undefined;
        global.Image = undefined;
        global.indexedDB = undefined;
    });

    // ===== Step 1: Basic Structure =====

    describe('Step 1: Basic Structure', () => {
        test('can instantiate TranspilerView', () => {
            view = new TranspilerView(viewOptions);

            assert.ok(view);
            assert.strictEqual(view.title, 'Transpiler');
        });

        test('extends ViewBase', () => {
            view = new TranspilerView(viewOptions);

            assert.strictEqual(view.isAttached, false);
            assert.strictEqual(typeof view.attachTo, 'function');
            assert.strictEqual(typeof view.detach, 'function');
            assert.strictEqual(typeof view.render, 'function');
        });

        test('has correct title and icon', () => {
            view = new TranspilerView(viewOptions);

            assert.strictEqual(view.title, 'Transpiler');
            assert.strictEqual(view.icon, 'codeGenerator');
        });

        test('stores dependencies correctly', () => {
            view = new TranspilerView(viewOptions);

            // Private fields are not directly accessible, but we can verify
            // the view doesn't throw errors when accessed after construction
            assert.doesNotThrow(() => view.attachTo(container));
        });
    });

    // ===== Step 2: UI Structure =====

    describe('Step 2: UI Structure', () => {
        beforeEach(() => {
            view = new TranspilerView(viewOptions);
        });

        test('renders main container with correct class', () => {
            view.attachTo(container);

            const main = container.querySelector('.split-view');
            assert.ok(main);
        });

        test('renders button row', () => {
            view.attachTo(container);

            const buttonRow = container.querySelector('.view-toolbar__controls');
            assert.ok(buttonRow);
        });

        test('renders progress bar (hidden)', () => {
            view.attachTo(container);

            const progress = container.querySelector('.view-toolbar__progress');
            assert.ok(progress);
            assert.strictEqual(progress.tagName.toLowerCase(), 'progress');
            assert.strictEqual(progress.style.display, 'none');
            assert.strictEqual(progress.max, 100);
        });

        test('creates TextView for code display', () => {
            view.attachTo(container);

            const codeContainer = container.querySelector('.view-code');
            assert.ok(codeContainer);

            // CodeView renders a pre/code structure
            const textView = codeContainer.querySelector('pre');
            assert.ok(textView);
        });

        test('all containers have correct CSS classes', () => {
            view.attachTo(container);

            assert.ok(container.querySelector('.split-view'));
            assert.ok(container.querySelector('.view-toolbar'));
            assert.ok(container.querySelector('.view-toolbar__controls'));
            assert.ok(container.querySelector('.view-toolbar__progress'));
            assert.ok(container.querySelector('.view-code'));
        });
    });

    // ===== Step 3: Button Creation with Icons =====

    describe('Step 3: Button Creation with Icons', () => {
        beforeEach(() => {
            view = new TranspilerView(viewOptions);
            view.attachTo(container);
        });

        test('renders all three buttons', () => {
            const transpileBtn = container.querySelector('.view-toolbar__btn.transpile-btn');
            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            const clearBtn = container.querySelector('.view-toolbar__btn.clear-btn');

            assert.ok(transpileBtn);
            assert.ok(copyBtn);
            assert.ok(clearBtn);
        });

        test('buttons have icon elements', () => {
            const transpileBtn = container.querySelector('.view-toolbar__btn.transpile-btn');
            const iconWrapper = transpileBtn.querySelector('.view-toolbar__btn-icon');

            assert.ok(iconWrapper);

            const img = iconWrapper.querySelector('img');
            assert.ok(img);
            assert.ok(img.src);
        });

        test('buttons have aria-labels', () => {
            const transpileBtn = container.querySelector('.view-toolbar__btn.transpile-btn');
            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            const clearBtn = container.querySelector('.view-toolbar__btn.clear-btn');

            assert.ok(transpileBtn.getAttribute('aria-label'));
            assert.ok(copyBtn.getAttribute('aria-label'));
            assert.ok(clearBtn.getAttribute('aria-label'));
        });

        test('buttons have title attributes for tooltips', () => {
            const transpileBtn = container.querySelector('.view-toolbar__btn.transpile-btn');
            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            const clearBtn = container.querySelector('.view-toolbar__btn.clear-btn');

            assert.ok(transpileBtn.title);
            assert.ok(copyBtn.title);
            assert.ok(clearBtn.title);
        });

        test('clicking copy button calls handler', () => {
            let logCalled = false;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'copy-nothing') {
                    logCalled = true;
                }
                originalLog(...args);
            };

            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            copyBtn.click();

            assert.strictEqual(logCalled, true);
        });

        test('clicking clear button calls handler', () => {
            let logCalled = false;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'clear-code') {
                    logCalled = true;
                }
                originalLog(...args);
            };

            const clearBtn = container.querySelector('.view-toolbar__btn.clear-btn');
            clearBtn.click();

            assert.strictEqual(logCalled, true);
        });

        test('buttons are keyboard-accessible', () => {
            const transpileBtn = container.querySelector('.view-toolbar__btn.transpile-btn');

            // Buttons should be focusable (tabIndex >= 0 or no explicit tabIndex on button elements)
            assert.ok(transpileBtn.tabIndex >= 0 || transpileBtn.tabIndex === undefined);
        });

        test('copy button uses contentCopy icon', () => {
            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            const img = copyBtn.querySelector('img');
            
            assert.ok(img, 'Copy button should have an icon image');
            assert.equal(
                img.getAttribute('src'),
                IconProvider.get('contentCopy'),
                'Copy button uses the registered contentCopy icon'
            );
        });

        test('renders debug dump button when debug channel flag is enabled', () => {
            global.localStorage = window.localStorage;
            global.location = window.location;
            window.localStorage.setItem('microOtter.debug.transpileDump', '1');

            view.detach();
            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            const dumpBtn = container.querySelector('.view-toolbar__btn.dump-generated-btn');
            assert.ok(dumpBtn);

            window.localStorage.removeItem('microOtter.debug.transpileDump');
            global.localStorage = undefined;
            global.location = undefined;
        });
    });

    // ===== Serialization Tests =====

    describe('Serialization', () => {
        test('serializes to minimal JSON', () => {
            view = new TranspilerView(viewOptions);

            const data = view.serialize();

            assert.strictEqual(data.type, 'TranspilerView');
            assert.ok(data.id);
        });

        test('deserializes with correct dependencies', () => {
            const data = {
                type: 'TranspilerView',
                id: 'test-view-id',
            };

            const context = {
                collectionManager,
                runtimeCollection,
                transpiler,
                viewManager,
                i18nService,
                logger: console,
            };

            const deserialized = TranspilerView.deserialize(data, null, context);

            assert.ok(deserialized instanceof TranspilerView);
            assert.strictEqual(deserialized.title, 'Transpiler');
        });
    });
});

describe.skip('TranspilerView - Steps 4-6: Event Tracking', () => {
    let dom;
    let document;
    let container;
    let workspace;
    let viewManager;
    let i18nService;
    let view;
    let collection;

    beforeEach(async () => {
        // Setup DOM environment
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.Image = dom.window.Image;
        global.indexedDB = indexedDB;
        document = dom.window.document;

        // Mock fetch for device runtime loading
        global.fetch = async (url) => {
            const path = typeof url === 'string' ? url : url.href;

            // Mock device manifest
            if (path.includes('/device/manifest.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        deviceManifestVersion: '1.0',
                        nodePackages: [],
                        runtimes: [],
                    }),
                };
            }

            // Mock other device files
            return {
                ok: true,
                json: async () => ({}),
                text: async () => '',
            };
        };

        container = document.createElement('div');
        document.body.appendChild(container);

        // Create real workspace with mocked device runtime
        workspace = new Workspace({ splashScreen: null });

        const mount = document.createElement('div');
        document.body.appendChild(mount);

        viewManager = new ViewManager({
            mount,
            i18nService: null,
            theme: 'standard',
        });

        i18nService = viewManager.i18nService;

        // Load workspace (will use mocked fetch)
        await workspace.load();
        collection = workspace.getActiveCollection();
    });

    afterEach(() => {
        if (view && view.isAttached) {
            view.detach();
        }
        container.remove();
        global.document = undefined;
        global.window = undefined;
        global.HTMLElement = undefined;
        global.Image = undefined;
        global.indexedDB = undefined;
    });

    // ===== Step 4: Active Collection Tracking =====

    describe('Step 4: Active Collection Tracking', () => {
        test('subscribes to workspace active-collection-changed on attach', () => {
            let subscribed = false;
            const originalOn = workspace.on.bind(workspace);
            workspace.on = (event, handler) => {
                if (event === 'active-collection-changed') {
                    subscribed = true;
                }
                return originalOn(event, handler);
            };

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            assert.strictEqual(subscribed, true);
        });

        test('stores initial active collection ID', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            // Access via log to verify (private field)
            let loggedId = null;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'initial-version-subscription' && args[1]) {
                    loggedId = args[1].collectionId;
                }
                originalLog(...args);
            };

            // Re-trigger afterAttach logic by re-attaching
            view.detach();
            view.attachTo(container);

            assert.strictEqual(loggedId, collection.getId());
        });

        test('updates active collection ID on workspace event', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            let newCollectionId = null;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'active-collection-changed' && args[1]) {
                    newCollectionId = args[1].collectionId;
                }
                originalLog(...args);
            };

            // Emit event (simulate collection change)
            workspace._emit('active-collection-changed', { collectionId: 'new-collection-id' });

            assert.strictEqual(newCollectionId, 'new-collection-id');
        });

        test('unsubscribes on detach', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            let unsubscribed = false;
            const originalOff = workspace.off.bind(workspace);
            workspace.off = (event, handler) => {
                if (event === 'active-collection-changed') {
                    unsubscribed = true;
                }
                return originalOff(event, handler);
            };

            view.detach();

            assert.strictEqual(unsubscribed, true);
        });

        test('handles null active collection', () => {
            // Create workspace with no collections
            const emptyWorkspace = new Workspace({ splashScreen: null });

            view = new TranspilerView({
                workspace: emptyWorkspace,
                viewManager,
                i18nService,
            });

            // Should not throw
            assert.doesNotThrow(() => view.attachTo(container));
        });
    });

    // ===== Step 5: Collection Version Tracking =====

    describe('Step 5: Collection Version Tracking', () => {
        test('subscribes to initial collection version events', () => {
            let subscribed = false;
            const originalOn = collection.on.bind(collection);
            collection.on = (event, handler) => {
                if (event === 'version-changed') {
                    subscribed = true;
                }
                return originalOn(event, handler);
            };

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            assert.strictEqual(subscribed, true);
        });

        test('calls _updateTranspileNeededState on version change', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            let updateCalled = false;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'collection-version-changed') {
                    updateCalled = true;
                }
                originalLog(...args);
            };

            collection._emit('version-changed', { version: '1.1.0' });

            assert.strictEqual(updateCalled, true);
        });

        test('unsubscribes from version events on detach', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            let unsubscribed = false;
            const originalOff = collection.off.bind(collection);
            collection.off = (event, handler) => {
                if (event === 'version-changed') {
                    unsubscribed = true;
                }
                return originalOff(event, handler);
            };

            view.detach();

            assert.strictEqual(unsubscribed, true);
        });

        test('re-subscribes when active collection changes', (t, done) => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            // Track subscription to new collection
            let subscribedToNew = false;
            const originalLog = view._log.bind(view);
            view._log = (...args) => {
                if (args[0] === 'subscribed-to-version-events') {
                    subscribedToNew = true;
                }
                originalLog(...args);
            };

            // Create and add new collection
            const newCollection = workspace.createCollection({ name: 'New Collection' });
            workspace.addCollection(newCollection);
            workspace.setActiveCollectionId(newCollection.getId());

            // Give event system time to propagate
            setTimeout(() => {
                assert.strictEqual(subscribedToNew, true);
                done();
            }, 10);
        });
    });

    // ===== Step 6: Transpile Button State =====

    describe('Step 6: Transpile Button State', () => {
        test('highlights button when transpile needed', () => {
            // Mock transpiler to return needs transpile
            workspace.transpiler.needsTranspile = () => true;

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            assert.strictEqual(button.classList.contains('transpile-needed'), true);
        });

        test('removes highlight when up-to-date', () => {
            // Mock transpiler to return doesn't need transpile
            workspace.transpiler.needsTranspile = () => false;

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            assert.strictEqual(button.classList.contains('transpile-needed'), false);
        });

        test('disables button when no active collection', () => {
            // Create workspace with no collections
            const emptyWorkspace = new Workspace({ splashScreen: null });

            view = new TranspilerView({
                workspace: emptyWorkspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            assert.strictEqual(button.disabled, true);
            assert.strictEqual(button.classList.contains('transpile-needed'), false);
        });

        test('updates state on version change', (t, done) => {
            // Start with doesn't need transpile
            workspace.transpiler.needsTranspile = () => false;

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            assert.strictEqual(button.classList.contains('transpile-needed'), false);

            // Change to needs transpile
            workspace.transpiler.needsTranspile = () => true;

            // Emit version change
            collection._emit('version-changed', { version: '1.1.0' });

            // Give time for event to propagate
            setTimeout(() => {
                assert.strictEqual(button.classList.contains('transpile-needed'), true);
                done();
            }, 10);
        });

        test('button enabled when collection exists', () => {
            workspace.transpiler.needsTranspile = () => false;

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            assert.strictEqual(button.disabled, false);
        });
    });

    // ===== Step 7: Transpile Action =====
    // NOTE: Tests postponed for later DOM testing phase

    /*
    describe('Step 7: Transpile Action', () => {
        test('transpiles active collection on button click', (done) => {
            const transpiledCode = 'print("hello")';
            workspace.transpiler.transpile = async () => ({ code: transpiledCode });

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            button.click();

            setTimeout(() => {
                const codeText = view._codeTextView.getText();
                assert.strictEqual(codeText, transpiledCode);
                done();
            }, 50);
        });

        test('disables buttons during transpilation', (done) => {
            let resolveTranspile;
            workspace.transpiler.transpile = () => new Promise((resolve) => {
                resolveTranspile = resolve;
            });

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const transpileBtn = container.querySelector('.transpiler-view__transpile-btn');
            const copyBtn = container.querySelector('.transpiler-view__copy-btn');
            const clearBtn = container.querySelector('.transpiler-view__clear-btn');

            transpileBtn.click();

            setTimeout(() => {
                // Buttons should be disabled during transpilation
                assert.strictEqual(transpileBtn.disabled, true);
                assert.strictEqual(copyBtn.disabled, true);
                assert.strictEqual(clearBtn.disabled, true);

                // Resolve transpilation
                resolveTranspile({ code: '' });

                setTimeout(() => {
                    // Buttons should be re-enabled after completion
                    assert.strictEqual(transpileBtn.disabled, false);
                    assert.strictEqual(copyBtn.disabled, false);
                    assert.strictEqual(clearBtn.disabled, false);
                    done();
                }, 50);
            }, 10);
        });

        test('shows progress bar during transpilation', (done) => {
            let resolveTranspile;
            workspace.transpiler.transpile = () => new Promise((resolve) => {
                resolveTranspile = resolve;
            });

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const progress = container.querySelector('.transpiler-view__progress');
            const button = container.querySelector('.transpiler-view__transpile-btn');

            assert.strictEqual(progress.style.display, 'none');

            button.click();

            setTimeout(() => {
                // Progress bar should be visible during transpilation
                assert.strictEqual(progress.style.display, 'block');

                // Resolve transpilation
                resolveTranspile({ code: '' });

                setTimeout(() => {
                    // Progress bar should be hidden after completion
                    assert.strictEqual(progress.style.display, 'none');
                    done();
                }, 50);
            }, 10);
        });

        test('shows error modal on transpile failure', (done) => {
            const error = new Error('Transpilation failed');
            workspace.transpiler.transpile = async () => {
                throw error;
            };

            let errorShown = false;
            viewManager.showError = async () => {
                errorShown = true;
            };

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            button.click();

            setTimeout(() => {
                assert.strictEqual(errorShown, true);
                done();
            }, 50);
        });

        test('re-enables buttons after error', (done) => {
            workspace.transpiler.transpile = async () => {
                throw new Error('fail');
            };

            viewManager.showError = async () => {};

            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const button = container.querySelector('.transpiler-view__transpile-btn');
            button.click();

            setTimeout(() => {
                // Buttons should be re-enabled after error
                assert.strictEqual(button.disabled, false);
                done();
            }, 50);
        });
    });

    // ===== Step 8: Progress Event Integration =====

    describe('Step 8: Progress Event Integration', async () => {
        // Import at module level
        const { ProgressEventBus, ProgressEvent, ProgressEventType } = await import('../../src/micro_otter/nodes/html/js/core/progress-events.js');
        
        test('subscribes to ProgressEventBus on attach', () => {
            const initialListenerCount = ProgressEventBus.getListenerCount();
            
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const afterAttachCount = ProgressEventBus.getListenerCount();
            assert.strictEqual(afterAttachCount, initialListenerCount + 1);
        });

        test('updates progress bar on progress events', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const progress = container.querySelector('.transpiler-view__progress');
            progress.style.display = 'block'; // Simulate active transpile

            ProgressEventBus.emit(new ProgressEvent({
                source: 'transpiler',
                type: ProgressEventType.UPDATE,
                message: 'Processing',
                progress: 50
            }));

            assert.strictEqual(progress.value, 50);
        });

        test('ignores non-transpiler progress events', () => {
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const progress = container.querySelector('.transpiler-view__progress');
            progress.value = 0;

            ProgressEventBus.emit(new ProgressEvent({
                source: 'other-source',
                type: ProgressEventType.UPDATE,
                message: 'Processing',
                progress: 75
            }));

            assert.strictEqual(progress.value, 0);
        });

        test('unsubscribes from ProgressEventBus on detach', () => {
            const initialListenerCount = ProgressEventBus.getListenerCount();
            
            view = new TranspilerView({
                workspace,
                viewManager,
                i18nService,
            });
            view.attachTo(container);

            const afterAttachCount = ProgressEventBus.getListenerCount();
            assert.strictEqual(afterAttachCount, initialListenerCount + 1);

            view.detach();

            const afterDetachCount = ProgressEventBus.getListenerCount();
            assert.strictEqual(afterDetachCount, initialListenerCount);
        });
    });

    // ===== Step 9: Copy and Clear Actions =====

    describe('Step 9: Copy and Clear Actions', () => {
        beforeEach(() => {
            // Mock the clipboard API
            if (!global.navigator) {
                global.navigator = {};
            }
            global.navigator.clipboard = {
                writeText: async () => {},
            };
        });

        test('copies code to clipboard on copy button click', async () => {
            const code = 'print("hello")';
            let copiedData = null;
            
            // Mock clipboard.writeText
            global.navigator.clipboard.writeText = async (text) => {
                copiedData = text;
            };

            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            // Set code in the view
            view._onTranspile = async () => {
                // Bypass real transpilation in test
                const resultDiv = container.querySelector('.view-code pre code');
                if (resultDiv) {
                    resultDiv.textContent = code;
                }
            };

            await view._onTranspile();

            const button = container.querySelector('.view-toolbar__btn.copy-btn');
            await button.click();

            // Give time for async operation
            await new Promise(resolve => setTimeout(resolve, 50));

            assert.strictEqual(copiedData, code);
        });

        test('does nothing on copy if no code', async () => {
            let copyWasCalled = false;
            
            global.navigator.clipboard.writeText = async () => {
                copyWasCalled = true;
            };

            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            const button = container.querySelector('.view-toolbar__btn.copy-btn');
            button.click();

            // Give time for any async operation
            await new Promise(resolve => setTimeout(resolve, 50));

            // Copy should not be called if there's no code
            assert.strictEqual(copyWasCalled, false);
        });

        test('shows error modal on copy failure', async () => {
            global.navigator.clipboard.writeText = async () => {
                throw new Error('Clipboard API failed');
            };

            let errorShown = false;
            viewManager.showError = async () => {
                errorShown = true;
            };

            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            // Set some code first
            view._onTranspile = async () => {
                const resultDiv = container.querySelector('.view-code pre code');
                if (resultDiv) {
                    resultDiv.textContent = 'code';
                }
            };

            await view._onTranspile();

            const button = container.querySelector('.view-toolbar__btn.copy-btn');
            button.click();

            // Give time for async error handling
            await new Promise(resolve => setTimeout(resolve, 50));

            assert.strictEqual(errorShown, true);
        });

        test('clears code on clear button click', () => {
            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            // Set some code first
            const resultDiv = container.querySelector('.view-code pre code');
            if (resultDiv) {
                resultDiv.textContent = 'some code';
            }

            const button = container.querySelector('.view-toolbar__btn.clear-btn');
            button.click();

            const clearedDiv = container.querySelector('.view-code pre code');
            assert.strictEqual(clearedDiv.textContent, '');
        });

        test('clears transpiler cache on clear', () => {
            let cacheCleared = false;
            transpiler.clearCache = () => {
                cacheCleared = true;
            };

            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            const button = container.querySelector('.view-toolbar__btn.clear-btn');
            button.click();

            assert.strictEqual(cacheCleared, true);
        });

        test('copy button uses contentCopy icon', () => {
            view = new TranspilerView(viewOptions);
            view.attachTo(container);

            const copyBtn = container.querySelector('.view-toolbar__btn.copy-btn');
            const img = copyBtn.querySelector('img');
            
            assert.ok(img);
            assert.equal(
                img.getAttribute('src'),
                IconProvider.get('contentCopy'),
                'Copy button uses the registered contentCopy icon'
            );
        });
    });
    */
});
