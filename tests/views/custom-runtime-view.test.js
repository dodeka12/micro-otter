// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for CustomRuntimeView (non-DOM logic tests only)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Minimal JSDOM setup for ViewBase constructor
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLDetailsElement = dom.window.HTMLDetailsElement;
global.EventTarget = dom.window.EventTarget;
global.CustomEvent = dom.window.CustomEvent;
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);

import { CustomRuntimeView } from '../../src/micro_otter/nodes/html/js/views/custom-runtime-view.js';

describe('CustomRuntimeView', () => {
    let mockI18nService;
    let mockLogger;
    let mockDeviceConnection;
    let mockViewDefinition;

    beforeEach(() => {
        // Mock i18n service
        mockI18nService = {
            currentLocale: 'en',
            t: (key) => key,
        };

        // Mock logger
        mockLogger = {
            log: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
        };

        // Mock device connection
        mockDeviceConnection = {
            id: 'mock-connection',
            getCustomViewRenderer: () => null,
        };

        // Mock view definition
        mockViewDefinition = {
            version: '1.0',
            sections: [
                {
                    id: 'test-section',
                    title: 'Test Section',
                    controls: [],
                },
            ],
        };
    });

    describe('Constructor', () => {
        it('should create instance with required parameters', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.ok(view instanceof CustomRuntimeView);
            assert.strictEqual(view._viewDefinition, mockViewDefinition);
            assert.strictEqual(view._deviceConnection, mockDeviceConnection);
            assert.strictEqual(view._renderer, null);
        });

        it('should accept custom title and icon', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
                title: 'Custom Title',
                icon: 'custom-icon',
            });

            assert.strictEqual(view.title, 'Custom Title');
            assert.strictEqual(view.icon, 'custom-icon');
        });

        it('should use default title and icon if not provided', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.strictEqual(view.title, 'Runtime Settings');
            assert.strictEqual(view.icon, 'settings');
        });

        it('should accept null viewDefinition', () => {
            const view = new CustomRuntimeView({
                viewDefinition: null,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.strictEqual(view._viewDefinition, null);
        });

        it('should accept null deviceConnection', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: null,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.strictEqual(view._deviceConnection, null);
        });
    });

    describe('serialize()', () => {
        it('should return serialized state with type', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
                title: 'Test View',
                icon: 'test-icon',
            });

            const serialized = view.serialize();

            assert.strictEqual(serialized.type, 'custom-runtime-view');
            assert.strictEqual(serialized.title, 'Test View');
            assert.strictEqual(serialized.icon, 'test-icon');
        });

        it('should not include viewDefinition in serialized state', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            const serialized = view.serialize();

            assert.strictEqual(serialized.viewDefinition, undefined);
            assert.strictEqual(serialized.deviceConnection, undefined);
        });

        it('should inherit ViewBase serialization properties', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
                title: 'Test View',
            });

            const serialized = view.serialize();

            // ViewBase serialization includes id, title, icon
            assert.ok(serialized.id);
            assert.strictEqual(typeof serialized.id, 'string');
            assert.strictEqual(serialized.title, 'Test View');
        });
    });

    describe('deserialize()', () => {
        it('should throw error when deviceConnection is missing from context', () => {
            const data = {
                type: 'custom-runtime-view',
                title: 'Test View',
                icon: 'settings',
            };

            assert.throws(
                () => {
                    CustomRuntimeView.deserialize(data, {});
                },
                {
                    name: 'Error',
                    message: /deviceConnection/,
                }
            );
        });

        it('should throw error when context is null', () => {
            const data = {
                type: 'custom-runtime-view',
                title: 'Test View',
            };

            assert.throws(
                () => {
                    CustomRuntimeView.deserialize(data, null);
                },
                {
                    name: 'Error',
                    message: /deviceConnection/,
                }
            );
        });

        it('should create instance when deviceConnection is provided', () => {
            const data = {
                type: 'custom-runtime-view',
                title: 'Restored View',
                icon: 'restore-icon',
            };

            const context = {
                deviceConnection: mockDeviceConnection,
                viewDefinition: mockViewDefinition,
                i18nService: mockI18nService,
                logger: mockLogger,
            };

            const view = CustomRuntimeView.deserialize(data, null, context);

            assert.ok(view instanceof CustomRuntimeView);
            assert.strictEqual(view.title, 'Restored View');
            assert.strictEqual(view.icon, 'restore-icon');
            assert.strictEqual(view._deviceConnection, mockDeviceConnection);
            assert.strictEqual(view._viewDefinition, mockViewDefinition);
        });

        it('should work with null viewDefinition in context', () => {
            const data = {
                type: 'custom-runtime-view',
                title: 'View without definition',
            };

            const context = {
                deviceConnection: mockDeviceConnection,
                viewDefinition: null,
                i18nService: mockI18nService,
                logger: mockLogger,
            };

            const view = CustomRuntimeView.deserialize(data, null, context);

            assert.ok(view instanceof CustomRuntimeView);
            assert.strictEqual(view._viewDefinition, null);
        });

        it('should pass through context services', () => {
            const data = {
                type: 'custom-runtime-view',
                title: 'Test',
            };

            const context = {
                deviceConnection: mockDeviceConnection,
                viewDefinition: mockViewDefinition,
                i18nService: mockI18nService,
                logger: mockLogger,
            };

            const view = CustomRuntimeView.deserialize(data, null, context);

            assert.strictEqual(view._i18nService, mockI18nService);
            assert.strictEqual(view._logger, mockLogger);
        });
    });

    describe('Renderer lifecycle', () => {
        it('should initialize with null renderer', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.strictEqual(view._renderer, null);
        });

        it('should maintain renderer as null before render() is called', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            // Renderer should remain null until render() creates it
            assert.strictEqual(view._renderer, null);
        });

        it('should suppress the top-level details header when showHeader is false', () => {
            const viewDefinition = {
                version: '1.0',
                title: 'generalRuntime.customView.title',
                description: 'generalRuntime.customView.description',
                sections: [
                    {
                        id: 'test-section',
                        title: 'Test Section',
                        controls: [],
                    },
                ],
            };

            const view = new CustomRuntimeView({
                viewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
                showHeader: false,
            });

            const container = document.createElement('div');
            view.render(container);

            assert.equal(
                container.querySelector('.stack-view > .stack-view__item > .collapsible-view'),
                null
            );
            assert.equal(
                container.querySelector('.message-view--muted')?.textContent,
                'generalRuntime.customView.description'
            );
            assert.ok(container.querySelector('.split-view'));
        });

        it('should delegate top-level collapse to CollapsibleView', () => {
            const viewDefinition = {
                version: '1.0',
                title: 'Runtime Settings',
                sections: [
                    {
                        id: 'test-section',
                        title: 'Test Section',
                        controls: [],
                    },
                ],
            };

            const view = new CustomRuntimeView({
                viewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            const container = document.createElement('div');
            view.render(container);

            const header = container.querySelector('.collapsible-view');
            assert.ok(header, 'Top-level CollapsibleView should exist');
            const toggle = header.querySelector('.collapsible-view__toggle');
            assert.ok(toggle, 'Top-level toggle should exist');

            toggle.click();
            assert.equal(header.classList.contains('is-collapsed'), true);

            toggle.click();
            assert.equal(header.classList.contains('is-collapsed'), false);
        });
    });

    describe('ViewBase integration', () => {
        it('should have ViewBase methods available', () => {
            const view = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            // Check ViewBase methods exist
            assert.strictEqual(typeof view.serialize, 'function');
            assert.strictEqual(typeof view.attachTo, 'function');
            assert.strictEqual(typeof view.detach, 'function');
            assert.strictEqual(typeof view.render, 'function');
            assert.strictEqual(typeof view.afterAttach, 'function');
            assert.strictEqual(typeof view.beforeDetach, 'function');
        });

        it('should have unique id generated by ViewBase', () => {
            const view1 = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            const view2 = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            assert.ok(view1.id);
            assert.ok(view2.id);
            assert.notStrictEqual(view1.id, view2.id);
        });
    });

    describe('Serialization round-trip', () => {
        it('should preserve title and icon through serialize/deserialize', () => {
            const originalView = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
                title: 'Original Title',
                icon: 'original-icon',
            });

            const serialized = originalView.serialize();

            const context = {
                deviceConnection: mockDeviceConnection,
                viewDefinition: mockViewDefinition,
                i18nService: mockI18nService,
                logger: mockLogger,
            };

            const restoredView = CustomRuntimeView.deserialize(serialized, null, context);

            assert.strictEqual(restoredView.title, 'Original Title');
            assert.strictEqual(restoredView.icon, 'original-icon');
        });

        it('should preserve id through serialize/deserialize', () => {
            const originalView = new CustomRuntimeView({
                viewDefinition: mockViewDefinition,
                deviceConnection: mockDeviceConnection,
                i18nService: mockI18nService,
                logger: mockLogger,
            });

            const originalId = originalView.id;
            const serialized = originalView.serialize();

            const context = {
                deviceConnection: mockDeviceConnection,
                viewDefinition: mockViewDefinition,
                i18nService: mockI18nService,
                logger: mockLogger,
            };

            const restoredView = CustomRuntimeView.deserialize(serialized, null, context);

            assert.strictEqual(restoredView.id, originalId);
        });
    });
});
