import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';

async function flushAsync() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createI18nService(overrides = {}) {
    const translations = {
        'workspace.targetConfig.uploadSuccess.title': 'I18N Upload Title',
        'workspace.targetConfig.uploadSuccess.message': 'I18N Upload Message {{displayName}}',
        'workspace.targetConfig.uploadSuccess.detail': 'I18N Upload Detail {{targetId}}',
        'workspace.targetConfig.conflict.title': 'I18N Conflict Title',
        'workspace.targetConfig.conflict.message': 'I18N Conflict Message {{conflictType}}',
        'workspace.targetConfig.conflict.detail':
            'I18N Conflict Detail {{incomingDisplayName}} {{incomingId}} {{incomingVersion}} {{existingDisplayName}} {{existingId}} {{existingVersion}}',
        'workspace.targetConfig.conflict.confirm': 'I18N Overwrite',
        'workspace.targetConfig.conflict.cancel': 'I18N Cancel',
        'workspace.targetConfig.conflict.conflictTypeDisplayName': 'I18N Display Name',
        'workspace.targetConfig.conflict.conflictTypeId': 'I18N ID',
        'dialog.ok': 'I18N OK',
        ...overrides,
    };

    return {
        t: (key, params = {}) => {
            const template = translations[key] ?? key;
            return template.replace(/\{\{(\w+)\}\}/g, (_, token) => {
                if (params[token] === undefined || params[token] === null) {
                    return `{{${token}}}`;
                }
                return String(params[token]);
            });
        },
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}

describe('WorkspaceView target config menu actions', () => {
    it('routes upload target config menu item to handler', () => {
        const view = new WorkspaceView({ workspace: {} });
        let called = false;
        view._handleUploadTargetConfig = () => {
            called = true;
        };

        view._handleMenuItemSelect({ id: 'upload-target-config' });
        assert.equal(called, true);
    });

    it('routes download target config template menu item to handler', () => {
        const view = new WorkspaceView({ workspace: {} });
        let called = false;
        view._handleDownloadTargetConfigTemplate = () => {
            called = true;
        };

        view._handleMenuItemSelect({ id: 'download-target-config-template' });
        assert.equal(called, true);
    });

    it('routes download current target config menu item to handler', () => {
        const view = new WorkspaceView({ workspace: {} });
        let called = false;
        view._handleDownloadCurrentTargetConfig = () => {
            called = true;
        };

        view._handleMenuItemSelect({ id: 'download-current-target-config' });
        assert.equal(called, true);
    });

    it('routes backup target config DB menu item to dedicated handler only', () => {
        const view = new WorkspaceView({ workspace: {} });
        let dedicatedCalled = false;
        let genericCalled = false;
        view._handleBackupTargetConfigDB = () => {
            dedicatedCalled = true;
        };
        view._handleBackupDB = () => {
            genericCalled = true;
        };

        view._handleMenuItemSelect({ id: 'backup-target-config-db' });
        assert.equal(dedicatedCalled, true);
        assert.equal(genericCalled, false);
    });

    it('routes restore target config DB menu item to dedicated handler only', () => {
        const view = new WorkspaceView({ workspace: {} });
        let dedicatedCalled = false;
        let genericCalled = false;
        view._handleRestoreTargetConfigDB = () => {
            dedicatedCalled = true;
        };
        view._handleRestoreDB = () => {
            genericCalled = true;
        };

        view._handleMenuItemSelect({ id: 'restore-target-config-db' });
        assert.equal(dedicatedCalled, true);
        assert.equal(genericCalled, false);
    });

    it('keeps generic backup DB menu item routing unchanged', () => {
        const view = new WorkspaceView({ workspace: {} });
        let genericCalled = false;
        let dedicatedCalled = false;
        view._handleBackupDB = () => {
            genericCalled = true;
        };
        view._handleBackupTargetConfigDB = () => {
            dedicatedCalled = true;
        };

        view._handleMenuItemSelect({ id: 'backup-db' });
        assert.equal(genericCalled, true);
        assert.equal(dedicatedCalled, false);
    });

    it('keeps generic restore DB menu item routing unchanged', () => {
        const view = new WorkspaceView({ workspace: {} });
        let genericCalled = false;
        let dedicatedCalled = false;
        view._handleRestoreDB = () => {
            genericCalled = true;
        };
        view._handleRestoreTargetConfigDB = () => {
            dedicatedCalled = true;
        };

        view._handleMenuItemSelect({ id: 'restore-db' });
        assert.equal(genericCalled, true);
        assert.equal(dedicatedCalled, false);
    });

    it('routes privacy notice menu item to handler', () => {
        const view = new WorkspaceView({ workspace: {} });
        let called = false;
        view._handleOpenPrivacyNotice = () => {
            called = true;
        };

        view._handleMenuItemSelect({ id: 'privacy-notice' });
        assert.equal(called, true);
    });

    it('opens privacy notice page in a new tab', () => {
        const openCalls = [];
        const originalWindow = global.window;
        global.window = {
            open: (...args) => {
                openCalls.push(args);
                return null;
            },
        };

        try {
            const view = new WorkspaceView({ workspace: {} });
            view._handleOpenPrivacyNotice();
        } finally {
            global.window = originalWindow;
        }

        assert.equal(openCalls.length, 1);
        assert.deepEqual(openCalls[0], ['/privacy.html', '_blank', 'noopener,noreferrer']);
    });
});

describe('WorkspaceView target config restore flow', () => {
    let dom;
    let document;
    let window;
    let originalInputClick;
    let nextFileContent;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.HTMLElement = window.HTMLElement;
        global.HTMLInputElement = window.HTMLInputElement;

        nextFileContent = '{}';
        originalInputClick = window.HTMLInputElement.prototype.click;
        window.HTMLInputElement.prototype.click = function clickOverride() {
            if (this.type === 'file') {
                const file = new window.File([nextFileContent], 'target-config-db-backup.json', {
                    type: 'application/json',
                });
                Object.defineProperty(file, 'text', {
                    configurable: true,
                    value: async () => nextFileContent,
                });
                Object.defineProperty(this, 'files', {
                    configurable: true,
                    value: [file],
                });
                this.dispatchEvent(new window.Event('change'));
                return;
            }
            return originalInputClick.call(this);
        };
    });

    afterEach(() => {
        if (originalInputClick && window?.HTMLInputElement?.prototype) {
            window.HTMLInputElement.prototype.click = originalInputClick;
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.HTMLInputElement;
    });

    it('opens shared DB restore dialog in target-config-only scope', async () => {
        const shownDialogs = [];
        const workspace = {
            listUserTargetConfigs: async () => [],
            clearUserTargetConfigs: async () => {},
            saveUserTargetConfig: async (targetConfig) => targetConfig,
            getCollectionIds: () => {
                throw new Error('collection restore path should not be used for target-only scope');
            },
        };

        const view = new WorkspaceView({
            workspace,
            viewManager: {
                showModal: (dialog) => shownDialogs.push(dialog),
            },
        });

        nextFileContent = JSON.stringify({
            version: '1.1',
            timestamp: Date.now(),
            targetConfigs: {
                count: 1,
                items: [
                    {
                        id: 'target-1',
                        displayName: 'Target One',
                        version: '1.2.0',
                        created: '2026-02-22',
                        targetData: {
                            id: 'target-1',
                            displayName: 'Target One',
                        },
                    },
                ],
            },
        });

        view._handleRestoreTargetConfigDB();
        await flushAsync();

        assert.equal(shownDialogs.length, 1);
        assert.equal(shownDialogs[0].constructor.name, 'DBRestoreDialogView');
        assert.equal(shownDialogs[0]._restoreScope, 'targetConfigsOnly');
        assert.deepEqual(shownDialogs[0].backupData.collections, []);
        assert.equal(shownDialogs[0].title, 'Restore User Target Config DB');
    });
});

