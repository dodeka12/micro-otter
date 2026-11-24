import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DeviceDeploymentView } from '../../src/micro_otter/nodes/html/js/views/device-deployment-view.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

describe('DeviceDeploymentView - Download Collection', () => {
    let dom, container;

    function createMocks() {
        let mockDeviceDeployment;

        const mockCollectionManager = {
            getActiveCollection: () => null,
            onChange: () => () => {},
            on: () => () => {},
            loadCollection: async () => null,
            saveCollection: async () => {},
            deleteCollection: async () => {},
            setActiveCollectionId: () => {},
        };

        const mockDeviceConnection = {
            isConnected: () => {
                return Boolean(mockDeviceDeployment?.getDeviceState?.()?.connected);
            },
            readTextFile: async (_path) => {
                throw new Error('Mock not configured for readTextFile');
            },
        };

        mockDeviceDeployment = {
            getDeviceState: () => new DeviceState({ connected: false }),
            getDeviceConnection: () => mockDeviceConnection,
            addEventListener: () => {},
            removeEventListener: () => {},
        };

        const mockRuntimeCollection = {
            getRuntime: (id) => ({ id, name: id }),
        };

        const mockI18nService = {
            t: (key, params) => {
                if (!params) return key;
                let result = key;
                for (const [k, v] of Object.entries(params)) {
                    result = result.replace(`{{${k}}}`, v);
                }
                return result;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
        };

        const mockViewManager = {
            addReference: () => {},
            removeReference: () => {},
            showConfirmation: async () => false,
            showError: async () => {},
            showInfo: async () => {},
        };

        return {
            collectionManager: mockCollectionManager,
            deviceDeployment: mockDeviceDeployment,
            runtimeCollection: mockRuntimeCollection,
            deviceConnection: mockDeviceConnection,
            i18nService: mockI18nService,
            viewManager: mockViewManager,
        };
    }

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.customElements = dom.window.customElements;
        global.alert = () => {}; // Suppress alerts in tests
        global.confirm = () => false; // Default to cancel

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    describe('Download button visibility', () => {
        it('does not mount the download button when device not connected', () => {
            const mocks = createMocks();
            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: false,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            assert.equal(
                container.querySelector('.device-deployment-download-button'),
                null,
                'The disconnected shell only mounts the Help pane'
            );

            view.detach();
        });

        it('hides download button when no collection deployed', () => {
            const mocks = createMocks();
            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    runtimeInstalled: true,
                    collectionDeployed: false,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            const button = container.querySelector('.device-deployment-download-button');
            assert.equal(button.style.display, 'none', 'Button should be hidden when no collection');

            view.detach();
        });

        it('hides download button when collection has no full definition', () => {
            const mocks = createMocks();
            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    runtimeInstalled: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: false,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            const button = container.querySelector('.device-deployment-download-button');
            assert.equal(button.style.display, 'none', 'Button should be hidden without full definition');

            view.detach();
        });

        it('shows download button when all conditions met', () => {
            const mocks = createMocks();
            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    runtimeInstalled: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: true,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            const button = container.querySelector('.device-deployment-download-button');
            assert.notEqual(button.style.display, 'none', 'Button should be visible');

            view.detach();
        });
    });

    describe('Download collection functionality', () => {
        it('reads collection data from device', async () => {
            const mocks = createMocks();
            let readCalled = false;
            let readPath = null;

            mocks.deviceConnection.readTextFile = async (path) => {
                readCalled = true;
                readPath = path;
                return JSON.stringify({
                    uuid: 'device-collection-id',
                    name: 'Device Collection',
                    version: '2.0.0',
                    targetId: 'ESP32-S3',
                    deviceRuntimeId: 'general',
                    hasFullDefinition: true,
                    graphs: [{ id: 'graph1', nodes: [] }],
                    activeGraphIdx: 0,
                });
            };

            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: true,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            const collectionData = await view._getDeviceCollectionData();

            assert.ok(readCalled, 'Should call readTextFile');
            assert.equal(readPath, '/collection/node_graph_cln.json', 'Should read correct path');
            assert.equal(collectionData.id, 'device-collection-id', 'Should have correct ID');
            assert.equal(collectionData.title, 'Device Collection', 'Should have correct title');
            assert.ok(collectionData.hasFullDefinition, 'Should have full definition flag');

            view.detach();
        });

        it('imports new collection when no UUID conflict', async () => {
            const mocks = createMocks();
            let savedCollection = null;
            let activatedId = null;

            mocks.deviceConnection.readTextFile = async () => {
                return JSON.stringify({
                    uuid: 'a1b2c3d4-e5f6-4a1b-8c9d-0e1f2a3b4c5d',
                    name: 'New Collection',
                    version: '1.0.0',
                    targetId: 'ESP32-S3',
                    deviceRuntimeId: 'general',
                    hasFullDefinition: true,
                    graphs: [{ id: 'g1', nodes: [] }],
                    activeGraphIdx: 0,
                });
            };

            mocks.collectionManager.loadCollection = async () => null; // No conflict
            mocks.collectionManager.saveCollection = async (collection) => {
                savedCollection = collection;
            };
            mocks.collectionManager.setActiveCollectionId = (id) => {
                activatedId = id;
            };

            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: true,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            await view._handleDownloadCollection();

            assert.ok(savedCollection, 'Should save collection');
            assert.equal(activatedId, 'a1b2c3d4-e5f6-4a1b-8c9d-0e1f2a3b4c5d', 'Should activate new collection');

            view.detach();
        });

        it('shows confirmation dialog when UUID conflict exists', async () => {
            const mocks = createMocks();
            let confirmCalled = false;

            mocks.deviceConnection.readTextFile = async () => {
                return JSON.stringify({
                    uuid: '12345678-1234-4234-8234-123456789012',
                    name: 'Device Version',
                    version: '2.0.0',
                    targetId: 'ESP32-S3',
                    deviceRuntimeId: 'general',
                    hasFullDefinition: true,
                    graphs: [{ id: 'g1', nodes: [] }],
                    activeGraphIdx: 0,
                });
            };

            const existingCollection = {
                getId: () => '12345678-1234-4234-8234-123456789012',
                getTitle: () => 'Local Version',
                getVersionString: () => '1.0.0',
            };

            mocks.collectionManager.loadCollection = async () => existingCollection;
            mocks.viewManager.showConfirmation = async ({ message }) => {
                confirmCalled = true;
                assert.ok(message.includes('Local Version') || message.includes('localName'), 'Should mention local collection');
                assert.ok(message.includes('Device Version') || message.includes('deviceName'), 'Should mention device collection');
                return false; // Cancel
            };

            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: true,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            await view._handleDownloadCollection();

            assert.ok(confirmCalled, 'Should show confirmation dialog');

            view.detach();
        });

        it('overwrites existing collection when user confirms', async () => {
            const mocks = createMocks();
            let deletedId = null;
            let savedCollection = null;

            mocks.deviceConnection.readTextFile = async () => {
                return JSON.stringify({
                    uuid: '87654321-4321-4321-8421-210987654321',
                    name: 'Device Version',
                    version: '2.0.0',
                    targetId: 'ESP32-S3',
                    deviceRuntimeId: 'general',
                    hasFullDefinition: true,
                    graphs: [{ id: 'g1', nodes: [] }],
                    activeGraphIdx: 0,
                });
            };

            const existingCollection = {
                getId: () => '87654321-4321-4321-8421-210987654321',
                getTitle: () => 'Local Version',
                getVersionString: () => '1.0.0',
            };

            mocks.collectionManager.loadCollection = async () => existingCollection;
            mocks.collectionManager.deleteCollection = async (id) => {
                deletedId = id;
            };
            mocks.collectionManager.saveCollection = async (collection) => {
                savedCollection = collection;
            };
            mocks.collectionManager.setActiveCollectionId = () => {};

            mocks.viewManager.showConfirmation = async () => true; // Confirm overwrite

            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: true,
                });

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            await view._handleDownloadCollection();

            assert.equal(deletedId, '87654321-4321-4321-8421-210987654321', 'Should delete existing collection');
            assert.ok(savedCollection, 'Should save new collection');

            view.detach();
        });

        it('handles error when collection has no full definition', async () => {
            const mocks = createMocks();
            let errorShown = false;
            let errorMessage = '';

            mocks.deviceConnection.readTextFile = async () => {
                return JSON.stringify({
                    uuid: 'collection-id',
                    name: 'Incomplete',
                    version: '1.0.0',
                    hasFullDefinition: false, // Missing full definition
                });
            };

            mocks.deviceDeployment.getDeviceState = () =>
                new DeviceState({
                    connected: true,
                    collectionDeployed: true,
                    collectionHasFullDefinition: false,
                });

            mocks.viewManager.showError = async ({ message }) => {
                errorShown = true;
                errorMessage = message;
            };

            const view = new DeviceDeploymentView(mocks);
            view.attachTo(container);

            await view._handleDownloadCollection();

            assert.ok(errorShown, 'Should show error');
            assert.ok(
                errorMessage.includes('noFullDefinition'),
                'Error should mention missing full definition'
            );

            view.detach();
        });
    });
});
