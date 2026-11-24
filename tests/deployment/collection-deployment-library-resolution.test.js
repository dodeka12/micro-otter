import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';
import { calculateFileHash } from '../../src/micro_otter/nodes/html/js/deployment/deployment-utils.js';

const webviewGeneratorPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/node_generators.js'
);

function createFetchFromMap(responseMap) {
    return async (url) => {
        const key = String(url);
        const response = responseMap[key];
        if (!response) {
            return {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => {
                    throw new Error('Not Found');
                },
                text: async () => '',
            };
        }
        return response;
    };
}

async function withMockWindowOrigin(origin, callback) {
    const originalWindow = globalThis.window;
    globalThis.window = {
        location: {
            origin,
        },
    };

    try {
        return await callback();
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
}

describe('CollectionDeployment library resolution', () => {
    it('resolves libs/webview assets from wildcard mpAssets for dotted webview node ids', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/webview/libs/webview/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# webview package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/data_registry.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class WebDataRegistry:\n    pass\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/element_context.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class WebElementContext:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'webview.web-root') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewRoot',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/__init__.py',
                                                '/device/node_pkgs/webview/libs/webview/data_registry.py',
                                                '/device/node_pkgs/webview/libs/webview/element_context.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'webview.web-root' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 3);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
                    [
                        'libs/webview/__init__.py',
                        'libs/webview/data_registry.py',
                        'libs/webview/element_context.py',
                    ]
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('resolves node-type mpAssets for dotted webview radar-display node ids', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/webview/libs/webview/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# webview package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/utils.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'def clamp(value):\n    return value\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/radar.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'def state_store():\n    return {}\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'webview.radar-display') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewRadarDisplay',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/__init__.py',
                                            ],
                                            'radar-display': [
                                                '/device/node_pkgs/webview/libs/webview/utils.py',
                                                '/device/node_pkgs/webview/libs/webview/radar.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'webview.radar-display' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 3);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
                    ['libs/webview/__init__.py', 'libs/webview/radar.py', 'libs/webview/utils.py']
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('resolves node-type mpAssets for dotted webview joystick-display node ids', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/webview/libs/webview/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# webview package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/utils.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'def to_bool(value, fallback=True):\n    return fallback\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/joystick.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'def state_store():\n    return {}\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'webview.joystick-display') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewJoystickDisplay',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/__init__.py',
                                            ],
                                            'joystick-display': [
                                                '/device/node_pkgs/webview/libs/webview/utils.py',
                                                '/device/node_pkgs/webview/libs/webview/joystick.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'webview.joystick-display' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 3);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
                    [
                        'libs/webview/__init__.py',
                        'libs/webview/joystick.py',
                        'libs/webview/utils.py',
                    ]
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('prefers node package __mpycache__ artifacts when matching profile availability is provided', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/webview/libs/webview/data_registry.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class WebDataRegistry:\n    pass\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/__mpycache__/abc123def456/data_registry.mpy':
                    {
                        ok: true,
                        statusText: 'OK',
                        arrayBuffer: async () => new TextEncoder().encode('mpy-bytes').buffer,
                        text: async () => 'mpy-bytes',
                        json: async () => ({}),
                    },
                'http://localhost/device/node_pkgs/webview/libs/webview/__mpycache__/abc123def456/data_registry.mpy':
                    {
                        ok: true,
                        statusText: 'OK',
                        arrayBuffer: async () => new TextEncoder().encode('mpy-bytes').buffer,
                        text: async () => 'mpy-bytes',
                        json: async () => ({}),
                    },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'webview.web-root') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewRoot',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/data_registry.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'webview.web-root' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection, {
                    mpyCompileProfile: { hash: 'abc123def456' },
                    mpyAvailability: {
                        runtime: { hasProfile: false },
                        nodePackages: [{ packageId: 'webview', hasProfile: true }],
                    },
                });

                assert.equal(count, 1);
                assert.equal(
                    deployment._preparedFiles.libraries[0].devicePath,
                    'libs/webview/data_registry.mpy'
                );
                assert.match(
                    deployment._preparedFiles.libraries[0].url,
                    /__mpycache__\/abc123def456\/data_registry\.mpy$/
                );
                assert.ok(deployment._preparedFiles.libraries[0].content instanceof Uint8Array);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('resolves otter_stdmo assets from runtime nodePackages mpAssets on initial prepare', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# stdmo package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'from otter_stdmo.servo import Servo\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'stdmo-servo') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        dependencies: ['otter_stdmo.servo_callable'],
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'stdmo',
                                        mpAssets: {
                                            '*': ['/device/node_pkgs/stdmo/otter_stdmo/__init__.py'],
                                            servo: [
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo.py',
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 3);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
                    [
                        'otter_stdmo/__init__.py',
                        'otter_stdmo/servo.py',
                        'otter_stdmo/servo_callable.py',
                    ]
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('does not stage webview libs when collection does not use webview node types', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# stdmo package\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'stdmo-servo') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        dependencies: ['otter_stdmo.servo_callable'],
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/__init__.py',
                                                '/device/node_pkgs/webview/libs/webview/data_registry.py',
                                                '/device/node_pkgs/webview/libs/webview/element_context.py',
                                            ],
                                        },
                                    },
                                    {
                                        id: 'stdmo',
                                        mpAssets: {
                                            '*': ['/device/node_pkgs/stdmo/otter_stdmo/__init__.py'],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);
                const stagedPaths = deployment._preparedFiles.libraries.map(
                    (file) => file.devicePath
                );

                assert.equal(count, 1);
                assert.deepEqual(stagedPaths, ['otter_stdmo/__init__.py']);
                assert.equal(
                    stagedPaths.some((path) => path.startsWith('libs/webview/')),
                    false
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('syncCollectionFiles removes stale libs from previous collection deployment', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;
            const deletedFiles = [];
            const softResetCalls = [];

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# stdmo package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'from otter_stdmo.servo import Servo\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        isExecutionRunning() {
                            return false;
                        },
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset(options = {}) {
                            softResetCalls.push(options);
                        },
                        async deleteFile(path) {
                            deletedFiles.push(path);
                        },
                        async deleteFolderRecursive() {},
                        async removeFolder() {
                            return 1;
                        },
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                            capabilityToPins: {},
                            generalCapabilities: {},
                            metadata: {},
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        async transpileCollection() {
                            return { code: 'print("new collection")\n' };
                        },
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'stdmo-servo') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        dependencies: ['otter_stdmo.servo_callable'],
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'stdmo',
                                        mpAssets: {
                                            '*': ['/device/node_pkgs/stdmo/otter_stdmo/__init__.py'],
                                            servo: [
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo.py',
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    id: 'collection-2',
                    getId() {
                        return 'collection-2';
                    },
                    getTitle() {
                        return 'Second Collection';
                    },
                    getVersionString() {
                        return '2.0.0';
                    },
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [
                                        { id: 'node-1', type: 'stdmo-servo', controlValues: {} },
                                    ];
                                },
                            },
                        ];
                    },
                };

                await deployment.syncCollectionFiles(collection, {
                    deviceHashes: {
                        'app/main_loop.py': 'old-main',
                        'collection/node_graph_cln.json': 'old-meta',
                        'otter_stdmo/servo.py': 'old-servo',
                        'libs/oldpkg/legacy.py': 'old-legacy',
                    },
                });

                assert.deepEqual(deletedFiles, ['libs/oldpkg/legacy.py']);
                assert.deepEqual(softResetCalls, [{ startRunning: false }]);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });
    it('syncCollectionFiles soft-resets when only a package folder was removed', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalLog = globalThis.__microOtterLog;
            const capturedLogs = [];
            globalThis.__microOtterLog = {
                log(scope, reason, level, ...data) {
                    capturedLogs.push({ scope, reason, level, data });
                },
            };

            const softResetCalls = [];
            const removedFolderCalls = [];

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        isExecutionRunning() {
                            return false;
                        },
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset(options = {}) {
                            softResetCalls.push(options);
                        },
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                        async removeFolder(path, options = {}) {
                            removedFolderCalls.push({ path, options });
                            return 2;
                        },
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        runtimeVersion: '1.0.0',
                        runtimeDeploymentMode: 'embedded',
                        runtimeEmbedded: true,
                        deviceTargetInfo: {
                            id: 'esp32',
                            capabilityToPins: {},
                            generalCapabilities: {},
                            metadata: {},
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        async transpileCollection() {
                            return { code: 'print("unchanged")\n' };
                        },
                        getNodeType() {
                            return null;
                        },
                    },
                    runtimeCollection: {
                        getRuntime() {
                            return { id: 'general', version: '1.0.0', resolvedFilesystem: [] };
                        },
                    },
                    transpiler: {},
                });

                // Nothing is uploaded and no file is stale: the folder removal is the only change.
                deployment._uploadPreparedCollectionFiles = async () => 0;
                deployment._uploadPreparedLibraries = async () => 0;
                deployment._prepareNodeLibrariesUpload = async () => {
                    deployment._firmwareOwnedPackageFolders = new Map([['otter_vars', 'vars']]);
                    return 0;
                };
                deployment._delay = async () => {};

                const collection = {
                    getId() {
                        return 'collection-folder-sync';
                    },
                    getTitle() {
                        return 'Folder Sync';
                    },
                    getVersionString() {
                        return '1.0.0';
                    },
                    getGraphArray() {
                        return [{ getNodes: () => [] }];
                    },
                };

                const changedCount = await deployment.syncCollectionFiles(collection, {
                    deviceHashes: { 'app/main_loop.py': 'old-main' },
                });

                assert.deepEqual(
                    removedFolderCalls.map((call) => call.path),
                    ['otter_vars']
                );
                assert.equal(changedCount, 1, 'the removed folder counts as a change');
                assert.deepEqual(softResetCalls, [{ startRunning: false }]);

                const savedLog = capturedLogs.find(
                    (entry) => entry.reason === 'collection-hashes-saved'
                );
                assert.ok(savedLog, 'the hashes are saved because something changed');
                assert.equal(savedLog.data[0].staleLibraryFoldersRemoved, 1);
            } finally {
                if (originalLog === undefined) {
                    delete globalThis.__microOtterLog;
                } else {
                    globalThis.__microOtterLog = originalLog;
                }
            }
        });
    });



    it('syncCollectionFiles skips unchanged webview libs when hashes match manifest', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;
            const sentFiles = [];
            const writtenFiles = [];
            const softResetCalls = [];

            const webviewInit = '# webview package\n';
            const webviewElementContext = 'class WebElementContext:\n    pass\n';
            const transpiledCode = 'print("stable collection")\n';

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/webview/libs/webview/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => webviewInit,
                    json: async () => ({}),
                },
                '/device/node_pkgs/webview/libs/webview/element_context.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => webviewElementContext,
                    json: async () => ({}),
                },
            });

            try {
                const collection = {
                    id: 'collection-webview',
                    getId() {
                        return 'collection-webview';
                    },
                    getTitle() {
                        return 'Webview Collection';
                    },
                    getVersionString() {
                        return '1.0.0';
                    },
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [
                                        {
                                            id: 'node-1',
                                            type: 'webview.web-root',
                                            controlValues: {},
                                        },
                                    ];
                                },
                            },
                        ];
                    },
                };

                let manifest = '';

                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        isExecutionRunning() {
                            return false;
                        },
                        async readTextFile(path) {
                            if (path === '/.micro-otter-sync-manifest') {
                                return manifest;
                            }
                            return '';
                        },
                        async writeTextFile(path) {
                            writtenFiles.push(path);
                        },
                        async sendFile(path) {
                            sentFiles.push(path);
                        },
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset(options = {}) {
                            softResetCalls.push(options);
                        },
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                            capabilityToPins: {},
                            generalCapabilities: {},
                            metadata: {},
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        async transpileCollection() {
                            return { code: transpiledCode };
                        },
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'webview.web-root') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewRoot',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'webview',
                                        mpAssets: {
                                            '*': [
                                                '/device/node_pkgs/webview/libs/webview/__init__.py',
                                                '/device/node_pkgs/webview/libs/webview/element_context.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const metadata = deployment._generateCollectionMetadata(collection, false);
                const metadataStr = JSON.stringify(metadata, null, 2);
                const collectionHashes = {
                    'app/main_loop.py': await calculateFileHash(transpiledCode),
                    'collection/node_graph_cln.json': await calculateFileHash(metadataStr),
                    'libs/webview/__init__.py': await calculateFileHash(webviewInit),
                    'libs/webview/element_context.py':
                        await calculateFileHash(webviewElementContext),
                };

                manifest = JSON.stringify({
                    version: '1.0.0',
                    created: '2026-01-01T00:00:00.000Z',
                    updated: '2026-01-01T00:00:00.000Z',
                    collection: {
                        collectionId: collection.id,
                        collectionName: collection.getTitle(),
                        files: collectionHashes,
                    },
                });

                const changedCount = await deployment.syncCollectionFiles(collection);

                assert.equal(changedCount, 0);
                assert.deepEqual(sentFiles, []);
                assert.deepEqual(writtenFiles, []);
                assert.deepEqual(softResetCalls, []);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('resolves libs from implementation value path when dependencies are omitted', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/__init__.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => '# stdmo package\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'from otter_stdmo.servo import Servo\n',
                    json: async () => ({}),
                },
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const deployment = new CollectionDeployment({
                    deviceConnection: {
                        async readTextFile() {
                            return '';
                        },
                        async writeTextFile() {},
                        async sendFile() {},
                        async calculateHash() {
                            return 'hash';
                        },
                        async softReset() {},
                        async deleteFile() {},
                        async deleteFolderRecursive() {},
                    },
                    deviceState: {
                        connected: true,
                        runtimeInstalled: true,
                        runtimeId: 'general',
                        deviceTargetInfo: {
                            id: 'esp32',
                        },
                    },
                    updateDeviceState() {},
                    collectionManager: {
                        getNodeType(nodeTypeId) {
                            if (nodeTypeId !== 'stdmo-servo') {
                                return null;
                            }
                            return {
                                implementations: {
                                    python: {
                                        type: 'function',
                                        value: 'otter_stdmo.servo_callable.ServoNodeFn',
                                    },
                                },
                            };
                        },
                    },
                    runtimeCollection: {
                        getRuntime(runtimeId) {
                            if (runtimeId !== 'general') {
                                return null;
                            }
                            return {
                                id: 'general',
                                resolvedFilesystem: [],
                                nodePackages: [
                                    {
                                        id: 'stdmo',
                                        mpAssets: {
                                            '*': ['/device/node_pkgs/stdmo/otter_stdmo/__init__.py'],
                                            servo: [
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo.py',
                                                '/device/node_pkgs/stdmo/otter_stdmo/servo_callable.py',
                                            ],
                                        },
                                    },
                                ],
                            };
                        },
                    },
                    transpiler: {},
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 3);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
                    [
                        'otter_stdmo/__init__.py',
                        'otter_stdmo/servo.py',
                        'otter_stdmo/servo_callable.py',
                    ]
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('prepares additional generated collection artifacts from transpile result in-memory channel', async () => {
        const deployment = new CollectionDeployment({
            deviceConnection: {
                async readTextFile() {
                    return '';
                },
                async writeTextFile() {},
                async sendFile() {},
                async calculateHash() {
                    return 'hash';
                },
                async softReset() {},
                async deleteFile() {},
                async deleteFolderRecursive() {},
            },
            deviceState: {
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                deviceTargetInfo: {
                    id: 'esp32',
                },
            },
            updateDeviceState() {},
            collectionManager: {
                async transpileCollection() {
                    return {
                        code: 'print("hello")\n',
                        generatedArtifacts: [
                            {
                                targetPath: 'app/webserver_hooks_generated.py',
                                content: 'def handle_index(request, context):\n    return None\n',
                            },
                            {
                                targetPath: '/collection\\webview_manifest.json',
                                content: new Uint8Array([1, 2, 3]),
                            },
                        ],
                    };
                },
                getNodeType() {
                    return null;
                },
            },
            runtimeCollection: {
                getRuntime(runtimeId) {
                    if (runtimeId !== 'general') {
                        return null;
                    }
                    return {
                        id: 'general',
                        resolvedFilesystem: [],
                        nodePackages: [],
                    };
                },
            },
            transpiler: {},
        });

        const collection = {
            getId() {
                return 'collection-1';
            },
            getTitle() {
                return 'Generated Artifacts';
            },
            getVersionString() {
                return '1.0.0';
            },
            getGraphArray() {
                return [];
            },
        };

        const preparedCount = await deployment._prepareCollectionFilesUpload(collection, false);
        const preparedPaths = deployment._preparedFiles.collection
            .map((file) => file.devicePath)
            .sort();

        assert.equal(preparedCount, 4);
        assert.deepEqual(preparedPaths, [
            'app/main_loop.py',
            'app/webserver_hooks_generated.py',
            'collection/node_graph_cln.json',
            'collection/webview_manifest.json',
        ]);

        const binaryArtifact = deployment._preparedFiles.collection.find(
            (file) => file.devicePath === 'collection/webview_manifest.json'
        );
        assert.ok(binaryArtifact);
        assert.ok(binaryArtifact.content instanceof Uint8Array);
    });

    it('syncCollectionFiles uploads generated app artifacts and removes stale generated files', async () => {
        const sentFiles = [];
        const deletedFiles = [];
        const softResetCalls = [];

        const deployment = new CollectionDeployment({
            deviceConnection: {
                isExecutionRunning() {
                    return false;
                },
                async readTextFile() {
                    return '';
                },
                async writeTextFile() {},
                async sendFile(path, content) {
                    sentFiles.push({ path, content });
                },
                async calculateHash() {
                    return 'hash';
                },
                async softReset(options = {}) {
                    softResetCalls.push(options);
                },
                async deleteFile(path) {
                    deletedFiles.push(path);
                },
                async deleteFolderRecursive() {},
            },
            deviceState: {
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                deviceTargetInfo: {
                    id: 'esp32',
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                },
            },
            updateDeviceState() {},
            collectionManager: {
                async transpileCollection() {
                    return {
                        code: 'print("sync")\n',
                        generatedArtifacts: [
                            {
                                targetPath: 'app/webserver_hooks_generated.py',
                                content:
                                    'def register_extra_routes(server, context):\n    return None\n',
                            },
                        ],
                    };
                },
                getNodeType() {
                    return null;
                },
            },
            runtimeCollection: {
                getRuntime(runtimeId) {
                    if (runtimeId !== 'general') {
                        return null;
                    }
                    return {
                        id: 'general',
                        resolvedFilesystem: [],
                        nodePackages: [],
                    };
                },
            },
            transpiler: {},
        });

        const collection = {
            id: 'collection-sync',
            getId() {
                return 'collection-sync';
            },
            getTitle() {
                return 'Sync Generated Artifacts';
            },
            getVersionString() {
                return '1.0.0';
            },
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [];
                        },
                    },
                ];
            },
        };

        const changedCount = await deployment.syncCollectionFiles(collection, {
            deviceHashes: {
                'app/main_loop.py': 'old-main',
                'collection/node_graph_cln.json': 'old-meta',
                'app/legacy_generated.py': 'old-legacy',
            },
        });

        assert.equal(changedCount, 4);
        assert.deepEqual(sentFiles.map((entry) => entry.path).sort(), [
            'app/main_loop.py',
            'app/webserver_hooks_generated.py',
            'collection/node_graph_cln.json',
        ]);
        assert.deepEqual(deletedFiles, ['app/legacy_generated.py']);
        assert.deepEqual(softResetCalls, [{ startRunning: false }]);
    });

    it('syncCollectionFiles uploads real webview gzip artifacts generated by helper handoff flow', async () => {
        const originalSelf = globalThis.self;
        const originalWindow = globalThis.window;
        const originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        const originalNodeInitGenerators = globalThis.NodeInitGenerators;
        const originalNodeHelperGenerators = globalThis.NodeHelperGenerators;
        const originalNodeHelperHandoffConsumers = globalThis.NodeHelperHandoffConsumers;

        const sentFiles = [];
        const softResetCalls = [];
        const collectionId = 'collection-webview-gzip';

        try {
            globalThis.self = globalThis;
            delete globalThis.window;
            globalThis.NodeCodeGenerators = {};
            globalThis.NodeInitGenerators = {};
            globalThis.NodeHelperGenerators = {};
            globalThis.NodeHelperHandoffConsumers = {};

            const generatorUrl = pathToFileURL(webviewGeneratorPath);
            await import(`${generatorUrl.href}?test=deployment-webview-gzip`);

            const rootHelperGenerator = globalThis.NodeHelperGenerators?.webviewRoot;
            assert.equal(typeof rootHelperGenerator, 'function');

            const helperContribution = rootHelperGenerator({
                inputs: [],
                outputs: ['node_out0'],
                node: {
                    id: 'node-root',
                    type: 'web-root',
                    controlValues: {
                        title: 'Deployment Webview',
                    },
                },
                helpers: {
                    registerImport() {},
                    formatLiteral(value) {
                        return JSON.stringify(value);
                    },
                    createOutputName(index) {
                        return `node_dynamic_out${index}`;
                    },
                },
            });

            const helperConsumer = globalThis.NodeHelperHandoffConsumers?.['web-runtime'];
            assert.equal(typeof helperConsumer, 'function');

            const helperResult = await helperConsumer({
                group: {
                    mergedData: {
                        ...(helperContribution?.data || {}),
                    },
                    webserverSpecPatch: {
                        ...(helperContribution?.webserverSpecPatch || {}),
                    },
                },
                collection: {
                    id: collectionId,
                    title: 'Deployment Webview Collection',
                },
            });

            const generatedArtifacts = Array.isArray(helperResult?.artifacts)
                ? helperResult.artifacts
                : [];
            const expectedGzipPath = `collection/webview/${collectionId}/index.html.gz`;
            const expectedClientGzipPath = `collection/webview/${collectionId}/webview_client.js.gz`;

            const generatedIndexGzip = generatedArtifacts.find(
                (artifact) => artifact.targetPath === expectedGzipPath
            );
            assert.ok(generatedIndexGzip?.content instanceof Uint8Array);

            const deployment = new CollectionDeployment({
                deviceConnection: {
                    isExecutionRunning() {
                        return false;
                    },
                    async readTextFile() {
                        return '';
                    },
                    async writeTextFile() {},
                    async sendFile(path, content) {
                        sentFiles.push({ path, content });
                    },
                    async calculateHash() {
                        return 'hash';
                    },
                    async softReset(options = {}) {
                        softResetCalls.push(options);
                    },
                    async deleteFile() {},
                    async deleteFolderRecursive() {},
                },
                deviceState: {
                    connected: true,
                    runtimeInstalled: true,
                    runtimeId: 'general',
                    deviceTargetInfo: {
                        id: 'esp32',
                        capabilityToPins: {},
                        generalCapabilities: {},
                        metadata: {},
                    },
                },
                updateDeviceState() {},
                collectionManager: {
                    async transpileCollection() {
                        return {
                            code: 'print("webview deploy")\n',
                            generatedArtifacts,
                        };
                    },
                    getNodeType(nodeTypeId) {
                        if (nodeTypeId === 'webview.web-root') {
                            return {
                                implementations: {
                                    python: {
                                        value: 'NodeCodeGenerators.webviewRoot',
                                    },
                                },
                            };
                        }
                        return null;
                    },
                },
                runtimeCollection: {
                    getRuntime(runtimeId) {
                        if (runtimeId !== 'general') {
                            return null;
                        }
                        return {
                            id: 'general',
                            resolvedFilesystem: [],
                            nodePackages: [],
                        };
                    },
                },
                transpiler: {},
            });

            const collection = {
                id: collectionId,
                getId() {
                    return collectionId;
                },
                getTitle() {
                    return 'Deployment Webview Collection';
                },
                getVersionString() {
                    return '1.0.0';
                },
                getGraphArray() {
                    return [
                        {
                            getNodes() {
                                return [
                                    {
                                        id: 'node-root',
                                        type: 'webview.web-root',
                                        controlValues: {
                                            title: 'Deployment Webview',
                                        },
                                    },
                                ];
                            },
                            getConnections() {
                                return [];
                            },
                        },
                    ];
                },
            };

            const changedCount = await deployment.syncCollectionFiles(collection, {
                deviceHashes: {
                    'app/main_loop.py': 'old-main',
                    'collection/node_graph_cln.json': 'old-meta',
                },
            });

            assert.equal(changedCount, generatedArtifacts.length + 2);

            const uploadedPaths = sentFiles.map((entry) => entry.path);
            assert.ok(uploadedPaths.includes(expectedGzipPath));
            assert.ok(uploadedPaths.includes(expectedClientGzipPath));

            const uploadedIndexGzip = sentFiles.find((entry) => entry.path === expectedGzipPath);
            assert.ok(uploadedIndexGzip?.content instanceof Uint8Array);
            assert.equal(uploadedIndexGzip?.content?.[0], 0x1f);
            assert.equal(uploadedIndexGzip?.content?.[1], 0x8b);
            assert.deepEqual(softResetCalls, [{ startRunning: false }]);
        } finally {
            if (originalSelf === undefined) {
                delete globalThis.self;
            } else {
                globalThis.self = originalSelf;
            }

            if (originalWindow === undefined) {
                delete globalThis.window;
            } else {
                globalThis.window = originalWindow;
            }

            if (originalNodeCodeGenerators === undefined) {
                delete globalThis.NodeCodeGenerators;
            } else {
                globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
            }

            if (originalNodeInitGenerators === undefined) {
                delete globalThis.NodeInitGenerators;
            } else {
                globalThis.NodeInitGenerators = originalNodeInitGenerators;
            }

            if (originalNodeHelperGenerators === undefined) {
                delete globalThis.NodeHelperGenerators;
            } else {
                globalThis.NodeHelperGenerators = originalNodeHelperGenerators;
            }

            if (originalNodeHelperHandoffConsumers === undefined) {
                delete globalThis.NodeHelperHandoffConsumers;
            } else {
                globalThis.NodeHelperHandoffConsumers = originalNodeHelperHandoffConsumers;
            }
        }
    });
});

