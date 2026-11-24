import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

const ACTIVE_TARGET_PATH = '/device/targets/active_target.json';

/**
 * A complete active-target payload as the app writes it: identity plus pin information.
 *
 * The reader rejects anything without pin information, so fixtures that model a provisioned
 * device must look like this instead of the legacy identity-only payload.
 */
const COMPLETE_TARGET_PAYLOAD = {
    targetId: 'esp32-test',
    displayName: 'ESP32 Test Board',
    description: 'Test board',
    pinCapabilities: {
        5: { label: 'GPIO5', digital: { input: true, output: true } },
    },
};

/**
 * Build a connected connection with an optional logger so tests can inspect log keys.
 * @param {Object} [logger] Logger receiving `log(message, data)` calls; silent by default.
 * @returns {DeviceConnection} Connected connection with a stub transport.
 */
function createConnectedConnection(logger = { log: () => {}, warn: () => {}, error: () => {} }) {
    const connection = new DeviceConnection({
        providers: {},
        logger,
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = {
        addEventListener() {},
        removeEventListener() {},
        async send() {},
        async disconnect() {},
        isConnected() {
            return true;
        },
    };

    return connection;
}

describe('DeviceConnection loadDeviceInfo manifest fallback', () => {
    it('requests onboarding and re-reads device info when embedded runtime has no target', async () => {
        const connection = createConnectedConnection();
        let onboardingRequests = 0;
        let targetConfigured = false;

        connection.setEmbeddedOnboardingAdapter({
            requestSelection: async () => {
                onboardingRequests += 1;
                return {
                    confirmed: true,
                    selectedTargetId: 'esp32-test',
                    userDescription: 'Test board',
                };
            },
            uploadTargetConfiguration: async () => {
                targetConfigured = true;
            },
        });

        let initStatusEvent = null;
        connection.addEventListener('device-initialization-status', (event) => {
            initStatusEvent = event.detail;
        });

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'embedded', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: {
                        id: 'general',
                        version: '1.11.0',
                        description: 'General runtime',
                    },
                });
            }

            if (path === '/device.json') {
                if (targetConfigured) {
                    return JSON.stringify({
                        runtime: 'general',
                        version: '1.11.0',
                        targetId: 'esp32-test',
                        targetConfigPath: '/device/targets/active_target.json',
                    });
                }
                throw new Error('[Errno 2] ENOENT');
            }

            if (path === '/device/targets/active_target.json') {
                if (targetConfigured) {
                    return JSON.stringify(COMPLETE_TARGET_PAYLOAD);
                }
                throw new Error('[Errno 2] ENOENT');
            }

            if (path === '/collection/node_graph_cln.json') {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        const state = await connection.loadDeviceInfo();

        assert.equal(onboardingRequests, 1);
        assert.equal(state.runtimeInstalled, true);
        assert.equal(state.deviceTargetInfo?.id, 'esp32-test');
        assert.equal(initStatusEvent?.runtimePresent, true);
        assert.equal(initStatusEvent?.specificTargetPresent, true);
        assert.equal(initStatusEvent?.runtimeDeploymentMode, 'embedded');
        assert.equal(initStatusEvent?.initializationVerdict, 'ready');
        assert.equal(initStatusEvent?.onboardingActionable, false);
    });

    it('emits onboarding error and rejects when second pass still lacks target', async () => {
        const connection = createConnectedConnection();
        let onboardingErrorDialog = null;

        connection.setEmbeddedOnboardingAdapter({
            requestSelection: async () => ({
                confirmed: true,
                selectedTargetId: 'esp32-test',
                userDescription: 'Test board',
            }),
            uploadTargetConfiguration: async () => {},
            showError: async (payload) => {
                onboardingErrorDialog = payload;
            },
        });

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'embedded', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: {
                        id: 'general',
                        version: '1.11.0',
                        description: 'General runtime',
                    },
                });
            }

            if (
                path === '/device/targets/active_target.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        await assert.rejects(async () => {
            await connection.loadDeviceInfo();
        }, /Failed to verify device info after onboarding/i);

        assert.ok(onboardingErrorDialog);
        assert.match(onboardingErrorDialog.message, /specific target is still missing/i);
    });

    it('rejects when onboarding selection is cancelled for embedded runtime without target', async () => {
        const connection = createConnectedConnection();

        connection.setEmbeddedOnboardingAdapter({
            requestSelection: async () => ({
                confirmed: false,
                error: 'Onboarding cancelled by user.',
            }),
            uploadTargetConfiguration: async () => {},
        });

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'embedded', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };

        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: {
                        id: 'general',
                        version: '1.11.0',
                        description: 'General runtime',
                    },
                });
            }

            if (path === '/device.json') {
                throw new Error('[Errno 2] ENOENT');
            }

            if (
                path === '/device/targets/active_target.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        await assert.rejects(async () => {
            await connection.loadDeviceInfo();
        }, /Onboarding cancelled by user/i);
    });

    it('emits initialization status with runtime-install verdict when runtime is missing', async () => {
        const connection = createConnectedConnection();
        let initStatusEvent = null;

        connection.addEventListener('device-initialization-status', (event) => {
            initStatusEvent = event.detail;
        });

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: false, error: 'module not found' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (
                path === '/manifest.json' ||
                path === '/device.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        await connection.loadDeviceInfo();

        assert.equal(initStatusEvent?.runtimePresent, false);
        assert.equal(initStatusEvent?.specificTargetPresent, false);
        assert.equal(initStatusEvent?.runtimeDeploymentMode, 'unknown');
        assert.equal(initStatusEvent?.initializationVerdict, 'ready-for-runtime-install');
        assert.equal(initStatusEvent?.onboardingActionable, false);
    });

    it('emits runtime-install verdict for dynamic mode when specific target is missing', async () => {
        const connection = createConnectedConnection();
        let initStatusEvent = null;

        connection.addEventListener('device-initialization-status', (event) => {
            initStatusEvent = event.detail;
        });

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'dynamic', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: {
                        id: 'general',
                        version: '1.11.0',
                        description: 'General runtime',
                    },
                });
            }

            if (
                path === '/device/targets/active_target.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        await connection.loadDeviceInfo();

        assert.equal(initStatusEvent?.runtimePresent, true);
        assert.equal(initStatusEvent?.specificTargetPresent, false);
        assert.equal(initStatusEvent?.runtimeDeploymentMode, 'dynamic');
        assert.equal(initStatusEvent?.initializationVerdict, 'ready-for-runtime-install');
        assert.equal(initStatusEvent?.onboardingActionable, false);
    });

    it('retries the embedded metadata probe after an empty response', async () => {
        const connection = createConnectedConnection();
        let initStatusEvent = null;

        connection.addEventListener('device-initialization-status', (event) => {
            initStatusEvent = event.detail;
        });

        let probeCalls = 0;
        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                probeCalls += 1;
                if (probeCalls === 1) {
                    return '';
                }
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'embedded', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: { id: 'general', version: '1.11.0', description: 'General runtime' },
                });
            }
            if (path === '/device.json') {
                return JSON.stringify({
                    runtime: 'general',
                    version: '1.11.0',
                    targetId: 'esp32-test',
                    targetConfigPath: '/device/targets/active_target.json',
                });
            }
            if (path === '/device/targets/active_target.json') {
                return JSON.stringify(COMPLETE_TARGET_PAYLOAD);
            }
            if (path === '/collection/node_graph_cln.json') {
                throw new Error('[Errno 2] ENOENT');
            }
            throw new Error(`Unexpected path: ${path}`);
        };

        await connection.loadDeviceInfo();

        assert.equal(probeCalls, 2);
        assert.equal(initStatusEvent?.runtimeDeploymentMode, 'embedded');
    });


    it('keeps runtime mode unknown when the embedded probe fails every attempt', async () => {
        const connection = createConnectedConnection();
        let initStatusEvent = null;

        connection.addEventListener('device-initialization-status', (event) => {
            initStatusEvent = event.detail;
        });

        let probeCalls = 0;
        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                probeCalls += 1;
                return '';
            }
            return 'MicroPython v1.23.0 on 2026-01-01';
        };
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    runtime: { id: 'general', version: '1.11.0', description: 'General runtime' },
                });
            }
            if (
                path === '/device.json' ||
                path === '/device/targets/active_target.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }
            throw new Error(`Unexpected path: ${path}`);
        };

        const state = await connection.loadDeviceInfo();

        assert.equal(probeCalls, 3);
        assert.equal(state.runtimeDeploymentMode, 'unknown');
        assert.equal(state.runtimeEmbedded, false);
        assert.equal(initStatusEvent?.runtimeDeploymentMode, 'unknown');
    });


    it('does not fail when /manifest.json is missing and uses /device.json runtime marker', async () => {
        const connection = createConnectedConnection();
        let loadErrorEvent = null;

        connection.addEventListener('device-info-load-error', (event) => {
            loadErrorEvent = event.detail;
        });

        connection.executeCode = async () => 'MicroPython v1.23.0 on 2026-01-01';
        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                throw new Error('[Errno 2] ENOENT');
            }

            if (path === '/device.json') {
                return JSON.stringify({
                    runtime: 'general',
                    version: '1.11.0',
                    targetId: 'esp32-test',
                });
            }

            if (path === '/device/targets/active_target.json') {
                return JSON.stringify({
                    id: 'esp32-test',
                    displayName: 'ESP32 Test',
                });
            }

            if (path === '/collection/node_graph_cln.json') {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        const state = await connection.loadDeviceInfo();

        assert.equal(state.hasMicroPython, true);
        assert.equal(state.runtimeInstalled, true);
        assert.equal(state.runtimeId, 'general');
        assert.equal(state.runtimeVersion, '1.11.0');
        assert.equal(loadErrorEvent, null);
    });

    it('keeps runtime unset when both /manifest.json and /device.json runtime marker are missing', async () => {
        const connection = createConnectedConnection();

        connection.executeCode = async () => 'MicroPython v1.23.0 on 2026-01-01';
        connection.readTextFile = async (path) => {
            if (
                path === '/manifest.json' ||
                path === '/device.json' ||
                path === '/collection/node_graph_cln.json'
            ) {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        const state = await connection.loadDeviceInfo();

        assert.equal(state.hasMicroPython, true);
        assert.equal(state.runtimeInstalled, false);
        assert.equal(state.runtimeId, null);
        assert.equal(state.runtimeVersion, null);
    });

    it('maps firmware full/runtime/constituent versions from /device.json into DeviceState', async () => {
        const connection = createConnectedConnection();

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'dynamic', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }
            return 'MicroPython v1.23.0 on 2026-01-01';
        };

        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({
                    id: 'general',
                    version: '1.11.0',
                    description: 'General runtime',
                });
            }

            if (path === '/device.json') {
                return JSON.stringify({
                    runtime: 'general',
                    version: '1.11.0',
                    targetId: 'esp32-test',
                    firmwareFullVersion: '1.24.0-esp32-general-0.3.0',
                    runtimeFirmwareVersion: '0.3.0',
                    constituentVersions: {
                        runtimeSourceVersion: '1.11.0',
                        deviceToolsVersion: '1.2.0',
                    },
                });
            }

            if (path === '/device/targets/active_target.json') {
                return JSON.stringify(COMPLETE_TARGET_PAYLOAD);
            }

            if (path === '/collection/node_graph_cln.json') {
                throw new Error('[Errno 2] ENOENT');
            }

            throw new Error(`Unexpected path: ${path}`);
        };

        const state = await connection.loadDeviceInfo();
        assert.equal(state.firmwareFullVersion, '1.24.0-esp32-general-0.3.0');
        assert.equal(state.runtimeFirmwareVersion, '0.3.0');
        assert.equal(state.firmwareConstituentVersions?.runtimeSourceVersion, '1.11.0');
    });

    it('prefers channels.release then channels.dev then the v1 flat entry from the catalog', async () => {
        const connection = createConnectedConnection();

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'dynamic', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }
            return 'MicroPython v1.23.0 on 2026-01-01';
        };

        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({ id: 'general', version: '1.11.0' });
            }
            if (path === '/device.json') {
                // No firmware version fields, so the catalog fallback kicks in.
                return JSON.stringify({ runtime: 'general', version: '1.11.0' });
            }
            if (path === '/device/targets/active_target.json') {
                return JSON.stringify(COMPLETE_TARGET_PAYLOAD);
            }
            throw new Error(`Unexpected path: ${path}`);
        };

        const originalFetch = globalThis.fetch;
        const catalog = {
            targets: {
                'esp32-general': {
                    runtimeId: 'general',
                    channels: {
                        release: {
                            fullVersion: '1.29.0-esp32-general-1.0.0',
                            version: '1.0.0',
                        },
                        dev: {
                            fullVersion: '1.29.0-esp32-general-1.0.1-dev.7.gabc1234',
                            version: '1.0.1-dev.7.gabc1234',
                        },
                    },
                    fullVersion: '1.29.0-esp32-general-0.3.0',
                    runtimeFirmwareVersion: '0.3.0',
                },
            },
        };
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => catalog,
        });
        try {
            const state = await connection.loadDeviceInfo();
            assert.equal(state.firmwareFullVersion, '1.29.0-esp32-general-1.0.0');
            assert.equal(state.runtimeFirmwareVersion, '1.0.0');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('falls back to the v1 flat catalog entry when channels is absent', async () => {
        const connection = createConnectedConnection();

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode: 'dynamic', runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }
            return 'MicroPython v1.23.0 on 2026-01-01';
        };

        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({ id: 'general', version: '1.11.0' });
            }
            if (path === '/device.json') {
                return JSON.stringify({ runtime: 'general', version: '1.11.0' });
            }
            if (path === '/device/targets/active_target.json') {
                return JSON.stringify(COMPLETE_TARGET_PAYLOAD);
            }
            throw new Error(`Unexpected path: ${path}`);
        };

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                targets: {
                    'esp32-general': {
                        runtimeId: 'general',
                        fullVersion: '1.29.0-esp32-general-0.3.0',
                        runtimeFirmwareVersion: '0.3.0',
                    },
                },
            }),
        });
        try {
            const state = await connection.loadDeviceInfo();
            assert.equal(state.firmwareFullVersion, '1.29.0-esp32-general-0.3.0');
            assert.equal(state.runtimeFirmwareVersion, '0.3.0');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('DeviceConnection target payload gate', () => {
    /**
     * Build a logger that records the log keys it receives.
     * @returns {{ keys: string[], logger: Object }} Collected keys plus the logger to inject.
     */
    function createLogCollector() {
        const keys = [];
        return {
            keys,
            logger: {
                log: (message) => {
                    keys.push(String(message));
                },
                warn: () => {},
                error: () => {},
            },
        };
    }

    /**
     * Wire a connected connection whose device exposes *readTarget* for the active-target file.
     * @param {Object} options Options bag.
     * @param {() => string} options.readTarget Returns or throws for the active-target read.
     * @param {'embedded' | 'dynamic'} [options.runtimeMode] Embedded metadata probe answer.
     * @param {Object} [options.logger] Optional log collector.
     * @returns {DeviceConnection} Connected connection backed by the mock device filesystem.
     */
    function createPayloadConnection({ readTarget, runtimeMode = 'dynamic', logger } = {}) {
        const connection = createConnectedConnection(logger);

        connection.executeCode = async (code) => {
            if (code.includes('__OTTER_EMBEDDED_DEBUG_API_START__')) {
                return [
                    '__OTTER_EMBEDDED_DEBUG_API_START__',
                    JSON.stringify({ ok: true, runtimeMode, runtimeId: 'general' }),
                    '__OTTER_EMBEDDED_DEBUG_API_END__',
                ].join('\n');
            }

            return 'MicroPython v1.23.0 on 2026-01-01';
        };

        connection.readTextFile = async (path) => {
            if (path === '/manifest.json') {
                return JSON.stringify({ runtime: { id: 'general', version: '1.11.0' } });
            }

            if (path === '/device.json') {
                return JSON.stringify({
                    runtime: 'general',
                    version: '1.11.0',
                    targetId: 'esp32_s3_mini',
                    targetConfigPath: ACTIVE_TARGET_PATH,
                    targetUserDescription: 'Workshop board',
                });
            }

            if (path === ACTIVE_TARGET_PATH) {
                return readTarget();
            }

            if (path === '/collection/node_graph_cln.json') {
                throw new Error('[Errno 2] ENOENT');
            }
            throw new Error(`Unexpected path: ${path}`);
        };

        return connection;
    }

    it('adopts a complete payload and clears the reader verdict', async () => {
        const connection = createPayloadConnection({
            readTarget: () =>
                JSON.stringify({
                    targetId: 'esp32_s3_mini',
                    displayName: 'ESP32-S3 Mini',
                    pinCapabilities: { 5: { digital: { input: true, output: true } } },
                }),
        });

        await connection.loadDeviceInfo();

        assert.equal(connection.getDeviceInfoData()?.target?.id, 'esp32_s3_mini');
        assert.equal(connection.getDeviceInfoData()?.target?.pinCapabilities.size, 1);
        assert.equal(connection.getTargetPayloadIssue(), null);
        assert.equal(connection.getConfiguredTargetIdHint(), null);
        assert.equal(connection.getTargetUserDescription(), 'Workshop board');
    });

    it('adopts an open-pins payload that carries no pinCapabilities', async () => {
        const connection = createPayloadConnection({
            readTarget: () =>
                JSON.stringify({ targetId: 'generic_micropython', openPins: { min: 1, max: 20 } }),
        });

        await connection.loadDeviceInfo();

        assert.equal(connection.getDeviceInfoData()?.target?.id, 'generic_micropython');
        assert.equal(connection.getDeviceInfoData()?.target?.isOpenPinSet, true);
        assert.equal(connection.getTargetPayloadIssue(), null);
    });

    it('treats a missing target file as a normal state without an error log', async () => {
        const { keys, logger } = createLogCollector();
        const connection = createPayloadConnection({
            readTarget: () => {
                throw new Error('[Errno 2] ENOENT');
            },
            logger,
        });

        await connection.loadDeviceInfo();

        assert.equal(connection.getDeviceInfoData()?.target, null);
        assert.equal(connection.getTargetPayloadIssue(), 'missing');
        assert.ok(keys.some((key) => key.includes('load-target-config-missing')));
        assert.ok(!keys.some((key) => key.includes('load-target-capabilities-failed')));
    });

    it('leaves the verdict undecided when the target file is malformed', async () => {
        const connection = createPayloadConnection({ readTarget: () => '{not json' });

        await connection.loadDeviceInfo();

        assert.equal(connection.getDeviceInfoData()?.target, null);
        assert.equal(connection.getTargetPayloadIssue(), null);
    });

    it('rejects the legacy five-key skeleton and repairs it through one onboarding pass', async () => {
        const { keys, logger } = createLogCollector();
        let targetConfigured = false;
        let onboardingRequests = 0;
        let prefillSeen = null;

        const connection = createPayloadConnection({
            runtimeMode: 'embedded',
            logger,
            readTarget: () =>
                targetConfigured
                    ? JSON.stringify({
                          targetId: 'esp32_s3_mini',
                          displayName: 'ESP32-S3 Mini',
                          pinCapabilities: { 5: { digital: { input: true, output: true } } },
                      })
                    : JSON.stringify({
                          targetId: 'esp32_s3_mini',
                          displayName: 'ESP32-S3 Mini',
                          description: 'ESP32-S3 Mini',
                          configVersion: 1,
                          capabilities: {},
                      }),
        });

        connection.setEmbeddedOnboardingAdapter({
            requestSelection: async () => {
                onboardingRequests += 1;
                prefillSeen = {
                    issue: connection.getTargetPayloadIssue(),
                    targetId: connection.getConfiguredTargetIdHint(),
                    userDescription: connection.getTargetUserDescription(),
                };
                return {
                    confirmed: true,
                    selectedTargetId: 'esp32_s3_mini',
                    userDescription: 'Workshop board',
                };
            },
            uploadTargetConfiguration: async () => {
                targetConfigured = true;
            },
        });

        const state = await connection.loadDeviceInfo();

        assert.equal(onboardingRequests, 1);
        assert.deepEqual(prefillSeen, {
            issue: 'incomplete',
            targetId: 'esp32_s3_mini',
            userDescription: 'Workshop board',
        });
        assert.equal(state.deviceTargetInfo?.id, 'esp32_s3_mini');
        assert.equal(connection.getTargetPayloadIssue(), null);
        assert.ok(keys.some((key) => key.includes('load-target-capabilities-incomplete')));
    });
});