describe('WorkspaceView target config upload flow', () => {
    let dom;
    let document;
    let window;
    let originalInputClick;
    let nextFileContent;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.HTMLElement = window.HTMLElement;
        global.HTMLInputElement = window.HTMLInputElement;

        nextFileContent = '{}';
        originalInputClick = window.HTMLInputElement.prototype.click;
        window.HTMLInputElement.prototype.click = function clickOverride() {
            if (this.type === 'file') {
                const file = new window.File([nextFileContent], 'target-config.jsonc', {
                    type: 'application/json',
                });
                Object.defineProperty(file, 'text', {
                    configurable: true,
                    value: async () => nextFileContent,
                });
                Object.defineProperty(this, 'files', {
                    configurable: true,
                    value: [file],
                });
                this.dispatchEvent(new window.Event('change'));
                return;
            }
            return originalInputClick.call(this);
        };
    });

    afterEach(() => {
        if (originalInputClick && window?.HTMLInputElement?.prototype) {
            window.HTMLInputElement.prototype.click = originalInputClick;
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.HTMLInputElement;
    });

    it('shows success info dialog after successful target config upload', async () => {
        const shownDialogs = [];
        const saveCalls = [];
        const workspace = {
            getUserTargetConfigConflictDetails: async () => null,
            saveUserTargetConfig: async (inputRecord, options) => {
                saveCalls.push({ inputRecord, options });
                return {
                    id: inputRecord.id,
                    displayName: inputRecord.displayName,
                    version: inputRecord.version,
                };
            },
        };

        const view = new WorkspaceView({
            workspace,
            viewManager: {
                showModal: (dialog) => shownDialogs.push(dialog),
            },
        });

        nextFileContent = JSON.stringify({
            id: 'esp32_custom_board',
            displayName: 'ESP32 Custom Board',
            version: '1.2.3',
            created: '2026-02-22',
            targetData: {
                id: 'esp32_custom_board',
                displayName: 'ESP32 Custom Board',
            },
        });

        await view._handleUploadTargetConfig();
        await flushAsync();

        assert.equal(saveCalls.length, 1, 'Expected one save call');
        assert.equal(saveCalls[0].options.allowOverwrite, false);
        assert.equal(shownDialogs.length, 1, 'Expected one success dialog');
        assert.equal(shownDialogs[0].title, 'Target Config Uploaded');
        assert.match(shownDialogs[0].detail, /target selection/i);
    });

    it('shows conflict dialog and aborts save when overwrite is cancelled', async () => {
        const shownDialogs = [];
        let saveCallCount = 0;
        const workspace = {
            getUserTargetConfigConflictDetails: async () => ({
                type: 'displayName',
                incoming: {
                    id: 'incoming-target',
                    displayName: 'ESP32 Shared Name',
                    version: '2.0.0',
                },
                existing: {
                    id: 'existing-target',
                    displayName: 'ESP32 Shared Name',
                    version: '1.5.0',
                },
            }),
            saveUserTargetConfig: async () => {
                saveCallCount += 1;
                return {};
            },
        };

        const view = new WorkspaceView({
            workspace,
            viewManager: {
                showModal: (dialog) => {
                    shownDialogs.push(dialog);
                    if (dialog.title === 'Target Config Conflict') {
                        dialog.cancel();
                    }
                },
            },
        });

        nextFileContent = JSON.stringify({
            id: 'incoming-target',
            displayName: 'ESP32 Shared Name',
            version: '2.0.0',
            created: '2026-02-22',
            targetData: {
                id: 'incoming-target',
                displayName: 'ESP32 Shared Name',
            },
        });

        await view._handleUploadTargetConfig();
        await flushAsync();

        assert.equal(shownDialogs.length, 1, 'Expected only conflict dialog');
        assert.equal(shownDialogs[0].title, 'Target Config Conflict');
        assert.match(shownDialogs[0].detail, /Incoming: ESP32 Shared Name/);
        assert.match(shownDialogs[0].detail, /id: incoming-target/);
        assert.match(shownDialogs[0].detail, /version: 2\.0\.0/);
        assert.match(shownDialogs[0].detail, /Existing: ESP32 Shared Name/);
        assert.match(shownDialogs[0].detail, /id: existing-target/);
        assert.match(shownDialogs[0].detail, /version: 1\.5\.0/);
        assert.equal(saveCallCount, 0, 'Save should not be called when cancelled');
    });

    it('passes explicit overwrite intent after confirming conflict dialog', async () => {
        const shownDialogs = [];
        const saveCalls = [];
        const workspace = {
            getUserTargetConfigConflictDetails: async () => ({
                type: 'id',
                incoming: {
                    id: 'esp32-target',
                    displayName: 'ESP32 New',
                    version: '3.0.0',
                },
                existing: {
                    id: 'esp32-target',
                    displayName: 'ESP32 Existing',
                    version: '2.4.1',
                },
            }),
            saveUserTargetConfig: async (inputRecord, options) => {
                saveCalls.push({ inputRecord, options });
                return {
                    id: inputRecord.id,
                    displayName: inputRecord.displayName,
                    version: inputRecord.version,
                };
            },
        };

        const view = new WorkspaceView({
            workspace,
            viewManager: {
                showModal: (dialog) => {
                    shownDialogs.push(dialog);
                    if (dialog.title === 'Target Config Conflict') {
                        dialog.confirm();
                    }
                },
            },
        });

        nextFileContent = JSON.stringify({
            id: 'esp32-target',
            displayName: 'ESP32 New',
            version: '3.0.0',
            created: '2026-02-22',
            targetData: {
                id: 'esp32-target',
                displayName: 'ESP32 New',
            },
        });

        await view._handleUploadTargetConfig();
        await flushAsync();

        assert.equal(saveCalls.length, 1, 'Expected one save call after overwrite confirmation');
        assert.equal(saveCalls[0].options.allowOverwrite, true);
        assert.equal(shownDialogs.length, 2, 'Expected conflict and success dialogs');
        assert.equal(shownDialogs[0].title, 'Target Config Conflict');
        assert.equal(shownDialogs[1].title, 'Target Config Uploaded');
    });

    it('uses i18n keys for conflict and success dialog content when i18n service is available', async () => {
        const shownDialogs = [];
        const workspace = {
            getUserTargetConfigConflictDetails: async () => ({
                type: 'displayName',
                incoming: {
                    id: 'incoming-target',
                    displayName: 'Incoming Target',
                    version: '2.1.0',
                },
                existing: {
                    id: 'existing-target',
                    displayName: 'Existing Target',
                    version: '1.4.0',
                },
            }),
            saveUserTargetConfig: async (inputRecord) => ({
                id: inputRecord.id,
                displayName: inputRecord.displayName,
                version: inputRecord.version,
            }),
        };

        const view = new WorkspaceView({
            workspace,
            i18nService: createI18nService(),
            viewManager: {
                showModal: (dialog) => {
                    shownDialogs.push(dialog);
                    if (dialog.title === 'I18N Conflict Title') {
                        dialog.confirm();
                    }
                },
            },
        });

        nextFileContent = JSON.stringify({
            id: 'incoming-target',
            displayName: 'Incoming Target',
            version: '2.1.0',
            created: '2026-02-22',
            targetData: {
                id: 'incoming-target',
                displayName: 'Incoming Target',
            },
        });

        await view._handleUploadTargetConfig();
        await flushAsync();

        assert.equal(shownDialogs.length, 2, 'Expected conflict and success dialogs');
        assert.equal(shownDialogs[0].title, 'I18N Conflict Title');
        assert.match(shownDialogs[0].message, /I18N Conflict Message I18N Display Name/);
        assert.match(
            shownDialogs[0].detail,
            /I18N Conflict Detail Incoming Target incoming-target 2\.1\.0 Existing Target existing-target 1\.4\.0/
        );
        assert.equal(shownDialogs[0].confirmLabel, 'I18N Overwrite');
        assert.equal(shownDialogs[0].cancelLabel, 'I18N Cancel');

        assert.equal(shownDialogs[1].title, 'I18N Upload Title');
        assert.equal(shownDialogs[1].message, 'I18N Upload Message Incoming Target');
        assert.equal(shownDialogs[1].detail, 'I18N Upload Detail incoming-target');
        assert.equal(shownDialogs[1].confirmLabel, 'I18N OK');
    });
});

