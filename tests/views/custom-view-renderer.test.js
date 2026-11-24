// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for CustomViewRenderer
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { CustomViewRenderer } from '../../src/micro_otter/nodes/html/js/views/custom-runtime-view.js';

/**
 * Mock device connection for testing
 */
class MockDeviceConnection {
    constructor() {
        this.customViewActionCalls = [];
        this.customViewRefreshActionCalls = [];
        this.mockResponses = new Map();
        this.softResetCalls = 0;
        this.softResetError = null;
    }

    _responseKey(functionName, parameters = []) {
        return `${functionName}::${JSON.stringify(parameters)}`;
    }

    setMockResponse(functionName, parameters, response) {
        const hasExplicitParameters = arguments.length >= 3;
        const normalizedParameters = hasExplicitParameters ? parameters : [];
        const normalizedResponse = hasExplicitParameters ? response : parameters;

        this.mockResponses.set(
            this._responseKey(functionName, normalizedParameters),
            normalizedResponse
        );
    }

    async executeCustomViewAction(functionName, parameters = [], options = {}) {
        this.customViewActionCalls.push({ functionName, parameters, options });
        const response = this.mockResponses.get(this._responseKey(functionName, parameters));
        if (response instanceof Error) {
            throw response;
        }
        return response || '{}';
    }

    async executeCustomViewRefreshAction(functionName, parameters = [], options = {}) {
        this.customViewRefreshActionCalls.push({ functionName, parameters, options });
        const response = this.mockResponses.get(this._responseKey(functionName, parameters));
        if (response instanceof Error) {
            throw response;
        }
        return response || '{}';
    }

    async softReset() {
        this.softResetCalls += 1;
        if (this.softResetError instanceof Error) {
            throw this.softResetError;
        }
    }
}

/**
 * Mock I18nService for testing
 */
class MockI18nService {
    constructor() {
        this.translations = new Map();
    }

    t(key, variables = {}) {
        let text = this.translations.get(key) || key;

        // Simple variable substitution
        for (const [varKey, varValue] of Object.entries(variables)) {
            text = text.replace(`{${varKey}}`, varValue);
        }

        return text;
    }

    setTranslation(key, value) {
        this.translations.set(key, value);
    }
}

/**
 * Create a test environment with DOM
 */
function createTestEnvironment() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.HTMLButtonElement = dom.window.HTMLButtonElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    global.HTMLSelectElement = dom.window.HTMLSelectElement;
    global.Node = dom.window.Node;

    return {
        dom,
        document: dom.window.document,
        cleanup: () => {
            delete global.window;
            delete global.document;
            delete global.HTMLElement;
            delete global.HTMLButtonElement;
            delete global.HTMLInputElement;
            delete global.HTMLSelectElement;
            delete global.Node;
        },
    };
}

/**
 * Create a basic view definition for testing
 */
function createBasicViewDefinition() {
    return {
        version: '1.0.0',
        title: 'test.title',
        description: 'test.description',
        sections: [
            {
                id: 'section1',
                title: 'test.section1.title',
                collapsible: false,
                controls: [
                    {
                        id: 'text_input',
                        type: 'text',
                        label: 'test.textLabel',
                        defaultValue: 'default text',
                    },
                    {
                        id: 'number_input',
                        type: 'number',
                        label: 'test.numberLabel',
                        defaultValue: 42,
                        min: 0,
                        max: 100,
                    },
                ],
            },
        ],
    };
}

