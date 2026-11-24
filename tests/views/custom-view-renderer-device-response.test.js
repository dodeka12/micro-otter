import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CustomViewRenderer } from '../../src/micro_otter/nodes/html/js/views/custom-runtime-view.js';

class MockDeviceConnection {
    constructor() {
        this.customViewActionCalls = [];
        this.responses = new Map();
        this.softResetCalls = 0;
    }

    _responseKey(functionName, parameters = []) {
        return `${functionName}::${JSON.stringify(parameters)}`;
    }

    setMockResponse(functionName, parameters, response) {
        this.responses.set(this._responseKey(functionName, parameters), response);
    }

    async executeCustomViewAction(functionName, parameters = [], options = {}) {
        this.customViewActionCalls.push({ functionName, parameters, options });
        return this.responses.get(this._responseKey(functionName, parameters)) || '{}';
    }

    async softReset() {
        this.softResetCalls += 1;
    }
}

class MockViewManager {
    constructor() {
        this.infoCalls = [];
        this.errorCalls = [];
    }

    async showInfo(options = {}) {
        this.infoCalls.push(options);
    }

    async showError(options = {}) {
        this.errorCalls.push(options);
    }
}

function createEnv() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    return {
        cleanup: () => {
            delete global.document;
            delete global.HTMLElement;
        },
    };
}

function createI18n() {
    return {
        t: (key) => key,
    };
}