describe('WorkspaceView current target config download', () => {
    let dom;
    let document;
    let window;
    let originalCreateObjectURL;
    let originalRevokeObjectURL;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.HTMLElement = window.HTMLElement;

        if (!global.URL) {
            global.URL = {};
        }
        originalCreateObjectURL = global.URL.createObjectURL;
        originalRevokeObjectURL = global.URL.revokeObjectURL;
        global.URL.createObjectURL = () => 'blob:mock-url';
        global.URL.revokeObjectURL = () => {};
    });

    afterEach(() => {
        if (global.URL) {
            global.URL.createObjectURL = originalCreateObjectURL;
            global.URL.revokeObjectURL = originalRevokeObjectURL;
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
    });

    it('downloads user target config JSON when active target is user-defined', async () => {
        const clickedLinks = [];
        const workspace = {
            getActiveCollection: () => ({
                getTargetId: () => 'esp32_custom',
                getDeviceRuntimeId: () => 'general',
            }),
            getUserTargetConfig: async () => ({
                id: 'esp32_custom',
                displayName: 'ESP32 Custom',
                version: '1.2.3',
                created: '2026-02-22',
                targetData: {
                    id: 'esp32_custom',
                    targetId: 'esp32_custom',
                    displayName: 'ESP32 Custom',
                },
            }),
            runtimeCollection: {
                getRuntime: () => null,
            },
        };

        const view = new WorkspaceView({ workspace });
        const originalCreateElement = document.createElement.bind(document);
        document.createElement = (tagName, options) => {
            const element = originalCreateElement(tagName, options);
            if (tagName === 'a') {
                element.click = () => {
                    clickedLinks.push({
                        href: element.href,
                        download: element.download,
                    });
                };
            }
            return element;
        };

        try {
            await view._handleDownloadCurrentTargetConfig();
        } finally {
            document.createElement = originalCreateElement;
        }

        assert.equal(clickedLinks.length, 1);
        assert.equal(clickedLinks[0].href, 'blob:mock-url');
        assert.match(clickedLinks[0].download, /^micro-otter-target-config-esp32-custom-\d{8}\.json$/);
    });

    it('downloads runtime target config JSON when user target config is not present', async () => {
        const clickedLinks = [];
        const workspace = {
            getActiveCollection: () => ({
                getTargetId: () => 'runtime_target',
                getDeviceRuntimeId: () => 'general',
            }),
            getUserTargetConfig: async () => null,
            runtimeCollection: {
                getRuntime: () => ({
                    getDeviceTarget: () => ({
                        displayName: 'Runtime Target',
                        description: 'Runtime target description',
                        generalCapabilities: { wifi: { supported: true } },
                        metadata: { source: 'runtime' },
                        instanceData: { userDescription: null },
                        pinCapabilities: new Map([
                            [2, {
                                label: 'GPIO2',
                                aliases: ['BOOT'],
                                digital: { input: true, output: true },
                                pull: ['up'],
                                pwm: {
                                    input: true,
                                    output: true,
                                    frequency_hz: { min: 1, max: 1000 },
                                },
                                adc: null,
                                uart: null,
                                i2c: null,
                                spi: null,
                                notes: ['Boot pin'],
                            }],
                        ]),
                        capabilityToPins: { digital: [2] },
                    }),
                }),
            },
        };

        const view = new WorkspaceView({ workspace });
        const originalCreateElement = document.createElement.bind(document);
        document.createElement = (tagName, options) => {
            const element = originalCreateElement(tagName, options);
            if (tagName === 'a') {
                element.click = () => {
                    clickedLinks.push({
                        href: element.href,
                        download: element.download,
                    });
                };
            }
            return element;
        };

        try {
            await view._handleDownloadCurrentTargetConfig();
        } finally {
            document.createElement = originalCreateElement;
        }

        assert.equal(clickedLinks.length, 1);
        assert.match(
            clickedLinks[0].download,
            /^micro-otter-target-config-runtime-target-\d{8}\.json$/
        );
    });

    it('shows an error dialog when target config cannot be resolved', async () => {
        const shownDialogs = [];
        const workspace = {
            getActiveCollection: () => ({
                getTargetId: () => 'missing-target',
                getDeviceRuntimeId: () => 'general',
            }),
            getUserTargetConfig: async () => null,
            runtimeCollection: {
                getRuntime: () => ({
                    getDeviceTarget: () => null,
                }),
            },
        };

        const view = new WorkspaceView({
            workspace,
            viewManager: {
                showModal: (dialog) => shownDialogs.push(dialog),
            },
        });

        await view._handleDownloadCurrentTargetConfig();

        assert.equal(shownDialogs.length, 1);
        assert.equal(shownDialogs[0].title, 'Target Config Download Failed');
        assert.match(shownDialogs[0].message, /Failed to download current target config/i);
    });
});

