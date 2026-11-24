import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CustomViewRenderer } from '../../src/micro_otter/nodes/html/js/views/custom-runtime-view.js';

function createEnv() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;
    global.HTMLElement = dom.window.HTMLElement;
    global.HTMLButtonElement = dom.window.HTMLButtonElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;

    return {
        cleanup: () => {
            delete global.document;
            delete global.window;
            delete global.HTMLElement;
            delete global.HTMLButtonElement;
            delete global.HTMLInputElement;
        },
    };
}

function createI18n() {
    return {
        t: (key) => key,
    };
}

function createDefinitionWithSetupAndAction() {
    return {
        version: '1.0.0',
        setup: {
            calls: [
                {
                    name: 'read_runtime_settings',
                    parameters: [],
                    mapping: {
                        wifi_ssid: 'wifi_ssid',
                    },
                },
            ],
        },
        sections: [
            {
                id: 'runtime',
                title: 'runtime',
                controls: [
                    {
                        id: 'wifi_ssid',
                        type: 'text',
                        label: 'ssid',
                        defaultValue: '',
                    },
                    {
                        id: 'save_button',
                        type: 'button',
                        label: 'save',
                        function: {
                            name: 'create_runtime_settings',
                            runtimeImpact: 'none',
                            parameters: ['${wifi_ssid}'],
                            onSuccess: {
                                action: 'showMessage',
                                messageType: 'success',
                                message: 'saved',
                            },
                        },
                    },
                ],
            },
        ],
    };
}

describe('CustomViewRenderer single execution path regression', () => {
    const flushAsync = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    };

    it('routes setup and action execution through executeCustomViewAction only', async () => {
        const env = createEnv();
        const actionCalls = [];
        let executeCodeCalls = 0;

        const deviceConnection = {
            async executeCode() {
                executeCodeCalls += 1;
                throw new Error('executeCode should never be called in custom-view execution path');
            },
            async executeCustomViewAction(functionName, parameters = [], options = {}) {
                actionCalls.push({ functionName, parameters, options });

                if (functionName === 'read_runtime_settings') {
                    return JSON.stringify({ wifi_ssid: 'LoadedNet' });
                }
                if (functionName === 'create_runtime_settings') {
                    return JSON.stringify({ success: true, message: 'saved' });
                }

                return '{}';
            },
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: createDefinitionWithSetupAndAction(),
            i18nService: createI18n(),
            logger: { warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);
        await flushAsync();

        const sectionDef = createDefinitionWithSetupAndAction().sections[0];
        const saveButton = sectionDef.controls[1];
        await renderer._executeFunction(saveButton);

        assert.equal(executeCodeCalls, 0);
        assert.deepEqual(
            actionCalls.map((entry) => entry.functionName),
            ['read_runtime_settings', 'create_runtime_settings']
        );
        assert.equal(renderer.getControlValue('wifi_ssid'), 'LoadedNet');

        env.cleanup();
    });

    it('fails closed when boundary API is unavailable even if executeCode exists', async () => {
        const env = createEnv();
        let executeCodeCalls = 0;

        const deviceConnection = {
            async executeCode() {
                executeCodeCalls += 1;
                return JSON.stringify({ wifi_ssid: 'unexpected' });
            },
        };

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: createDefinitionWithSetupAndAction(),
            i18nService: createI18n(),
            logger: { warn: () => {}, error: () => {} },
        });

        const container = document.createElement('div');
        renderer.render(container);
        await flushAsync();

        const errorState = container.querySelector('.message-view--error');
        assert.ok(errorState, 'Setup should fail when executeCustomViewAction is unavailable');
        assert.equal(executeCodeCalls, 0);

        env.cleanup();
    });
});