function createAssetResponse() {
    return {
        ok: true,
        statusText: 'OK',
        text: async () => '# package asset\n',
        json: async () => ({}),
    };
}

function createPackageFetchMap(nodePackages) {
    const routes = {};
    for (const nodePackage of nodePackages) {
        for (const assets of Object.values(nodePackage.mpAssets || {})) {
            for (const assetUrl of assets) {
                routes[String(assetUrl)] = createAssetResponse();
            }
        }
    }
    return routes;
}

async function stagePackageLibraries({ nodeTypes, nodePackages }) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = createFetchFromMap(createPackageFetchMap(nodePackages));

    try {
        return await withMockWindowOrigin('http://localhost', async () => {
            const deployment = new CollectionDeployment({
                deviceConnection: {
                    async readTextFile() {
                        return '';
                    },
                    async writeTextFile() {},
                    async sendFile() {},
                    async calculateHash() {
                        return 'hash';
                    },
                    async softReset() {},
                    async deleteFile() {},
                    async deleteFolderRecursive() {},
                },
                deviceState: {
                    connected: true,
                    runtimeInstalled: true,
                    runtimeId: 'general',
                    deviceTargetInfo: {
                        id: 'esp32',
                    },
                },
                updateDeviceState() {},
                collectionManager: {
                    getNodeType() {
                        return null;
                    },
                },
                runtimeCollection: {
                    getRuntime(runtimeId) {
                        if (runtimeId !== 'general') {
                            return null;
                        }
                        return {
                            id: 'general',
                            resolvedFilesystem: [],
                            nodePackages,
                        };
                    },
                },
                transpiler: {},
            });

            const collection = {
                getGraphArray() {
                    return [
                        {
                            getNodes() {
                                return nodeTypes.map((type) => ({ type }));
                            },
                        },
                    ];
                },
            };

            await deployment._prepareNodeLibrariesUpload(collection);
            return deployment._preparedFiles.libraries.map((file) => file.devicePath).sort();
        });
    } finally {
        if (originalFetch === undefined) {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = originalFetch;
        }
    }
}

