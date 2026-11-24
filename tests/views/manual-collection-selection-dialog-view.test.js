// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ManualCollectionSelectionDialogView } from '../../src/micro_otter/nodes/html/js/views/manual-collection-selection-dialog-view.js';

const TEST_TIMEOUT_MS = 10000;

describe('ManualCollectionSelectionDialogView', { timeout: TEST_TIMEOUT_MS }, () => {
    let dom;
    let document;
    let window;
    let container;
    let mockWorkspace;
    let mockViewManager;
    let mockBackupData;
    let mockItems;

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
        mockWorkspace = {
            deleteCollection: async (_id) => {},
            saveCollection: async (_collection) => {},
        };

        // Mock view manager
        mockViewManager = {
            showModal: (dialog) => {
                dialog.attachTo(container);
            },
        };

        // Mock backup data
        mockBackupData = {
            version: '1.0',
            timestamp: Date.now(),
            collections: [
                {
                    id: 'collection-1',
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
                {
                    id: 'collection-2',
                    title: 'Collection 2',
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
        };

        // Mock items
        mockItems = [
            {
                id: 'collection-1',
                title: 'Collection 1',
                backupVersion: '1.0.0',
                localVersion: null,
                status: 'new',
            },
            {
                id: 'collection-2',
                title: 'Collection 2',
                backupVersion: '2.0.0',
                localVersion: '1.0.0',
                status: 'newer',
            },
        ];
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
    });

    describe('Dialog Rendering', () => {
        it('should render table with collection items', () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const table = container.querySelector('.manual-selection-dialog__table');
            assert.ok(table, 'Should render table');

            const rows = table.querySelectorAll('.manual-selection-dialog__table-row');
            // Header + 2 data rows
            assert.equal(rows.length, 3, 'Should render header and data rows');
        });

        it('should render status indicators', () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const statusCells = container.querySelectorAll('.db-restore-status');
            assert.equal(statusCells.length, 2, 'Should render status for each item');
            
            assert.ok(
                statusCells[0].textContent.includes('New'),
                'Should show "New" status'
            );
            assert.ok(
                statusCells[1].textContent.includes('Newer'),
                'Should show "Newer" status'
            );
        });
    });

    describe('Default Selection', () => {
        it('should pre-select new and newer collections', () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            assert.equal(checkboxes.length, 2, 'Should render checkboxes');
            
            assert.equal(checkboxes[0].checked, true, 'Should check new collection');
            assert.equal(checkboxes[1].checked, true, 'Should check newer collection');
        });

        it('should not pre-select older collections', () => {
            const items = [
                {
                    id: 'collection-1',
                    title: 'Collection 1',
                    backupVersion: '1.0.0',
                    localVersion: '2.0.0',
                    status: 'older',
                },
            ];

            const dialog = new ManualCollectionSelectionDialogView({
                items,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const checkbox = container.querySelector('input[type="checkbox"]');
            assert.equal(checkbox.checked, false, 'Should not check older collection');
        });
    });

    describe('Manual Selection', () => {
        it('should track checkbox changes', () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const checkbox = container.querySelector('input[type="checkbox"]');
            assert.equal(dialog._manualSelections.get('collection-1'), true, 'Initial state');
            
            // Uncheck
            checkbox.checked = false;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(dialog._manualSelections.get('collection-1'), false, 'After uncheck');
            
            // Check again
            checkbox.checked = true;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(dialog._manualSelections.get('collection-1'), true, 'After recheck');
        });

        it('should get checked table items', () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            // Uncheck the first item
            const checkbox = container.querySelector('input[type="checkbox"]');
            checkbox.checked = false;
            checkbox.dispatchEvent(new window.Event('change'));

            const checkedItems = dialog._getCheckedTableItems();
            assert.equal(checkedItems.length, 1, 'Should return only checked items');
            assert.equal(checkedItems[0].title, 'Collection 2', 'Should return correct item');
        });

        it('should render and track target config rows', () => {
            const items = [
                {
                    kind: 'targetConfig',
                    id: 'target-1',
                    title: 'Target One',
                    backupVersion: '1.2.0',
                    localVersion: '1.0.0',
                    status: 'newer',
                },
            ];

            const backupData = {
                ...mockBackupData,
                targetConfigs: {
                    items: [
                        {
                            id: 'target-1',
                            displayName: 'Target One',
                            version: '1.2.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-1' },
                        },
                    ],
                },
            };

            const dialog = new ManualCollectionSelectionDialogView({
                items,
                backupData,
                workspace: {
                    ...mockWorkspace,
                    saveUserTargetConfig: async (targetConfig) => targetConfig,
                    deleteUserTargetConfig: async () => {},
                },
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const checkedItems = dialog._getCheckedTableItems();
            assert.equal(checkedItems.length, 1);
            assert.equal(checkedItems[0].kind, 'targetConfig');
            assert.equal(checkedItems[0].id, 'target-1');
        });
    });

    describe('Confirmation Handling', () => {
        it('should show error if no collections selected', async () => {
            const dialog = new ManualCollectionSelectionDialogView({
                items: mockItems,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            // Uncheck all
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((cb) => {
                cb.checked = false;
                cb.dispatchEvent(new window.Event('change'));
            });

            // Mock showError
            let errorShown = false;
            dialog._showError = async (title, _message) => {
                errorShown = true;
                assert.equal(title, 'No Selection');
            };

            const result = await dialog._handleConfirmAsync();
            assert.equal(result.confirmed, false, 'Should not confirm');
            assert.equal(errorShown, true, 'Should show error');
        });

        it('should prompt for overwrite confirmation when needed', async () => {
            const items = [
                {
                    id: 'collection-1',
                    title: 'Collection 1',
                    backupVersion: '2.0.0',
                    localVersion: '1.0.0',
                    status: 'newer',
                },
            ];

            const dialog = new ManualCollectionSelectionDialogView({
                items,
                backupData: mockBackupData,
                workspace: mockWorkspace,
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            // Mock overwrite confirmation (user cancels)
            dialog._showOverwriteConfirmation = async () => false;

            const result = await dialog._handleConfirmAsync();
            assert.equal(result.confirmed, false, 'Should not confirm if user cancels');
        });

        it('should execute manual restore for target config selections', async () => {
            const targetSaveCalls = [];
            const targetDeleteCalls = [];

            const items = [
                {
                    kind: 'targetConfig',
                    id: 'target-2',
                    title: 'Target Two',
                    backupVersion: '2.0.0',
                    localVersion: '1.0.0',
                    status: 'newer',
                },
            ];

            const backupData = {
                ...mockBackupData,
                targetConfigs: {
                    items: [
                        {
                            id: 'target-2',
                            displayName: 'Target Two',
                            version: '2.0.0',
                            created: '2026-02-22',
                            source: 'user',
                            targetData: { id: 'target-2' },
                        },
                    ],
                },
            };

            const dialog = new ManualCollectionSelectionDialogView({
                items,
                backupData,
                workspace: {
                    ...mockWorkspace,
                    deleteUserTargetConfig: async (id) => {
                        targetDeleteCalls.push(id);
                    },
                    saveUserTargetConfig: async (targetConfig) => {
                        targetSaveCalls.push(targetConfig.id);
                        return targetConfig;
                    },
                },
                viewManager: mockViewManager,
            });

            dialog.attachTo(container);

            const checkedItems = dialog._getCheckedTableItems();
            const results = await dialog._executeManualRestore(checkedItems);

            assert.deepEqual(targetDeleteCalls, ['target-2']);
            assert.deepEqual(targetSaveCalls, ['target-2']);
            assert.ok(results.overwritten.includes('Target: Target Two'));
        });
    });
});
