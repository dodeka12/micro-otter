// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for ConsoleLogView (non-DOM logic tests only)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Minimal JSDOM setup for ViewBase constructor
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.EventTarget = dom.window.EventTarget;
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);

import { ConsoleLogView } from '../../src/micro_otter/nodes/html/js/views/console-log-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

describe('ConsoleLogView', () => {
    let view;
    let mockI18nService;

    beforeEach(() => {
        // Mock i18n service
        mockI18nService = {
            currentLocale: 'en',
            t: (key) => key,
        };

        view = new ConsoleLogView({
            i18nService: mockI18nService,
            logger: { log: () => {} },
        });
    });

    describe('Constructor', () => {
        it('should create instance with default options', () => {
            assert.ok(view instanceof ConsoleLogView);
            assert.strictEqual(view._maxMessages, 1000);
            assert.strictEqual(view._autoScroll, true);
            assert.ok(Array.isArray(view._messages));
            assert.strictEqual(view._messages.length, 0);
        });

        it('should accept custom options', () => {
            const customView = new ConsoleLogView({
                i18nService: mockI18nService,
                logger: { log: () => {} },
                maxMessages: 500,
                autoScroll: false,
            });

            assert.strictEqual(customView._maxMessages, 500);
            assert.strictEqual(customView._autoScroll, false);
        });

        it('should merge custom message types with defaults', () => {
            const customView = new ConsoleLogView({
                i18nService: mockI18nService,
                logger: { log: () => {} },
                messageTypes: {
                    custom: {
                        className: 'msg-custom',
                        icon: 'custom-icon',
                    },
                },
            });

            // Should have both default and custom types
            assert.ok(customView._messageTypes.info);
            assert.ok(customView._messageTypes.otter);
            assert.ok(customView._messageTypes.custom);
        });

        it('should include default otter message type with icon path', () => {
            assert.ok(view._messageTypes.otter);
            assert.ok(typeof view._messageTypes.otter.iconPath === 'string');
            assert.equal(view._messageTypes.otter.iconPath, IconProvider.get('otterHead64'));
        });

        it('should include default raw message type', () => {
            assert.ok(view._messageTypes.raw);
            assert.strictEqual(view._messageTypes.raw.id, 'raw');
            assert.strictEqual(view._messageTypes.raw.className, 'msg-raw');
            assert.strictEqual(view._messageTypes.raw.label, 'console.types.raw');
        });

        it('should exclude raw message type from default active filters', () => {
            assert.ok(view._activeFilters.has('otter'));
            assert.ok(view._activeFilters.has('user'));
            assert.ok(!view._activeFilters.has('info'));
            assert.ok(!view._activeFilters.has('raw'));
        });
    });

    describe('addMessage()', () => {
        it('should add a message to the log', () => {
            view.addMessage('info', 'Test message');

            const messages = view.getMessages();
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].type, 'info');
            assert.strictEqual(messages[0].message, 'Test message');
        });

        it('should add multiple messages', () => {
            view.addMessage('info', 'Message 1');
            view.addMessage('error', 'Message 2');
            view.addMessage('warning', 'Message 3');

            const messages = view.getMessages();
            assert.strictEqual(messages.length, 3);
        });

        it('should fallback to info type for unknown types', () => {
            view.addMessage('unknown-type', 'Test message');

            const messages = view.getMessages();
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].type, 'info');
        });

        it('should keep raw message type instead of falling back to info', () => {
            view.addMessage('raw', '[wv-refresh] request-keys');

            const messages = view.getMessages();
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].type, 'raw');
            assert.strictEqual(messages[0].message, '[wv-refresh] request-keys');
        });

        it('should emit message-added event', () => {
            let eventFired = false;
            view.on('message-added', () => {
                eventFired = true;
            });

            view.addMessage('info', 'Test message');
            assert.strictEqual(eventFired, true);
        });

        it('should implement circular buffer when max messages reached', () => {
            const smallView = new ConsoleLogView({
                i18nService: mockI18nService,
                logger: { log: () => {} },
                maxMessages: 5,
            });

            // Add more messages than maxMessages
            for (let i = 0; i < 10; i++) {
                smallView.addMessage('info', `Message ${i}`);
            }

            const messages = smallView.getMessages();
            assert.strictEqual(messages.length, 5);

            // Should have messages 5-9 (oldest messages dropped)
            assert.strictEqual(messages[0].message, 'Message 5');
            assert.strictEqual(messages[4].message, 'Message 9');
        });
    });

    describe('addMessages()', () => {
        it('should add multiple messages efficiently', () => {
            const messagesToAdd = [
                { type: 'info', message: 'Message 1' },
                { type: 'error', message: 'Message 2' },
                { type: 'warning', message: 'Message 3' },
            ];

            view.addMessages(messagesToAdd);

            const messages = view.getMessages();
            assert.strictEqual(messages.length, 3);
            assert.strictEqual(messages[0].message, 'Message 1');
            assert.strictEqual(messages[1].message, 'Message 2');
            assert.strictEqual(messages[2].message, 'Message 3');
        });
    });

    describe('clearMessages()', () => {
        it('should clear all messages', () => {
            view.addMessage('info', 'Message 1');
            view.addMessage('info', 'Message 2');
            assert.strictEqual(view.getMessages().length, 2);

            view.clearMessages();

            assert.strictEqual(view.getMessages().length, 0);
        });

        it('should emit messages-cleared event', () => {
            let eventFired = false;
            view.on('messages-cleared', () => {
                eventFired = true;
            });

            view.addMessage('info', 'Test');
            view.clearMessages();

            assert.strictEqual(eventFired, true);
        });
    });

    describe('getMessages()', () => {
        it('should return empty array when no messages', () => {
            const messages = view.getMessages();
            assert.ok(Array.isArray(messages));
            assert.strictEqual(messages.length, 0);
        });

        it('should return messages in chronological order', () => {
            view.addMessage('info', 'First');
            view.addMessage('info', 'Second');
            view.addMessage('info', 'Third');

            const messages = view.getMessages();
            assert.strictEqual(messages[0].message, 'First');
            assert.strictEqual(messages[1].message, 'Second');
            assert.strictEqual(messages[2].message, 'Third');
        });

        it('should handle circular buffer correctly', () => {
            const smallView = new ConsoleLogView({
                i18nService: mockI18nService,
                logger: { log: () => {} },
                maxMessages: 3,
            });

            smallView.addMessage('info', 'Msg 0');
            smallView.addMessage('info', 'Msg 1');
            smallView.addMessage('info', 'Msg 2');
            smallView.addMessage('info', 'Msg 3'); // Should overwrite Msg 0
            smallView.addMessage('info', 'Msg 4'); // Should overwrite Msg 1

            const messages = smallView.getMessages();
            assert.strictEqual(messages.length, 3);
            assert.strictEqual(messages[0].message, 'Msg 2');
            assert.strictEqual(messages[1].message, 'Msg 3');
            assert.strictEqual(messages[2].message, 'Msg 4');
        });
    });

    describe('registerMessageType()', () => {
        it('should register a new message type', () => {
            view.registerMessageType('custom', {
                className: 'msg-custom',
                icon: 'custom-icon',
            });

            assert.ok(view._messageTypes.custom);
            assert.strictEqual(view._messageTypes.custom.className, 'msg-custom');
            assert.strictEqual(view._messageTypes.custom.icon, 'custom-icon');
        });

        it('should use defaults for missing config values', () => {
            view.registerMessageType('minimal', {});

            assert.ok(view._messageTypes.minimal);
            // When no className provided, it defaults to 'msg-info' (fallback behavior)
            assert.ok(view._messageTypes.minimal.className);
            assert.ok(view._messageTypes.minimal.icon); // Should have default
        });
    });

    describe('setAutoScroll()', () => {
        it('should enable auto-scroll', () => {
            view._autoScroll = false;
            view.setAutoScroll(true);
            assert.strictEqual(view._autoScroll, true);
        });

        it('should disable auto-scroll', () => {
            view._autoScroll = true;
            view.setAutoScroll(false);
            assert.strictEqual(view._autoScroll, false);
        });
    });

    describe('serialization', () => {
        it('should serialize view state', () => {
            view.setAutoScroll(false);

            const serialized = view.serialize();

            assert.strictEqual(serialized.type, 'ConsoleLogView');
            assert.strictEqual(serialized.maxMessages, 1000);
            assert.strictEqual(serialized.autoScroll, false);
        });

        it('should not serialize message content', () => {
            view.addMessage('info', 'Test message 1');
            view.addMessage('error', 'Test message 2');

            const serialized = view.serialize();

            // Messages should not be in serialized data (they're transient)
            assert.strictEqual(serialized.messages, undefined);
        });

        it('should deserialize view state', () => {
            const data = {
                type: 'ConsoleLogView',
                maxMessages: 500,
                autoScroll: false,
            };

            view.deserialize(data);

            assert.strictEqual(view._maxMessages, 500);
            assert.strictEqual(view._autoScroll, false);
        });
    });

    describe('LogMessage class', () => {
        it('should create message with timestamp', () => {
            view.addMessage('info', 'Test');
            const messages = view.getMessages();

            assert.ok(messages[0].timestamp);
            assert.ok(typeof messages[0].timestamp === 'number');
            assert.ok(messages[0].timestamp > 0);
        });

        it('should convert message to string with timestamp', () => {
            view.addMessage('info', 'Test message');
            const messages = view.getMessages();
            const str = messages[0].toString();

            assert.ok(str.includes('info'));
            assert.ok(str.includes('Test message'));
        });

        it('should convert message to JSON', () => {
            view.addMessage('info', 'Test message');
            const messages = view.getMessages();
            const json = messages[0].toJSON();

            assert.strictEqual(json.type, 'info');
            assert.strictEqual(json.message, 'Test message');
            assert.ok(json.timestamp);
        });
    });

    describe('Icon Rendering', () => {
        it('should render otter messages with otter image icon', () => {
            view.addMessage('otter', '{"event":"wifi","state":"station-search"}');
            const message = view.getMessages()[0];
            const element = view._createMessageElement(message);

            const iconImage = element.querySelector('.console-message-icon-image');
            assert.ok(iconImage);
            assert.equal(iconImage.getAttribute('src'), IconProvider.get('otterHead64'));
        });

        it('should render JSON payload messages with summary and pretty JSON', () => {
            const payload = {
                ts_ms: 231004,
                event: 'startup',
                phase: 'ready',
                level: 'info',
                host_ip: '192.168.43.129',
                wifi_supported: true,
                wifi_enabled: true,
                message: 'Runtime startup finished',
            };
            view.addMessage('otter', JSON.stringify(payload));

            const message = view.getMessages()[0];
            const element = view._createMessageElement(message);

            const details = element.querySelector('.console-message-json-details');
            const summary = element.querySelector('.console-message-json-summary');
            const pretty = element.querySelector('.console-message-json-pretty');

            assert.ok(details);
            assert.equal(details.open, false);
            assert.ok(summary);
            assert.ok(summary.textContent.includes('startup/ready'));
            assert.ok(summary.textContent.includes('Runtime startup finished'));
            assert.ok(pretty);
            assert.ok(pretty.textContent.includes('"host_ip": "192.168.43.129"'));
            assert.ok(pretty.textContent.includes('\n'));
        });

        it('should keep non-JSON messages as plain text', () => {
            view.addMessage('info', 'plain message');

            const message = view.getMessages()[0];
            const element = view._createMessageElement(message);

            const plain = element.querySelector('.console-message-content');
            const pretty = element.querySelector('.console-message-json-pretty');

            assert.ok(plain);
            assert.equal(plain.textContent, 'plain message');
            assert.equal(pretty, null);
        });
    });
});