describe('CollectionDeployment requiredPackages expansion', () => {
    it('stages required package assets for a package that is in use', async () => {
        const stagedPaths = await stagePackageLibraries({
            nodeTypes: ['webview.web-root'],
            nodePackages: [
                {
                    id: 'webview',
                    requiredPackages: ['vars'],
                    mpAssets: {
                        '*': ['/device/node_pkgs/webview/libs/webview/__init__.py'],
                    },
                },
                {
                    id: 'vars',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/vars/otter_vars/__init__.py',
                            '/device/node_pkgs/vars/otter_vars/store.py',
                            '/device/node_pkgs/vars/otter_vars/arrays.py',
                        ],
                    },
                },
            ],
        });

        assert.deepEqual(stagedPaths, [
            'libs/webview/__init__.py',
            'otter_vars/__init__.py',
            'otter_vars/arrays.py',
            'otter_vars/store.py',
        ]);
    });

    it('follows transitive required packages', async () => {
        const stagedPaths = await stagePackageLibraries({
            nodeTypes: ['a.thing'],
            nodePackages: [
                {
                    id: 'a',
                    requiredPackages: ['b'],
                    mpAssets: { '*': ['/device/node_pkgs/a/otter_a/__init__.py'] },
                },
                {
                    id: 'b',
                    requiredPackages: ['c'],
                    mpAssets: { '*': ['/device/node_pkgs/b/otter_b/__init__.py'] },
                },
                {
                    id: 'c',
                    mpAssets: { '*': ['/device/node_pkgs/c/otter_c/__init__.py'] },
                },
            ],
        });

        assert.deepEqual(stagedPaths, [
            'otter_a/__init__.py',
            'otter_b/__init__.py',
            'otter_c/__init__.py',
        ]);
    });

    it('terminates on cyclic package declarations and stages each package once', async () => {
        const stagedPaths = await stagePackageLibraries({
            nodeTypes: ['a.thing'],
            nodePackages: [
                {
                    id: 'a',
                    requiredPackages: ['b'],
                    mpAssets: { '*': ['/device/node_pkgs/a/otter_a/__init__.py'] },
                },
                {
                    id: 'b',
                    requiredPackages: ['a'],
                    mpAssets: { '*': ['/device/node_pkgs/b/otter_b/__init__.py'] },
                },
            ],
        });

        assert.deepEqual(stagedPaths, ['otter_a/__init__.py', 'otter_b/__init__.py']);
    });

    it('ignores unknown required package ids', async () => {
        const stagedPaths = await stagePackageLibraries({
            nodeTypes: ['a.thing'],
            nodePackages: [
                {
                    id: 'a',
                    requiredPackages: ['missing'],
                    mpAssets: { '*': ['/device/node_pkgs/a/otter_a/__init__.py'] },
                },
            ],
        });

        assert.deepEqual(stagedPaths, ['otter_a/__init__.py']);
    });

    it('does not duplicate assets when both packages are in use', async () => {
        const stagedPaths = await stagePackageLibraries({
            nodeTypes: ['webview.web-root', 'vars.var-read'],
            nodePackages: [
                {
                    id: 'webview',
                    requiredPackages: ['vars'],
                    mpAssets: {
                        '*': ['/device/node_pkgs/webview/libs/webview/__init__.py'],
                    },
                },
                {
                    id: 'vars',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/vars/otter_vars/__init__.py',
                            '/device/node_pkgs/vars/otter_vars/store.py',
                        ],
                    },
                },
            ],
        });

        assert.deepEqual(stagedPaths, [
            'libs/webview/__init__.py',
            'otter_vars/__init__.py',
            'otter_vars/store.py',
        ]);
    });
});

describe('add-on module namespace classification', () => {
    function makeDeployment() {
        return new CollectionDeployment({
            deviceConnection: {},
            deviceState: {},
            updateDeviceState: () => {},
            collectionManager: {},
            runtimeCollection: {},
            transpiler: {},
        });
    }

    it('scans moa_ imports and ignores non-package imports', () => {
        const deployment = makeDeployment();

        assert.deepEqual(
            deployment._extractPythonImports('import moa_hello\nimport os\nfrom app import main\n'),
            ['moa_hello']
        );
    });

    it('treats moa_ paths as managed library paths', () => {
        const deployment = makeDeployment();

        assert.equal(deployment._isManagedCollectionPath('moa_hello/__init__.py'), true);
        assert.equal(deployment._isManagedCollectionPath('app/main_loop.py'), true);
    });
});