describe('CustomViewRenderer structured failure handling', () => {
    it('does not execute onSuccess softReset when device response success=false', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();

        deviceConnection.setMockResponse(
            'create_wifi_settings',
            ['Bad', 'password123', 'sta', true],
            '{"success": false, "error": "Invalid WiFi mode"}'
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'wifi',
                    title: 'wifi',
                    controls: [
                        { id: 'ssid', type: 'text', label: 'ssid', defaultValue: 'Bad' },
                        {
                            id: 'pwd',
                            type: 'text',
                            label: 'pwd',
                            defaultValue: 'password123',
                        },
                        { id: 'mode', type: 'text', label: 'mode', defaultValue: 'sta' },
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_wifi_settings',
                                parameters: ['${ssid}', '${pwd}', '${mode}', true],
                                onSuccess: {
                                    action: 'softReset',
                                    messageType: 'success',
                                    message: 'ok',
                                },
                                onError: {
                                    action: 'showMessage',
                                    messageType: 'error',
                                    message: 'err',
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[3];
        await renderer._executeFunction(buttonDef);

        assert.equal(deviceConnection.customViewActionCalls.length, 1);
        assert.equal(deviceConnection.softResetCalls, 0);

        env.cleanup();
    });

    it('does not apply legacy compatibility soft reset when create_wifi_settings succeeds without softReset action', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();

        deviceConnection.setMockResponse(
            'create_wifi_settings',
            ['Net', 'password123', 'STA', true],
            '{"success": true, "message": "saved"}'
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'wifi',
                    title: 'wifi',
                    controls: [
                        { id: 'ssid', type: 'text', label: 'ssid', defaultValue: 'Net' },
                        {
                            id: 'pwd',
                            type: 'text',
                            label: 'pwd',
                            defaultValue: 'password123',
                        },
                        { id: 'mode', type: 'text', label: 'mode', defaultValue: 'STA' },
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_wifi_settings',
                                parameters: ['${ssid}', '${pwd}', '${mode}', true],
                                onSuccess: {
                                    action: 'showMessage',
                                    messageType: 'success',
                                    message: 'ok',
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[3];
        await renderer._executeFunction(buttonDef);

        assert.equal(deviceConnection.customViewActionCalls.length, 1);
        assert.equal(deviceConnection.softResetCalls, 0);

        env.cleanup();
    });

    it('shows info dialog when result contains dialog directive', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();
        const viewManager = new MockViewManager();

        deviceConnection.setMockResponse(
            'create_wifi_settings',
            [],
            JSON.stringify({
                success: true,
                message: 'saved',
                dialog: {
                    type: 'info',
                    title: 'generalRuntime.wifiSettings.restartRequiredTitle',
                    message: 'generalRuntime.wifiSettings.restartRequiredMessage',
                },
            })
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'wifi',
                    title: 'wifi',
                    controls: [
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_wifi_settings',
                                parameters: [],
                                onSuccess: {
                                    action: 'showMessage',
                                    messageType: 'success',
                                    message: 'ok',
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            viewManager,
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[0];
        await renderer._executeFunction(buttonDef);

        assert.equal(viewManager.infoCalls.length, 1);
        assert.equal(
            viewManager.infoCalls[0].title,
            'generalRuntime.wifiSettings.restartRequiredTitle'
        );
        assert.equal(
            viewManager.infoCalls[0].message,
            'generalRuntime.wifiSettings.restartRequiredMessage'
        );
        assert.equal(viewManager.errorCalls.length, 0);

        env.cleanup();
    });

    it('shows a warning directive from the dialogs array as an info modal with a warning icon', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();
        const viewManager = new MockViewManager();

        deviceConnection.setMockResponse(
            'create_runtime_settings',
            [],
            JSON.stringify({
                success: true,
                message: 'saved',
                dialog: {
                    type: 'info',
                    title: 'generalRuntime.wifiSettings.restartRequiredTitle',
                    message: 'generalRuntime.wifiSettings.restartRequiredMessage',
                },
                dialogs: [
                    {
                        type: 'warning',
                        title: 'generalRuntime.customView.disabledSectionTitle',
                        message: 'generalRuntime.customView.mqttDisabledWarning',
                    },
                ],
            })
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_runtime_settings',
                                parameters: [],
                                onSuccess: {
                                    action: 'showMessage',
                                    messageType: 'success',
                                    message: 'ok',
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            viewManager,
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[0];
        await renderer._executeFunction(buttonDef);

        assert.equal(viewManager.infoCalls.length, 2);
        assert.equal(viewManager.errorCalls.length, 0);
        assert.equal(
            viewManager.infoCalls[1].title,
            'generalRuntime.customView.disabledSectionTitle'
        );
        assert.equal(
            viewManager.infoCalls[1].message,
            'generalRuntime.customView.mqttDisabledWarning'
        );
        assert.equal(viewManager.infoCalls[1].icon, '⚠️');

        env.cleanup();
    });

    it('reports error when function returns non-JSON response', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();
        const viewManager = new MockViewManager();

        deviceConnection.setMockResponse('create_runtime_settings', [], 'OK');

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_runtime_settings',
                                parameters: [],
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            viewManager,
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[0];
        const executed = await renderer._executeFunction(buttonDef);

        assert.equal(executed, false);
        assert.equal(viewManager.errorCalls.length, 1);
        assert.match(String(viewManager.errorCalls[0].detail || ''), /non-JSON output/i);

        env.cleanup();
    });

    it('treats JSON without success key as success when no error is present', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();
        const viewManager = new MockViewManager();

        deviceConnection.setMockResponse(
            'create_runtime_settings',
            [],
            JSON.stringify({ message: 'saved' })
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_runtime_settings',
                                parameters: [],
                                onSuccess: {
                                    action: 'showMessage',
                                    messageType: 'success',
                                    message: 'ok',
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            viewManager,
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[0];
        const executed = await renderer._executeFunction(buttonDef);

        assert.equal(executed, true);
        assert.equal(viewManager.errorCalls.length, 0);

        env.cleanup();
    });

    it('treats JSON without success key as failure when error is present', async () => {
        const env = createEnv();
        const deviceConnection = new MockDeviceConnection();
        const viewManager = new MockViewManager();

        deviceConnection.setMockResponse(
            'create_runtime_settings',
            [],
            JSON.stringify({ error: 'save failed' })
        );

        const viewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'btn',
                            type: 'button',
                            label: 'save',
                            function: {
                                name: 'create_runtime_settings',
                                parameters: [],
                            },
                        },
                    ],
                },
            ],
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition,
            i18nService: createI18n(),
            viewManager,
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);

        const buttonDef = viewDefinition.sections[0].controls[0];
        const executed = await renderer._executeFunction(buttonDef);

        assert.equal(executed, false);
        assert.equal(viewManager.errorCalls.length, 1);
        assert.match(String(viewManager.errorCalls[0].detail || ''), /save failed/i);

        env.cleanup();
    });
});