describe('CustomViewRenderer', () => {
    const flushAsync = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    };

    describe('Constructor', () => {
        it('should throw error if deviceConnection is missing', () => {
            assert.throws(
                () => {
                    new CustomViewRenderer({
                        viewDefinition: {},
                        i18nService: new MockI18nService(),
                    });
                },
                { message: 'CustomViewRenderer requires deviceConnection' }
            );
        });

        it('should throw error if viewDefinition is missing', () => {
            assert.throws(
                () => {
                    new CustomViewRenderer({
                        deviceConnection: new MockDeviceConnection(),
                        i18nService: new MockI18nService(),
                    });
                },
                { message: 'CustomViewRenderer requires viewDefinition' }
            );
        });

        it('should create instance with valid parameters', () => {
            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            assert.ok(renderer);
            assert.ok(renderer._controls instanceof Map);
        });
    });

    describe('Rendering', () => {
        let env;

        beforeEach(() => {
            env = createTestEnvironment();
        });

        it('should render view definition to container', () => {
            const viewDef = createBasicViewDefinition();
            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.title', 'Test Title');
            i18nService.setTranslation('test.description', 'Test Description');
            i18nService.setTranslation('test.section1.title', 'Section 1');

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            // Check root element
            const root = container.querySelector('.stack-view');
            assert.ok(root, 'Root element should exist');

            // Check title
            const title = root.querySelector('.collapsible-view__title');
            assert.ok(title, 'Title element should exist');
            assert.equal(title.textContent, 'Test Title');

            // Check description
            const description = root.querySelector('.message-view--muted');
            assert.ok(description, 'Description element should exist');
            assert.equal(description.textContent, 'Test Description');

            // Check section
            const sections = root.querySelectorAll('.collapsible-view');
            assert.equal(sections.length, 2, 'Top-level header and section should exist');
            assert.equal(sections[1].querySelector('.collapsible-view__title').textContent, 'Section 1');

            env.cleanup();
        });

        it('should render top-level title in a collapsible view', () => {
            const viewDef = createBasicViewDefinition();
            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.title', 'Test Title');
            i18nService.setTranslation('test.description', 'Test Description');

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const header = container.querySelector('.collapsible-view');
            assert.ok(header, 'Top-level collapsible view should exist');
            assert.equal(
                header.classList.contains('is-collapsed'),
                false,
                'Top-level collapsible should be open by default'
            );

            const title = header.querySelector('.collapsible-view__title');
            assert.ok(title, 'Collapsible header title should exist');
            assert.equal(title.textContent.trim(), 'Test Title');

            const content = header.querySelector('.collapsible-view__content');
            assert.ok(content, 'Collapsible content should exist');

            const description = content.querySelector('.message-view--muted');
            assert.ok(description, 'Description should be rendered in collapsible content area');
            assert.equal(description.textContent, 'Test Description');

            env.cleanup();
        });

        it('should omit the top-level header when showHeader is false', () => {
            const viewDef = createBasicViewDefinition();
            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.title', 'Test Title');
            i18nService.setTranslation('test.description', 'Test Description');

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService,
                showHeader: false,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            assert.equal(
                container.querySelector('.stack-view > .stack-view__item > .collapsible-view'),
                null,
                'No top-level collapsible should wrap the content'
            );

            const description = container.querySelector('.message-view--muted');
            assert.ok(description, 'Description should still be rendered');
            assert.equal(description.textContent, 'Test Description');

            const contentStack = description.closest('.stack-view');
            assert.ok(contentStack, 'Description should sit in the content stack');
            assert.ok(
                contentStack.classList.contains('stack-view--fill'),
                'Content stack must fill its host so the section SplitView receives height'
            );
            assert.ok(contentStack.querySelector('.split-view'));

            env.cleanup();
        });

        it('should instantiate controls correctly', () => {
            const viewDef = createBasicViewDefinition();
            const i18nService = new MockI18nService();

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            // Check that controls were created
            assert.equal(renderer._controls.size, 2);
            assert.ok(renderer._controls.has('text_input'));
            assert.ok(renderer._controls.has('number_input'));

            // Check control values
            assert.equal(renderer.getControlValue('text_input'), 'default text');
            assert.equal(renderer.getControlValue('number_input'), 42);

            env.cleanup();
        });

        it('should handle collapsible sections', () => {
            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'collapsible_section',
                        title: 'test.collapsible',
                        collapsible: true,
                        collapsed: true,
                        controls: [],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const sections = container.querySelectorAll('.collapsible-view');
            assert.equal(sections.length, 2, 'Top-level and section collapsibles should exist');
            const sectionView = sections[1];
            assert.equal(
                sectionView.classList.contains('is-collapsed'),
                true,
                'Section should respect collapsed=true'
            );

            const header = sectionView.querySelector('.collapsible-view__title');
            assert.ok(header, 'Collapsible section header should exist');

            env.cleanup();
        });

        it('should render toolbar controls from top-level toolbar definition', () => {
            const viewDef = {
                version: '1.0.0',
                toolbar: {
                    controls: [
                        {
                            id: 'runtime_upload',
                            type: 'button',
                            label: 'test.upload',
                            icon: 'upload',
                        },
                        {
                            type: 'separator',
                        },
                        {
                            id: 'runtime_download',
                            type: 'button',
                            label: 'test.download',
                            icon: 'download',
                        },
                    ],
                },
                sections: [
                    {
                        id: 'section',
                        title: 'test.section',
                        controls: [],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const toolbarRoot = container.querySelector('.view-toolbar');
            assert.ok(toolbarRoot, 'Toolbar view should exist');

            const toolbarButtons = container.querySelectorAll('.view-toolbar__btn');
            assert.equal(toolbarButtons.length, 2, 'Two toolbar buttons should be rendered');
            assert.ok(renderer._controls.has('runtime_upload'));
            assert.ok(renderer._controls.has('runtime_download'));

            env.cleanup();
        });

        it('should render row entries with grow and fixed width control wrappers', () => {
            const viewDef = {
                version: '1.0.0',
                sections: [
                    {
                        id: 'section',
                        title: 'test.section',
                        controls: [
                            {
                                type: 'row',
                                controls: [
                                    {
                                        id: 'row_text',
                                        type: 'text',
                                        label: 'test.rowText',
                                        defaultValue: 'abc',
                                        grow: true,
                                    },
                                    {
                                        id: 'row_btn',
                                        type: 'button',
                                        label: 'test.rowButton',
                                        width: 42,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const row = container.querySelector('.stack-view--horizontal');
            assert.ok(row, 'Row stack should be rendered');

            const growControl = container.querySelector('[data-control-id="row_text"]');
            assert.ok(
                growControl?.closest('.stack-view__item')?.classList.contains('stack-view__item--grow')
            );

            const fixedControl = container.querySelector('[data-control-id="row_btn"]');
            assert.equal(fixedControl?.closest('.stack-view__item')?.style?.width, '42px');

            env.cleanup();
        });

        it('should render clickable IP link for readonly text when linkifyIpAddress is enabled', () => {
            const viewDef = {
                version: '1.0.0',
                sections: [
                    {
                        id: 'section',
                        title: 'test.section',
                        controls: [
                            {
                                id: 'wifi_status',
                                type: 'text',
                                label: 'test.status',
                                defaultValue: 'STA connected (IP: 192.168.4.1)',
                                readonly: true,
                                linkifyIpAddress: true,
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const readonlyContent = container.querySelector(
                '[data-control-id="wifi_status"] .custom-control__readonly-content'
            );
            assert.ok(readonlyContent, 'Readonly text should render as display content');

            const link = container.querySelector(
                '[data-control-id="wifi_status"] .custom-control__readonly-link'
            );
            assert.ok(link, 'Readonly link element should exist');
            assert.equal(link.getAttribute('href'), 'http://192.168.4.1');
            assert.equal(link.textContent, '192.168.4.1');
            assert.equal(readonlyContent.textContent, 'STA connected (IP: 192.168.4.1)');

            renderer.setControlValue('wifi_status', 'STA disconnected');
            const hiddenLink = container.querySelector(
                '[data-control-id="wifi_status"] .custom-control__readonly-link'
            );
            assert.equal(hiddenLink, null, 'Link should be removed when no IP address is present');
            assert.equal(readonlyContent.textContent, 'STA disconnected');

            renderer.setControlValue('wifi_status', 'STA connected (IP: 10.0.0.50)');
            const updatedLink = container.querySelector(
                '[data-control-id="wifi_status"] .custom-control__readonly-link'
            );
            assert.ok(updatedLink, 'Link should be shown again when IP address is present');
            assert.equal(updatedLink.getAttribute('href'), 'http://10.0.0.50');
            assert.equal(updatedLink.textContent, '10.0.0.50');
            assert.equal(readonlyContent.textContent, 'STA connected (IP: 10.0.0.50)');

            env.cleanup();
        });

        it('should enable and clear dirty-linked button state', async () => {
            const viewDef = {
                version: '1.0.0',
                sections: [
                    {
                        id: 'section',
                        title: 'test.section',
                        controls: [
                            {
                                id: 'wifi_ssid',
                                type: 'text',
                                label: 'test.ssid',
                                defaultValue: 'original',
                            },
                            {
                                id: 'runtime_upload',
                                type: 'button',
                                label: 'test.upload',
                                enableOnDirty: ['wifi_ssid'],
                                clearDirty: ['wifi_ssid'],
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const uploadButton = renderer._controls.get('runtime_upload').element;
            assert.equal(
                uploadButton.disabled,
                true,
                'Upload should start disabled when not dirty'
            );

            const ssidInput = container.querySelector('[data-control-id="wifi_ssid"] input');
            ssidInput.value = 'changed';
            ssidInput.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));

            assert.equal(
                uploadButton.disabled,
                false,
                'Upload should enable when referenced control is dirty'
            );

            uploadButton.dispatchEvent(new env.dom.window.Event('click', { bubbles: true }));
            await flushAsync();
            assert.equal(
                uploadButton.disabled,
                true,
                'Upload should disable after clearDirty resets dirty state'
            );

            env.cleanup();
        });

        it('should clear dirty flags after setup initialization baseline is applied', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'read_runtime_settings',
                [],
                JSON.stringify({
                    wifi_ssid: 'LoadedNet',
                })
            );

            const viewDef = {
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
                        id: 'section',
                        title: 'test.section',
                        controls: [
                            {
                                id: 'wifi_ssid',
                                type: 'text',
                                label: 'test.ssid',
                                defaultValue: '',
                            },
                            {
                                id: 'runtime_upload',
                                type: 'button',
                                label: 'test.upload',
                                enableOnDirty: ['wifi_ssid'],
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);
            await flushAsync();

            assert.equal(renderer.getControlValue('wifi_ssid'), 'LoadedNet');
            const uploadButton = renderer._controls.get('runtime_upload').element;
            assert.equal(
                uploadButton.disabled,
                true,
                'Setup-loaded values should be clean baseline'
            );

            env.cleanup();
        });

        it('should render iconOnly button with tooltip and without inline text label', () => {
            const viewDef = {
                version: '1.0.0',
                sections: [
                    {
                        id: 'section',
                        title: 'test.section',
                        controls: [
                            {
                                id: 'wifi_check_btn',
                                type: 'button',
                                label: 'test.check',
                                icon: 'sync',
                                iconOnly: true,
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.check', 'Check Status');

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const button = container.querySelector('[data-control-id="wifi_check_btn"] button');
            assert.ok(button.classList.contains('custom-control__button--icon-only'));
            assert.equal(button.title, 'Check Status');
            assert.equal(button.querySelector('.custom-control__button-label'), null);

            env.cleanup();
        });
    });

    describe('Setup initialization', () => {
        let env;

        beforeEach(() => {
            env = createTestEnvironment();
        });

        it('should run setup calls and initialize control values before showing sections', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'read_wifi_settings',
                [],
                JSON.stringify({
                    ssid: 'MyNetwork',
                    password: 'secret123',
                    mode: 'AP',
                    enabled: false,
                })
            );
            deviceConnection.setMockResponse(
                'read_webserver_settings',
                [],
                JSON.stringify({
                    enable: true,
                    port: 8080,
                })
            );

            const viewDefinition = {
                version: '1.0.0',
                setup: {
                    calls: [
                        {
                            name: 'read_wifi_settings',
                            parameters: [],
                            mapping: {
                                ssid: 'wifi_ssid',
                                mode: 'wifi_mode',
                                enabled: 'wifi_enabled',
                            },
                        },
                        {
                            name: 'read_webserver_settings',
                            parameters: [],
                            mapping: {
                                port: 'webserver_port',
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
                                id: 'wifi_mode',
                                type: 'dropdown',
                                label: 'mode',
                                defaultValue: 'STA',
                                options: [
                                    { value: 'STA', label: 'sta' },
                                    { value: 'AP', label: 'ap' },
                                ],
                            },
                            {
                                id: 'wifi_enabled',
                                type: 'checkbox',
                                label: 'enabled',
                                defaultValue: true,
                            },
                            {
                                id: 'webserver_port',
                                type: 'number',
                                label: 'port',
                                defaultValue: 80,
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const loadingState = container.querySelector('.message-view--info');
            assert.ok(loadingState, 'Setup loading state should be shown while setup runs');
            assert.equal(loadingState.hidden, false);

            await flushAsync();

            assert.deepEqual(
                deviceConnection.customViewActionCalls.map((call) => call.functionName),
                ['read_wifi_settings', 'read_webserver_settings']
            );
            assert.equal(renderer.getControlValue('wifi_ssid'), 'MyNetwork');
            assert.equal(renderer.getControlValue('wifi_mode'), 'AP');
            assert.equal(renderer.getControlValue('wifi_enabled'), false);
            assert.equal(renderer.getControlValue('webserver_port'), 8080);

            assert.ok(container.querySelector('.split-view'), 'Sections should be built after setup');
            assert.equal(
                container.querySelector('.message-view--info')?.hidden,
                true,
                'The loading message should be hidden after setup'
            );

            env.cleanup();
        });

        it('should show setup error state and suppress controls when setup call fails', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'read_wifi_settings',
                [],
                JSON.stringify({
                    success: false,
                    error: 'boom',
                })
            );

            const viewDefinition = {
                version: '1.0.0',
                setup: {
                    calls: [
                        {
                            name: 'read_wifi_settings',
                            parameters: [],
                            mapping: {
                                ssid: 'wifi_ssid',
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
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition,
                i18nService: new MockI18nService(),
                logger: { log: () => {}, warn: () => {}, error: () => {} },
            });

            const container = env.document.createElement('div');
            renderer.render(container);
            await flushAsync();

            const errorState = container.querySelector('.message-view--error');
            assert.ok(errorState, 'Setup error state should be shown on failure');
            assert.equal(
                renderer._controls.size,
                0,
                'Controls should not be created on setup failure'
            );

            assert.equal(
                container.querySelector('.split-view'),
                null,
                'Sections should not be built on setup failure'
            );

            env.cleanup();
        });

        it('should translate setup mapping values when translate is set', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'read_runtime_settings',
                [],
                JSON.stringify({
                    success: true,
                    wifi_ssid: '',
                    status: 'generalRuntime.wifiSettings.notConfigured',
                })
            );

            const i18nService = new MockI18nService();
            i18nService.setTranslation(
                'generalRuntime.wifiSettings.notConfigured',
                'WiFi is not configured'
            );

            const viewDefinition = {
                version: '1.0.0',
                setup: {
                    calls: [
                        {
                            name: 'read_runtime_settings',
                            parameters: [],
                            mapping: {
                                wifi_ssid: 'wifi_ssid',
                                status: { controlId: 'runtime_status', translate: true },
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
                                id: 'runtime_status',
                                type: 'text',
                                label: 'status',
                                defaultValue: '',
                                readonly: true,
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition,
                i18nService,
                logger: { log: () => {}, warn: () => {}, error: () => {} },
            });

            const container = env.document.createElement('div');
            renderer.render(container);
            await flushAsync();

            assert.equal(renderer.getControlValue('runtime_status'), 'WiFi is not configured');
            assert.equal(renderer.getControlValue('wifi_ssid'), '');

            env.cleanup();
        });

        it('should write error message to a control via onError updateControls mapping', async () => {
            const viewDefinition = {
                version: '1.0.0',
                sections: [
                    {
                        id: 'runtime',
                        title: 'runtime',
                        controls: [
                            {
                                id: 'runtime_status',
                                type: 'text',
                                label: 'status',
                                defaultValue: '',
                                readonly: true,
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition,
                i18nService: new MockI18nService(),
                logger: { log: () => {}, warn: () => {}, error: () => {} },
            });

            const container = env.document.createElement('div');
            renderer.render(container);
            await flushAsync();

            renderer._handleError(
                { action: 'updateControls', mapping: { error: 'runtime_status' } },
                new Error('SSID must be 1-32 characters')
            );

            assert.equal(
                renderer.getControlValue('runtime_status'),
                'SSID must be 1-32 characters'
            );

            env.cleanup();
        });
    });

        describe('Parameter Extraction', () => {
        it('should extract literal parameters', () => {
            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const params = renderer._extractParameters(['literal', 42, true]);

            assert.deepEqual(params, ['literal', 42, true]);
        });

        it('should extract control values with ${} substitution', () => {
            const env = createTestEnvironment();

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const params = renderer._extractParameters(['${text_input}', '${number_input}']);

            assert.deepEqual(params, ['default text', 42]);

            env.cleanup();
        });

        it('should throw error for unknown control ID', () => {
            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            assert.throws(
                () => {
                    renderer._extractParameters(['${unknown_control}']);
                },
                { message: 'Control not found: unknown_control' }
            );
        });

        it('should mix literal and control values', () => {
            const env = createTestEnvironment();

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const params = renderer._extractParameters([
                'prefix',
                '${text_input}',
                123,
                '${number_input}',
            ]);

            assert.deepEqual(params, ['prefix', 'default text', 123, 42]);

            env.cleanup();
        });
    });

    describe('Cleanup', () => {
        let env;

        beforeEach(() => {
            env = createTestEnvironment();
        });

        it('should cleanup resources on destroy', () => {
            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            assert.equal(renderer._controls.size, 2);

            renderer.destroy();

            assert.equal(renderer._controls.size, 0);

            env.cleanup();
        });
    });

    describe('I18n Integration', () => {
        let env;

        beforeEach(() => {
            env = createTestEnvironment();
        });

        it('should translate keys using i18n service', () => {
            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.key', 'Translated Text');
            i18nService.setTranslation('test.withVar', 'Hello {name}');

            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService,
            });

            assert.equal(renderer._t('test.key'), 'Translated Text');
            assert.equal(renderer._t('test.withVar', { name: 'World' }), 'Hello World');

            env.cleanup();
        });

        it('should return key if no i18n service', () => {
            const renderer = new CustomViewRenderer({
                deviceConnection: new MockDeviceConnection(),
                viewDefinition: createBasicViewDefinition(),
                i18nService: null,
            });

            assert.equal(renderer._t('test.key'), 'test.key');

            env.cleanup();
        });
    });

    describe('Function Execution', () => {
        let env;

        beforeEach(() => {
            env = createTestEnvironment();
        });

        it('should execute function with success', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'save_settings',
                ['test_value', 42],
                '{"status": "ok"}'
            );

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'text_input',
                                type: 'text',
                                label: 'test.label',
                                defaultValue: 'test_value',
                            },
                            {
                                id: 'number_input',
                                type: 'number',
                                label: 'test.number',
                                defaultValue: 42,
                            },
                            {
                                id: 'save_button',
                                type: 'button',
                                label: 'test.save',
                                function: {
                                    name: 'save_settings',
                                    parameters: ['${text_input}', '${number_input}'],
                                },
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[2];
            await renderer._executeFunction(buttonDef);

            assert.equal(deviceConnection.customViewActionCalls.length, 1);
            assert.equal(deviceConnection.customViewActionCalls[0].functionName, 'save_settings');
            assert.deepEqual(deviceConnection.customViewActionCalls[0].parameters, [
                'test_value',
                42,
            ]);

            env.cleanup();
        });

        it('should execute function with error', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('fail_func', [], new Error('Device error'));

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'fail_button',
                                type: 'button',
                                label: 'test.fail',
                                function: {
                                    name: 'fail_func',
                                    parameters: [],
                                },
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[0];

            // Should not throw - error is handled internally
            await renderer._executeFunction(buttonDef);

            env.cleanup();
        });

        it('should validate controls before execution', async () => {
            const deviceConnection = new MockDeviceConnection();

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'text_input',
                                type: 'text',
                                label: 'test.label',
                                defaultValue: 'test',
                            },
                            {
                                id: 'save_button',
                                type: 'button',
                                label: 'test.save',
                                validate: ['text_input'],
                                function: {
                                    name: 'save_settings',
                                    parameters: ['${text_input}'],
                                },
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('customView.validationFailed', 'Validation failed');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[1];
            await renderer._executeFunction(buttonDef);

            // Validation should pass and function should execute
            assert.ok(deviceConnection.customViewActionCalls.length > 0);

            env.cleanup();
        });

        it('should handle onSuccess with updateControls action', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'load_settings',
                [],
                '{"ssid": "MyWiFi", "port": 8080}'
            );

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'ssid',
                                type: 'text',
                                label: 'test.ssid',
                                defaultValue: '',
                            },
                            {
                                id: 'port',
                                type: 'number',
                                label: 'test.port',
                                defaultValue: 0,
                            },
                            {
                                id: 'load_button',
                                type: 'button',
                                label: 'test.load',
                                function: {
                                    name: 'load_settings',
                                    parameters: [],
                                    onSuccess: {
                                        action: 'updateControls',
                                        mapping: {
                                            ssid: 'ssid',
                                            port: 'port',
                                        },
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[2];
            await renderer._executeFunction(buttonDef);

            // Verify controls were updated
            assert.equal(renderer.getControlValue('ssid'), 'MyWiFi');
            assert.equal(renderer.getControlValue('port'), 8080);

            env.cleanup();
        });

        it('should handle onSuccess with showMessage action', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('save_settings', ['test'], '{"status": "ok"}');

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'text_input',
                                type: 'text',
                                label: 'test.label',
                                defaultValue: 'test',
                            },
                            {
                                id: 'save_button',
                                type: 'button',
                                label: 'test.save',
                                function: {
                                    name: 'save_settings',
                                    parameters: ['${text_input}'],
                                    onSuccess: {
                                        action: 'showMessage',
                                        messageType: 'success',
                                        message: 'test.success',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.success', 'Settings saved!');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[1];
            await renderer._executeFunction(buttonDef);

            // Function should complete successfully
            assert.equal(deviceConnection.customViewActionCalls.length, 1);

            env.cleanup();
        });

        it('should handle onSuccess with softReset action', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('save_settings', ['test'], '{"success": true}');

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'text_input',
                                type: 'text',
                                label: 'test.label',
                                defaultValue: 'test',
                            },
                            {
                                id: 'save_button',
                                type: 'button',
                                label: 'test.save',
                                function: {
                                    name: 'save_settings',
                                    parameters: ['${text_input}'],
                                    onSuccess: {
                                        action: 'softReset',
                                        messageType: 'success',
                                        message: 'test.success',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.success', 'Settings saved!');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[1];
            await renderer._executeFunction(buttonDef);

            assert.equal(deviceConnection.customViewActionCalls.length, 1);
            assert.equal(deviceConnection.softResetCalls, 1);

            env.cleanup();
        });

        it('should handle softReset action failure as execution error', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.softResetError = new Error('Reset failed');
            deviceConnection.setMockResponse('save_settings', ['test'], '{"success": true}');

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'text_input',
                                type: 'text',
                                label: 'test.label',
                                defaultValue: 'test',
                            },
                            {
                                id: 'save_button',
                                type: 'button',
                                label: 'test.save',
                                function: {
                                    name: 'save_settings',
                                    parameters: ['${text_input}'],
                                    onSuccess: {
                                        action: 'softReset',
                                        messageType: 'success',
                                        message: 'test.success',
                                    },
                                    onError: {
                                        action: 'showMessage',
                                        messageType: 'error',
                                        message: 'test.error',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.success', 'Settings saved!');
            i18nService.setTranslation('test.error', 'Reset failed!');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[1];
            await renderer._executeFunction(buttonDef);

            assert.equal(deviceConnection.customViewActionCalls.length, 1);
            assert.equal(deviceConnection.softResetCalls, 1);

            env.cleanup();
        });

        it('should handle onError with showMessage action', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('failing_func', [], new Error('Device error'));

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'section1',
                        title: 'test.section1',
                        controls: [
                            {
                                id: 'fail_button',
                                type: 'button',
                                label: 'test.fail',
                                function: {
                                    name: 'failing_func',
                                    parameters: [],
                                    onError: {
                                        action: 'showMessage',
                                        messageType: 'error',
                                        message: 'test.error',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const i18nService = new MockI18nService();
            i18nService.setTranslation('test.error', 'Operation failed!');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService,
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[0];
            await renderer._executeFunction(buttonDef);

            // Error should be handled gracefully
            assert.equal(deviceConnection.customViewActionCalls.length, 1);

            env.cleanup();
        });

        it('should handle callDeviceFunction with JSON response', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse(
                'get_status',
                [],
                '{"connected": true, "uptime": 3600}'
            );

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const result = await renderer._callDeviceFunction('get_status', []);

            assert.deepEqual(result, { connected: true, uptime: 3600, success: true });

            env.cleanup();
        });

        it('should use dedicated custom-view action API and pass runtime impact metadata', async () => {
            const captured = [];
            const deviceConnection = {
                executeCustomViewAction: async (functionName, parameters, options) => {
                    captured.push({ functionName, parameters, options });
                    return '{"ok": true}';
                },
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            const result = await renderer._callDeviceFunction('set_mode', ['STA', true], 'restart');

            assert.deepEqual(result, { ok: true, success: true });
            assert.equal(captured.length, 1);
            assert.equal(captured[0].functionName, 'set_mode');
            assert.deepEqual(captured[0].parameters, ['STA', true]);
            assert.equal(captured[0].options.runtimeImpact, 'restart');

            env.cleanup();
        });

        it('should reject execution when dedicated custom-view action API is unavailable', async () => {
            const deviceConnection = {};

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            await assert.rejects(
                () => renderer._callDeviceFunction('legacy_func', [7], 'stop'),
                /executeCustomViewAction.*direct executeCode fallback is not supported/
            );

            env.cleanup();
        });

        it('should handle callDeviceFunction with non-JSON response', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('get_text', [], 'plain text response');

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: createBasicViewDefinition(),
                i18nService: new MockI18nService(),
            });

            await assert.rejects(
                () => renderer._callDeviceFunction('get_text', []),
                /returned non-JSON output/
            );

            env.cleanup();
        });

        it('should use dedicated refresh API when function executionIntent is refresh', async () => {
            const deviceConnection = new MockDeviceConnection();
            deviceConnection.setMockResponse('check_wifi_status', [], '{"status": "Connected"}');

            const viewDef = {
                ...createBasicViewDefinition(),
                sections: [
                    {
                        id: 'runtime',
                        title: 'runtime',
                        controls: [
                            {
                                id: 'refresh_button',
                                type: 'button',
                                label: 'refresh',
                                function: {
                                    name: 'check_wifi_status',
                                    executionIntent: 'refresh',
                                    runtimeImpact: 'stop',
                                    parameters: [],
                                },
                            },
                        ],
                    },
                ],
            };

            const renderer = new CustomViewRenderer({
                deviceConnection,
                viewDefinition: viewDef,
                i18nService: new MockI18nService(),
            });

            const container = env.document.createElement('div');
            renderer.render(container);

            const buttonDef = viewDef.sections[0].controls[0];
            await renderer._executeFunction(buttonDef);

            assert.equal(deviceConnection.customViewRefreshActionCalls.length, 1);
            assert.equal(deviceConnection.customViewActionCalls.length, 0);
            assert.equal(
                deviceConnection.customViewRefreshActionCalls[0].functionName,
                'check_wifi_status'
            );
            assert.equal(
                deviceConnection.customViewRefreshActionCalls[0].options.runtimeImpact,
                'stop'
            );

            env.cleanup();
        });
    });
});

describe('CustomViewRenderer visibleWhen', () => {
    let env;

    beforeEach(() => {
        env = createTestEnvironment();
    });

    function buildRenderer(controls) {
        const viewDef = {
            version: '1.0.0',
            sections: [
                {
                    id: 'section1',
                    title: 'test.section1',
                    collapsible: false,
                    controls,
                },
            ],
        };
        const renderer = new CustomViewRenderer({
            deviceConnection: new MockDeviceConnection(),
            viewDefinition: viewDef,
            i18nService: new MockI18nService(),
        });
        const container = env.document.createElement('div');
        renderer.render(container);
        return { renderer, container, viewDef };
    }

    function wrapperFor(container, controlId) {
        return container.querySelector(`[data-control-id="${controlId}"]`);
    }

    it('hides a control until its condition matches', () => {
        const { renderer, container } = buildRenderer([
            { id: 'flag', type: 'checkbox', label: 'test.flag', defaultValue: false },
            {
                id: 'conditional',
                type: 'text',
                label: 'test.conditional',
                defaultValue: '',
                visibleWhen: { controlId: 'flag', equals: true },
            },
        ]);

        const conditional = wrapperFor(container, 'conditional');
        assert.equal(conditional.hidden, true);

        renderer.setControlValue('flag', true);

        assert.equal(conditional.hidden, false);

        env.cleanup();
    });

    it('treats an array of conditions as AND', () => {
        const { renderer, container } = buildRenderer([
            { id: 'sta', type: 'checkbox', label: 'test.sta', defaultValue: true },
            { id: 'ap', type: 'checkbox', label: 'test.ap', defaultValue: false },
            {
                id: 'both_fields',
                type: 'text',
                label: 'test.both',
                defaultValue: '',
                visibleWhen: [
                    { controlId: 'sta', equals: true },
                    { controlId: 'ap', equals: true },
                ],
            },
        ]);

        const both = wrapperFor(container, 'both_fields');
        assert.equal(both.hidden, true);

        renderer.setControlValue('ap', true);

        assert.equal(both.hidden, false);

        env.cleanup();
    });

    it('keeps a control visible when the referenced control is unknown', () => {
        const { container } = buildRenderer([
            {
                id: 'forward',
                type: 'text',
                label: 'test.forward',
                defaultValue: '',
                visibleWhen: { controlId: 'not_rendered', equals: true },
            },
        ]);

        assert.equal(wrapperFor(container, 'forward').hidden, false);

        env.cleanup();
    });

    it('skips hidden controls in button validation arrays', async () => {
        const deviceConnection = new MockDeviceConnection();
        deviceConnection.setMockResponse('save_settings', [], '{}');
        const viewDef = {
            version: '1.0.0',
            sections: [
                {
                    id: 'section1',
                    title: 'test.section1',
                    collapsible: false,
                    controls: [
                        { id: 'flag', type: 'checkbox', label: 'test.flag', defaultValue: false },
                        {
                            id: 'hidden_field',
                            type: 'text',
                            label: 'test.hiddenField',
                            defaultValue: '',
                            validation: { minLength: 5 },
                            visibleWhen: { controlId: 'flag', equals: true },
                        },
                        {
                            id: 'save_button',
                            type: 'button',
                            label: 'test.save',
                            validate: ['hidden_field'],
                            function: { name: 'save_settings', parameters: [] },
                        },
                    ],
                },
            ],
        };
        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: viewDef,
            i18nService: new MockI18nService(),
        });
        const container = env.document.createElement('div');
        renderer.render(container);

        await renderer._executeFunction(viewDef.sections[0].controls[2]);
        assert.equal(deviceConnection.customViewActionCalls.length, 1);

        renderer.setControlValue('flag', true);
        await renderer._executeFunction(viewDef.sections[0].controls[2]);
        assert.equal(deviceConnection.customViewActionCalls.length, 1);

        env.cleanup();
    });

    it('collapses a row whose children are all hidden', () => {
        const { renderer, container } = buildRenderer([
            { id: 'flag', type: 'checkbox', label: 'test.flag', defaultValue: false },
            {
                type: 'row',
                controls: [
                    {
                        id: 'row_a',
                        type: 'text',
                        label: 'test.rowA',
                        defaultValue: '',
                        visibleWhen: { controlId: 'flag', equals: true },
                    },
                    {
                        id: 'row_b',
                        type: 'text',
                        label: 'test.rowB',
                        defaultValue: '',
                        visibleWhen: { controlId: 'flag', equals: true },
                    },
                ],
            },
        ]);

        const row = container.querySelector('.stack-view--horizontal');
        const rowItem = row.closest('.stack-view__item');
        assert.equal(rowItem.hidden, true);

        renderer.setControlValue('flag', true);

        assert.equal(rowItem.hidden, false);

        env.cleanup();
    });

    it('never hides a control without visibleWhen', () => {
        const { renderer, container } = buildRenderer([
            { id: 'plain', type: 'text', label: 'test.plain', defaultValue: 'x' },
            { id: 'flag', type: 'checkbox', label: 'test.flag', defaultValue: false },
        ]);

        const plain = wrapperFor(container, 'plain');
        assert.equal(plain.hidden, false);

        renderer.setControlValue('flag', true);
        renderer.setControlValue('plain', 'y');

        assert.equal(plain.hidden, false);

        env.cleanup();
    });
});

describe('CustomViewRenderer validation feedback', () => {
    let env;

    beforeEach(() => {
        env = createTestEnvironment();
    });

    function buildValidationView({ withOnError = true } = {}) {
        const onError = withOnError
            ? { action: 'updateControls', mapping: { error: 'status' } }
            : undefined;

        return {
            version: '1.0.0',
            sections: [
                {
                    id: 'section1',
                    title: 'test.section1',
                    collapsible: false,
                    controls: [
                        {
                            id: 'status',
                            type: 'text',
                            label: 'test.status',
                            defaultValue: '',
                            readonly: true,
                        },
                        {
                            id: 'password',
                            type: 'text',
                            label: 'test.password',
                            defaultValue: '',
                            password: true,
                            validation: { minLength: 8, maxLength: 63 },
                        },
                        {
                            id: 'save_button',
                            type: 'button',
                            label: 'test.save',
                            validate: ['password'],
                            function: {
                                name: 'save_settings',
                                parameters: ['${password}'],
                                ...(onError ? { onError } : {}),
                            },
                        },
                    ],
                },
            ],
        };
    }

    it('marks the invalid control and reports the block through onError', async () => {
        const deviceConnection = new MockDeviceConnection();
        const viewDef = buildValidationView();
        const i18nService = new MockI18nService();
        i18nService.setTranslation('customView.validationFailed', 'Validation failed');

        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: viewDef,
            i18nService,
        });

        const container = env.document.createElement('div');
        renderer.render(container);

        const executed = await renderer._executeFunction(viewDef.sections[0].controls[2]);

        assert.equal(executed, false);
        assert.equal(deviceConnection.customViewActionCalls.length, 0);
        assert.equal(
            renderer._controls.get('status').getValue(),
            'Validation failed: test.password',
            'The block must reach the view instead of only the console'
        );

        const wrapper = container.querySelector('[data-control-id="password"] .custom-control');
        assert.ok(
            wrapper.classList.contains('is-invalid'),
            'The offending control must be marked'
        );

        env.cleanup();
    });

    it('falls back to an error dialog when the button declares no onError handler', async () => {
        const deviceConnection = new MockDeviceConnection();
        const viewDef = buildValidationView({ withOnError: false });
        const i18nService = new MockI18nService();
        i18nService.setTranslation('customView.validationFailed', 'Validation failed');

        const errorDialogs = [];
        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: viewDef,
            i18nService,
            viewManager: {
                showInfo: async () => {},
                showError: async (options) => {
                    errorDialogs.push(options);
                },
            },
        });

        const container = env.document.createElement('div');
        renderer.render(container);

        await renderer._executeFunction(viewDef.sections[0].controls[2]);

        assert.equal(deviceConnection.customViewActionCalls.length, 0);
        assert.equal(errorDialogs.length, 1);
        assert.match(errorDialogs[0].message, /Validation failed/);

        env.cleanup();
    });

    it('clears the invalid marker once the control value changes', async () => {
        const deviceConnection = new MockDeviceConnection();
        const viewDef = buildValidationView();
        const renderer = new CustomViewRenderer({
            deviceConnection,
            viewDefinition: viewDef,
            i18nService: new MockI18nService(),
        });

        const container = env.document.createElement('div');
        renderer.render(container);

        const wrapper = container.querySelector('[data-control-id="password"] .custom-control');
        await renderer._executeFunction(viewDef.sections[0].controls[2]);
        assert.ok(wrapper.classList.contains('is-invalid'));

        renderer.setControlValue('password', 'long-enough-password');
        assert.ok(!wrapper.classList.contains('is-invalid'));

        const executed = await renderer._executeFunction(viewDef.sections[0].controls[2]);
        assert.equal(executed, true);
        assert.equal(deviceConnection.customViewActionCalls.length, 1);

        env.cleanup();
    });
});

describe('CustomViewRenderer stack layout', () => {
    let env;

    beforeEach(() => {
        env = createTestEnvironment();
    });

    function buildRenderer(controls) {
        const viewDef = {
            version: '1.0.0',
            title: 'test.title',
            sections: [
                {
                    id: 'section1',
                    title: 'test.section1',
                    collapsible: false,
                    controls,
                },
            ],
        };
        const renderer = new CustomViewRenderer({
            deviceConnection: new MockDeviceConnection(),
            viewDefinition: viewDef,
            i18nService: new MockI18nService(),
        });
        const container = env.document.createElement('div');
        renderer.render(container);
        return { renderer, container, viewDef };
    }

    it('renders a horizontal wrapping stack with child controls in order', () => {
        const { renderer, container } = buildRenderer([
            {
                type: 'stack',
                direction: 'horizontal',
                wrap: true,
                gap: '12px',
                controls: [
                    { id: 'webserver_enable', type: 'checkbox', label: 'test.enable', defaultValue: true, width: 180 },
                    { id: 'webserver_port', type: 'number', label: 'test.port', defaultValue: 80, width: 130 },
                ],
            },
        ]);

        const stack = container.querySelector('.stack-view--horizontal.stack-view--wrap');
        assert.ok(stack, 'wrapping horizontal stack container should render');
        assert.equal(stack.style.getPropertyValue('--stack-view-gap'), '12px');

        const children = Array.from(stack.children).map(
            (child) => child.firstElementChild?.dataset.controlId
        );
        assert.deepEqual(children, ['webserver_enable', 'webserver_port']);
        assert.ok(renderer._controls.has('webserver_enable'));
        assert.ok(renderer._controls.has('webserver_port'));

        env.cleanup();
    });

    it('renders a vertical stack as a non-wrapping column', () => {
        const { container } = buildRenderer([
            {
                type: 'stack',
                direction: 'vertical',
                controls: [{ id: 'a', type: 'text', label: 'test.a', defaultValue: '' }],
            },
        ]);

        const stack = container.querySelector('.collapsible-view .stack-view--vertical');
        assert.ok(stack);
        assert.ok(!stack.classList.contains('stack-view--wrap'));
        assert.ok(container.querySelector('[data-control-id="a"]'));

        env.cleanup();
    });

    it('registers nested control ids for stack visibility tracking', () => {
        const { renderer } = buildRenderer([
            {
                type: 'stack',
                direction: 'horizontal',
                controls: [
                    { id: 'a', type: 'text', label: 'test.a', defaultValue: '' },
                    {
                        type: 'row',
                        controls: [
                            { id: 'b', type: 'text', label: 'test.b', defaultValue: '' },
                            { id: 'c', type: 'text', label: 'test.c', defaultValue: '' },
                        ],
                    },
                ],
            },
        ]);

        const stackGroup = renderer._groupItems.find((group) => group.controlIds.length === 3);
        assert.ok(stackGroup, 'the outer stack tracks all nested controls');
        assert.deepEqual([...stackGroup.controlIds].sort(), ['a', 'b', 'c']);

        const rowGroup = renderer._groupItems.find((group) => group.controlIds.length === 2);
        assert.ok(rowGroup, 'the nested row tracks its own controls');
        assert.deepEqual([...rowGroup.controlIds].sort(), ['b', 'c']);

        env.cleanup();
    });

    it('hides a stack whose nested controls are all hidden', () => {
        const { renderer, container } = buildRenderer([
            { id: 'flag', type: 'checkbox', label: 'test.flag', defaultValue: false },
            {
                type: 'stack',
                direction: 'horizontal',
                controls: [
                    {
                        id: 'stack_a',
                        type: 'text',
                        label: 'test.stackA',
                        defaultValue: '',
                        visibleWhen: { controlId: 'flag', equals: true },
                    },
                    {
                        id: 'stack_b',
                        type: 'text',
                        label: 'test.stackB',
                        defaultValue: '',
                        visibleWhen: { controlId: 'flag', equals: true },
                    },
                ],
            },
        ]);

        const stack = container.querySelector('.stack-view--horizontal');
        const stackItem = stack.closest('.stack-view__item');
        assert.equal(stackItem.hidden, true);

        renderer.setControlValue('flag', true);

        assert.equal(stackItem.hidden, false);

        env.cleanup();
    });
});

