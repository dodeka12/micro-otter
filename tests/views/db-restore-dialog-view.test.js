// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DBRestoreDialogView } from '../../src/micro_otter/nodes/html/js/views/db-restore-dialog-view.js';
import { FlaggedVersion } from '../../src/micro_otter/nodes/html/js/data/flagged-version.js';

const TEST_TIMEOUT_MS = 10000;

describe('DBRestoreDialogView', { timeout: TEST_TIMEOUT_MS }, () => {
    let dom;
    let document;
    let window;
    let container;
    let mockWorkspace;
    let mockViewManager;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.HTMLElement = window.HTMLElement;

        container = document.createElement('div');
        document.body.appendChild(container);

        // Mock workspace
        const localTargetConfigs = [
            {
                id: 'target-local-1',
                displayName: 'Target Local 1',
                version: '1.0.0',
                created: '2026-02-22',
                targetData: { id: 'target-local-1' },
            },
        ];

        mockWorkspace = {
            getCollectionIds: () => ['local-1', 'local-2'],
            getCollection: async (id) => {
                if (id === 'local-1') {
                    return {
                        getId: () => 'local-1',
                        getTitle: () => 'Local Collection 1',
                        getVersion: () =>
                            FlaggedVersion.fromData({
                                major: 1,
                                minor: 0,
                                patch: 0,
                                dirty: { major: false, minor: false, patch: false },
                            }),
                    };
                }
                if (id === 'local-2') {
                    return {
                        getId: () => 'local-2',
                        getTitle: () => 'Local Collection 2',
                        getVersion: () =>
                            FlaggedVersion.fromData({
                                major: 1,
                                minor: 1,
                                patch: 0,
                                dirty: { major: false, minor: false, patch: false },
                            }),
                    };
                }
                return null;
            },
            deleteCollection: async (_id) => {},
            saveCollection: async (_collection) => {},
            setActiveCollectionId: async (_id) => {},
            listUserTargetConfigs: async () => localTargetConfigs,
            saveUserTargetConfig: async (targetConfig) => targetConfig,
            deleteUserTargetConfig: async (_targetId) => {},
            clearUserTargetConfigs: async () => {},
        };

        // Mock view manager
        mockViewManager = {
            showModal: (dialog) => {
                // Simulate attach
                dialog.attachTo(container);
            },
        };
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
    });

    describe('Version Comparison', () => {
        it('should detect newer version', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            const newerVersion = { major: 1, minor: 2, patch: 0, dirty: {} };
            const olderVersion = FlaggedVersion.fromData({
                major: 1,
                minor: 1,
                patch: 0,
                dirty: { major: false, minor: false, patch: false },
            });

            const result = dialog._compareVersions(newerVersion, olderVersion);
            assert.equal(result, 1, 'Should detect backup is newer');
        });

        it('should detect older version', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            const olderVersion = { major: 1, minor: 0, patch: 0, dirty: {} };
            const newerVersion = FlaggedVersion.fromData({
                major: 1,
                minor: 1,
                patch: 0,
                dirty: { major: false, minor: false, patch: false },
            });

            const result = dialog._compareVersions(olderVersion, newerVersion);
            assert.equal(result, -1, 'Should detect backup is older');
        });

        it('should detect equal versions', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            const versionA = { major: 1, minor: 0, patch: 0, dirty: {} };
            const versionB = FlaggedVersion.fromData({
                major: 1,
                minor: 0,
                patch: 0,
                dirty: { major: false, minor: false, patch: false },
            });

            const result = dialog._compareVersions(versionA, versionB);
            assert.equal(result, 0, 'Should detect versions are equal');
        });

        it('should treat local dirty as conflict (local newer)', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            // Backup version (clean)
            const backupVersion = {
                major: 1,
                minor: 0,
                patch: 0,
                dirty: { major: false, minor: false, patch: false },
            };

            // Local version (dirty)
            const localVersion = FlaggedVersion.fromData({
                major: 1,
                minor: 0,
                patch: 0,
                dirty: { major: false, minor: true, patch: false },
            });

            const result = dialog._compareVersions(backupVersion, localVersion);
            assert.equal(result, -1, 'Should treat local dirty as newer');
        });
    });

    describe('Backup Analysis', () => {
        it('should analyze backup with new collections', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'new-collection',
                        title: 'New Collection',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            const analysis = dialog._analyzeBackup();

            assert.equal(analysis.backupCount, 1);
            assert.equal(analysis.localCount, 2);
            assert.equal(analysis.conflicts, 0);
            assert.equal(analysis.items.length, 1);
            assert.equal(analysis.items[0].status, 'new');
        });

        it('should detect conflicts when versions match but local is dirty', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'local-1',
                        title: 'Collection 1',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            // Override workspace to return dirty version
            mockWorkspace.getCollection = async (id) => {
                if (id === 'local-1') {
                    return {
                        getId: () => 'local-1',
                        getTitle: () => 'Local Collection 1',
                        getVersion: () =>
                            FlaggedVersion.fromData({
                                major: 1,
                                minor: 0,
                                patch: 0,
                                dirty: { major: false, minor: true, patch: false },
                            }),
                    };
                }
                return null;
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            const analysis = dialog._analyzeBackup();

            assert.equal(analysis.conflicts, 1);
            assert.equal(analysis.items[0].status, 'conflict');
        });

        it('should detect newer backup versions', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'local-1',
                        title: 'Collection 1',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 2,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            const analysis = dialog._analyzeBackup();

            assert.equal(analysis.items[0].status, 'newer');
        });

        it('should detect older backup versions', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'local-2',
                        title: 'Collection 2',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            const analysis = dialog._analyzeBackup();

            assert.equal(analysis.items[0].status, 'older');
        });
    });

    describe('Version Formatting', () => {
        it('should format clean version', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            const version = {
                major: 1,
                minor: 2,
                patch: 3,
                dirty: { major: false, minor: false, patch: false },
            };

            const formatted = dialog._formatVersion(version);
            assert.equal(formatted, '1.2.3');
        });

        it('should format dirty version with asterisk', () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            const version = FlaggedVersion.fromData({
                major: 1,
                minor: 2,
                patch: 3,
                dirty: { major: false, minor: true, patch: false },
            });

            const formatted = dialog._formatVersion(version);
            assert.equal(formatted, '1.2.3*');
        });
    });

    describe('Dialog Rendering', () => {
        it('should render dialog body with backup info', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'new-collection',
                        title: 'New Collection',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog.attachTo(container);

            const infoSection = container.querySelector('.db-restore-dialog__info');
            assert.ok(infoSection, 'Should render info section');
            assert.ok(
                infoSection.textContent.includes('Contains: 1 collection'),
                'Should show backup collection count'
            );
        });

        it('should render restore options', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog.attachTo(container);

            const options = container.querySelectorAll('.db-restore-dialog__option');
            assert.equal(options.length, 3, 'Should render 3 restore options');

            const modes = Array.from(options).map((opt) => opt.dataset.mode);
            assert.deepEqual(
                modes,
                ['replace', 'merge', 'manual'],
                'Should have all restore modes'
            );
        });

        it('should not render manual selection table in main dialog', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'new-collection',
                        title: 'New Collection',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog.attachTo(container);

            const table = container.querySelector('.db-restore-dialog__table');
            assert.equal(table, null, 'Should not render table in main dialog');
        });
    });

    describe('Manual Selection Dialog', () => {
        it('should open manual selection dialog when manual mode selected', async () => {
            const backupData = {
                version: '1.0',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'new-collection',
                        title: 'New Collection',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
            };

            let manualDialogShown = false;
            mockViewManager.showModal = (dialog) => {
                if (dialog.constructor.name === 'ManualCollectionSelectionDialogView') {
                    manualDialogShown = true;
                } else {
                    dialog.attachTo(container);
                }
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog.attachTo(container);

            // Simulate confirm with manual mode
            dialog._selectedMode = 'manual';
            const result = await dialog._onConfirm();

            assert.equal(result.openedManual, true, 'Should indicate manual dialog opened');
            assert.equal(manualDialogShown, true, 'Should show manual selection dialog');
        });

        it('should include target config items in manual selection dialog', async () => {
            const backupData = {
                version: '1.1',
                timestamp: Date.now(),
                collections: [],
                targetConfigs: {
                    count: 1,
                    items: [
                        {
                            id: 'target-manual-1',
                            displayName: 'Target Manual 1',
                            version: '1.0.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-manual-1' },
                        },
                    ],
                },
            };

            let capturedItems = [];
            mockWorkspace.getCollectionIds = () => [];
            mockWorkspace.listUserTargetConfigs = async () => [];

            mockViewManager.showModal = (dialog) => {
                if (dialog.constructor.name === 'ManualCollectionSelectionDialogView') {
                    capturedItems = dialog.items || [];
                } else {
                    dialog.attachTo(container);
                }
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog.attachTo(container);

            dialog._selectedMode = 'manual';
            await dialog._onConfirmAsync();

            assert.equal(capturedItems.length, 1);
            assert.equal(capturedItems[0].kind, 'targetConfig');
            assert.equal(capturedItems[0].id, 'target-manual-1');
        });
    });

    describe('Target Config Restore Integration', () => {
        it('should replace local target configs in replace mode', async () => {
            const importedTargetIds = [];
            let cleared = false;

            mockWorkspace.getCollectionIds = () => [];
            mockWorkspace.clearUserTargetConfigs = async () => {
                cleared = true;
            };
            mockWorkspace.saveUserTargetConfig = async (targetConfig) => {
                importedTargetIds.push(targetConfig.id);
                return targetConfig;
            };

            const backupData = {
                version: '1.1',
                timestamp: Date.now(),
                collections: [],
                targetConfigs: {
                    count: 1,
                    items: [
                        {
                            id: 'target-import-1',
                            displayName: 'Target Import 1',
                            version: '1.1.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-import-1' },
                        },
                    ],
                },
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog._selectedMode = 'replace';
            dialog._showDeleteConfirmation = async () => true;
            dialog._showResultsSummary = async () => {};

            const result = await dialog._onConfirmAsync();

            assert.equal(result.confirmed, true);
            assert.equal(cleared, true);
            assert.deepEqual(importedTargetIds, ['target-import-1']);
            assert.ok(result.results.imported.includes('Target: Target Import 1'));
        });

        it('should overwrite newer backup target config in merge mode', async () => {
            const deletedTargetIds = [];
            const savedTargetIds = [];

            mockWorkspace.getCollectionIds = () => [];
            mockWorkspace.listUserTargetConfigs = async () => [
                {
                    id: 'target-local-1',
                    displayName: 'Target Local 1',
                    version: '1.0.0',
                    created: '2026-02-22',
                    targetData: { id: 'target-local-1' },
                },
            ];
            mockWorkspace.deleteUserTargetConfig = async (targetId) => {
                deletedTargetIds.push(targetId);
            };
            mockWorkspace.saveUserTargetConfig = async (targetConfig) => {
                savedTargetIds.push(targetConfig.id);
                return targetConfig;
            };

            const backupData = {
                version: '1.1',
                timestamp: Date.now(),
                collections: [],
                targetConfigs: {
                    count: 1,
                    items: [
                        {
                            id: 'target-local-1',
                            displayName: 'Target Local 1',
                            version: '1.2.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-local-1' },
                        },
                    ],
                },
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            await dialog.initialize();
            dialog._selectedMode = 'merge';
            dialog._mergeStrategy = 'overwrite-newer';
            dialog._showResultsSummary = async () => {};

            const result = await dialog._onConfirmAsync();

            assert.equal(result.confirmed, true);
            assert.deepEqual(deletedTargetIds, ['target-local-1']);
            assert.deepEqual(savedTargetIds, ['target-local-1']);
            assert.ok(result.results.overwritten.includes('Target: Target Local 1'));
        });

        it('should not delete or import collections in targetConfigsOnly replace scope', async () => {
            let clearedTargets = false;
            const deletedCollections = [];
            const importedTargetIds = [];

            mockWorkspace.getCollectionIds = () => ['local-1'];
            mockWorkspace.deleteCollection = async (id) => {
                deletedCollections.push(id);
            };
            mockWorkspace.clearUserTargetConfigs = async () => {
                clearedTargets = true;
            };
            mockWorkspace.saveUserTargetConfig = async (targetConfig) => {
                importedTargetIds.push(targetConfig.id);
                return targetConfig;
            };

            const backupData = {
                version: '1.1',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'backup-collection-1',
                        title: 'Backup Collection',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 2,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
                targetConfigs: {
                    count: 1,
                    items: [
                        {
                            id: 'target-import-2',
                            displayName: 'Target Import 2',
                            version: '1.3.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-import-2' },
                        },
                    ],
                },
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
                restoreScope: 'targetConfigsOnly',
            });

            await dialog.initialize();
            dialog._selectedMode = 'replace';
            dialog._showDeleteConfirmation = async () => true;
            dialog._showResultsSummary = async () => {};

            const result = await dialog._onConfirmAsync();

            assert.equal(result.confirmed, true);
            assert.equal(clearedTargets, true);
            assert.deepEqual(importedTargetIds, ['target-import-2']);
            assert.deepEqual(deletedCollections, []);
            assert.ok(result.results.imported.includes('Target: Target Import 2'));
        });

        it('should include only target config items in manual dialog for targetConfigsOnly scope', async () => {
            const backupData = {
                version: '1.1',
                timestamp: Date.now(),
                collections: [
                    {
                        id: 'collection-in-backup',
                        title: 'Collection In Backup',
                        targetId: 'esp32-generic',
                        deviceRuntimeId: 'esp32-micropython',
                        version: {
                            major: 1,
                            minor: 0,
                            patch: 0,
                            dirty: { major: false, minor: false, patch: false },
                        },
                        graphs: [],
                        activeGraphIdx: 0,
                    },
                ],
                targetConfigs: {
                    count: 1,
                    items: [
                        {
                            id: 'target-only-item',
                            displayName: 'Target Only Item',
                            version: '2.0.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-only-item' },
                        },
                    ],
                },
            };

            let capturedItems = [];
            mockWorkspace.getCollectionIds = () => ['local-1'];
            mockWorkspace.listUserTargetConfigs = async () => [];
            mockViewManager.showModal = (dialog) => {
                if (dialog.constructor.name === 'ManualCollectionSelectionDialogView') {
                    capturedItems = dialog.items || [];
                } else {
                    dialog.attachTo(container);
                }
            };

            const dialog = new DBRestoreDialogView({
                backupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
                restoreScope: 'targetConfigsOnly',
            });

            await dialog.initialize();
            dialog.attachTo(container);
            dialog._selectedMode = 'manual';
            await dialog._onConfirmAsync();

            assert.equal(capturedItems.length, 1);
            assert.equal(capturedItems[0].kind, 'targetConfig');
            assert.equal(capturedItems[0].id, 'target-only-item');
        });
    });
});
