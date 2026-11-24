// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Phase 2 Integration Tests - Logging System
 * Tests that ViewBase and data classes properly integrate with the logger.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../../src/micro_otter/nodes/html/js/core/log.js';

// Mock console methods to capture log output
let consoleOutput = [];
const originalConsoleLog = console.log;
const originalConsoleDebug = console.debug;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function mockConsole() {
    consoleOutput = [];
    console.log = (...args) => consoleOutput.push({ level: 'log', args });
    console.debug = (...args) => consoleOutput.push({ level: 'debug', args });
    console.info = (...args) => consoleOutput.push({ level: 'info', args });
    console.warn = (...args) => consoleOutput.push({ level: 'warn', args });
    console.error = (...args) => consoleOutput.push({ level: 'error', args });
}

function restoreConsole() {
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
}

describe('Phase 2: Logging Integration', () => {
    beforeEach(() => {
        // Reset logger state
        logger.setEnabled(false);
        logger.clear();
        mockConsole();
    });

    afterEach(() => {
        restoreConsole();
    });

    describe('ViewBase._log() integration', () => {
        it('logs with class name only (not context prefix)', async () => {
            // Import ViewBase dynamically to use mocked globalThis
            const { ViewBase } = await import('../../src/micro_otter/nodes/html/js/views/view-base.js');
            
            logger.setEnabled(true);
            logger.register('ViewBase', ['test-event']);

            const view = new ViewBase({ title: 'Test View' });
            view._log('test-event', 'info', { data: 'test' });

            assert.equal(consoleOutput.length, 1);
            assert.equal(consoleOutput[0].level, 'info');
            assert.equal(consoleOutput[0].args[0], '[ViewBase]');
            assert.equal(consoleOutput[0].args[1], 'test-event');
        });

        it('supports old signature without level parameter', async () => {
            const { ViewBase } = await import('../../src/micro_otter/nodes/html/js/views/view-base.js');
            
            logger.setEnabled(true);
            logger.register('ViewBase', ['old-style']);

            const view = new ViewBase({ title: 'Test View' });
            view._log('old-style', { some: 'data' }); // Old style: no level parameter

            assert.equal(consoleOutput.length, 1);
            assert.equal(consoleOutput[0].args[0], '[ViewBase]');
            assert.equal(consoleOutput[0].args[1], 'old-style');
        });
    });

    describe('NodeGraph._log() integration', () => {
        it('logs with NodeGraph class name', async () => {
            const { NodeGraph } = await import('../../src/micro_otter/nodes/html/js/data/node-graph.js');
            
            logger.setEnabled(true);
            logger.register('NodeGraph', ['node-added']);

            const graph = new NodeGraph({ id: 'test-graph' });
            graph._log('node-added', 'info', { nodeId: 'node-1' });

            assert.equal(consoleOutput.length, 1);
            assert.equal(consoleOutput[0].level, 'info');
            assert.equal(consoleOutput[0].args[0], '[NodeGraph]');
            assert.equal(consoleOutput[0].args[1], 'node-added');
        });
    });

    describe('Collection._log() integration', () => {
        it('logs with Collection class name', async () => {
            const { Collection } = await import('../../src/micro_otter/nodes/html/js/data/collection.js');
            
            // Clear any logs from constructor
            consoleOutput = [];
            
            logger.setEnabled(true);
            logger.register('Collection', ['graph-added']);

            // Collection requires an id (UUID v4)
            const collection = new Collection({ id: '12345678-1234-4234-8234-123456789012' });
            
            // Clear constructor logs
            consoleOutput = [];
            
            // Now test our logging
            collection._log('graph-added', 'info', { graphId: 'graph-2' });

            assert.equal(consoleOutput.length, 1);
            assert.equal(consoleOutput[0].level, 'info');
            assert.equal(consoleOutput[0].args[0], '[Collection]');
            assert.equal(consoleOutput[0].args[1], 'graph-added');
        });
    });

    // Workspace test skipped - requires complex DOM/IndexedDB mocking
    // Workspace._log() implementation verified via manual testing

    describe('I18nService._log() integration', () => {
        it('logs with I18nService class name', async () => {
            const { I18nService } = await import('../../src/micro_otter/nodes/html/js/i18n/i18n-service.js');
            
            logger.setEnabled(true);
            logger.register('I18nService', ['locale-changed']);

            const i18n = new I18nService();
            i18n._log('locale-changed', 'info', { locale: 'de' });

            assert.equal(consoleOutput.length, 1);
            assert.equal(consoleOutput[0].level, 'info');
            assert.equal(consoleOutput[0].args[0], '[I18nService]');
            assert.equal(consoleOutput[0].args[1], 'locale-changed');
        });
    });

    describe('Log level filtering', () => {
        it('respects minimum log level per class', async () => {
            const { ViewBase } = await import('../../src/micro_otter/nodes/html/js/views/view-base.js');
            
            logger.setEnabled(true);
            logger.register('ViewBase', null, 'warn'); // Only warn and error

            const view = new ViewBase({ title: 'Test View' });
            
            // Debug and info should be filtered out
            view._log('test-debug', 'debug', { data: 1 });
            view._log('test-info', 'info', { data: 2 });
            
            assert.equal(consoleOutput.length, 0);

            // Warn and error should pass through
            view._log('test-warn', 'warn', { data: 3 });
            view._log('test-error', 'error', { data: 4 });
            
            assert.equal(consoleOutput.length, 2);
            assert.equal(consoleOutput[0].level, 'warn');
            assert.equal(consoleOutput[1].level, 'error');
        });
    });

    describe('Specific reason filtering', () => {
        it('logs only specified reasons', async () => {
            const { NodeGraph } = await import('../../src/micro_otter/nodes/html/js/data/node-graph.js');
            
            logger.setEnabled(true);
            logger.register('NodeGraph', ['node-added', 'node-removed']); // Only these two

            const graph = new NodeGraph({ id: 'test-graph' });
            
            // These should be logged
            graph._log('node-added', 'info', { nodeId: 'node-1' });
            graph._log('node-removed', 'info', { nodeId: 'node-2' });
            
            // This should be filtered out (not in allowed reasons)
            graph._log('graph-changed', 'info', { change: 'something' });

            assert.equal(consoleOutput.length, 2);
            assert.equal(consoleOutput[0].args[1], 'node-added');
            assert.equal(consoleOutput[1].args[1], 'node-removed');
        });
    });

    describe('Master switch', () => {
        it('blocks all logging when disabled', async () => {
            const { ViewBase } = await import('../../src/micro_otter/nodes/html/js/views/view-base.js');
            
            logger.setEnabled(false); // Master switch off
            logger.register('ViewBase', ['test']);

            const view = new ViewBase({ title: 'Test View' });
            view._log('test', 'info', { data: 'test' });

            assert.equal(consoleOutput.length, 0);
        });
    });

    describe('Backward compatibility', () => {
        it('falls back to old logger when globalThis not available', async () => {
            // Temporarily remove globalThis.__microOtterLog
            const saved = globalThis.__microOtterLog;
            delete globalThis.__microOtterLog;

            try {
                const { ViewBase } = await import('../../src/micro_otter/nodes/html/js/views/view-base.js');
                
                let loggedMessage = null;
                const customLogger = (msg, level, data) => {
                    loggedMessage = { msg, level, data };
                };

                const view = new ViewBase({ title: 'Test View', logger: customLogger });
                view._log('test', 'info', { data: 'test' });

                assert.notEqual(loggedMessage, null);
                assert.match(loggedMessage.msg, /\[ViewBase:/);
                assert.match(loggedMessage.msg, /test/);
            } finally {
                // Restore
                globalThis.__microOtterLog = saved;
            }
        });
    });
});