describe('WorkspaceView JSONC parsing', () => {
    it('parses JSONC content with comments and trailing commas', () => {
        const view = new WorkspaceView({ workspace: {} });
        const parsed = view._parseJsoncContent(`
            {
                // target metadata
                "id": "esp32_custom_board",
                "displayName": "ESP32 Custom Board",
                /* semantic version */
                "version": "1.2.3",
                "created": "2026-02-22",
                "targetData": {
                    "id": "esp32_custom_board",
                    "displayName": "ESP32 Custom Board",
                    "pins": [1, 2, 3,],
                },
            }
        `);

        assert.equal(parsed.id, 'esp32_custom_board');
        assert.equal(parsed.version, '1.2.3');
        assert.deepEqual(parsed.targetData.pins, [1, 2, 3]);
    });

    it('rejects non-object root values', () => {
        const view = new WorkspaceView({ workspace: {} });
        assert.throws(() => view._parseJsoncContent('[1,2,3]'));
    });
});

describe('WorkspaceView target config template', () => {
    it('shows a derived target (baseTargetId plus sparse overrides)', () => {
        const view = new WorkspaceView({ workspace: {} });
        const template = view._buildTargetConfigTemplateJsonc();
        const parsed = view._parseJsoncContent(template);

        assert.equal(parsed.baseTargetId, 'esp32_wroom');
        assert.equal(typeof parsed.id, 'string');

        const targetData = parsed.targetData;
        assert.equal(typeof targetData, 'object');
        assert.equal(targetData.pinCapabilities['5'], null);
        assert.equal(Array.isArray(targetData.metadata.notes), true);
    });
});
