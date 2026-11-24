// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger, logEnabled, log, createLogger } from '../../src/micro_otter/nodes/html/js/core/log.js';

describe('log.js - Simplified Singleton Logger', () => {
    beforeEach(() => {
        // Clear logger state before each test
        logger.clear();
        logger.setEnabled(false);
    });

    describe('Logger singleton', () => {
        it('has expected properties', () => {
            assert.ok(logger.enabled !== undefined);
            assert.ok(logger.classes instanceof Set);
            assert.ok(logger.classReasons instanceof Map);
            assert.ok(logger.classLevels instanceof Map);
        });

        it('starts with logging disabled', () => {
            assert.equal(logger.enabled, false);
        });

        it('starts with empty registrations', () => {
            assert.equal(logger.classes.size, 0);
            assert.equal(logger.classReasons.size, 0);
            assert.equal(logger.classLevels.size, 0);
        });
    });

    describe('logger.setEnabled()', () => {
        it('enables logging', () => {
            logger.setEnabled(true);
            assert.equal(logger.enabled, true);
        });

        it('disables logging', () => {
            logger.setEnabled(true);
            logger.setEnabled(false);
            assert.equal(logger.enabled, false);
        });
    });

    describe('logger.register()', () => {
        it('registers a class name', () => {
            logger.register('SplitView');
            assert.equal(logger.classes.has('SplitView'), true);
        });

        it('registers multiple class names', () => {
            logger.register('SplitView');
            logger.register('TabbedView');
            assert.equal(logger.classes.size, 2);
            assert.equal(logger.classes.has('SplitView'), true);
            assert.equal(logger.classes.has('TabbedView'), true);
        });

        it('registers class with specific reasons', () => {
            logger.register('SplitView', ['attach', 'detach']);
            assert.equal(logger.classReasons.has('SplitView'), true);
            const reasons = logger.classReasons.get('SplitView');
            assert.equal(reasons.has('attach'), true);
            assert.equal(reasons.has('detach'), true);
            assert.equal(reasons.has('render'), false);
        });

        it('registers class with minimum log level', () => {
            logger.register('SplitView', null, 'warn');
            assert.equal(logger.classLevels.get('SplitView'), 'warn');
        });

        it('registers class with reasons and level', () => {
            logger.register('SplitView', ['attach'], 'error');
            assert.equal(logger.classes.has('SplitView'), true);
            assert.equal(logger.classReasons.get('SplitView').has('attach'), true);
            assert.equal(logger.classLevels.get('SplitView'), 'error');
        });
    });

    describe('logger.unregister()', () => {
        it('removes class registration', () => {
            logger.register('SplitView', ['attach'], 'warn');
            logger.unregister('SplitView');
            assert.equal(logger.classes.has('SplitView'), false);
            assert.equal(logger.classReasons.has('SplitView'), false);
            assert.equal(logger.classLevels.has('SplitView'), false);
        });
    });

    describe('logger.clear()', () => {
        it('removes all registrations', () => {
            logger.register('SplitView', ['attach'], 'warn');
            logger.register('TabbedView', ['render']);
            logger.clear();
            assert.equal(logger.classes.size, 0);
            assert.equal(logger.classReasons.size, 0);
            assert.equal(logger.classLevels.size, 0);
        });
    });

    describe('logger.isEnabled()', () => {
        it('returns false when master switch is off', () => {
            logger.setEnabled(false);
            logger.register('SplitView');
            assert.equal(logger.isEnabled('SplitView', 'attach'), false);
        });

        it('returns false when no classes registered', () => {
            logger.setEnabled(true);
            assert.equal(logger.isEnabled('SplitView', 'attach'), false);
        });

        it('returns false when class not registered', () => {
            logger.setEnabled(true);
            logger.register('TabbedView');
            assert.equal(logger.isEnabled('SplitView', 'attach'), false);
        });

        it('returns true when class registered', () => {
            logger.setEnabled(true);
            logger.register('SplitView');
            assert.equal(logger.isEnabled('SplitView', 'attach'), true);
        });

        it('respects specific reasons', () => {
            logger.setEnabled(true);
            logger.register('SplitView', ['attach', 'detach']);
            assert.equal(logger.isEnabled('SplitView', 'attach'), true);
            assert.equal(logger.isEnabled('SplitView', 'detach'), true);
            assert.equal(logger.isEnabled('SplitView', 'render'), false);
        });

        it('respects minimum log level - default', () => {
            logger.setEnabled(true);
            logger.register('SplitView');
            assert.equal(logger.isEnabled('SplitView', 'test', 'debug'), true);
            assert.equal(logger.isEnabled('SplitView', 'test', 'info'), true);
            assert.equal(logger.isEnabled('SplitView', 'test', 'warn'), true);
            assert.equal(logger.isEnabled('SplitView', 'test', 'error'), true);
        });

        it('respects minimum log level - custom', () => {
            logger.setEnabled(true);
            logger.register('SplitView', null, 'warn');
            assert.equal(logger.isEnabled('SplitView', 'test', 'debug'), false);
            assert.equal(logger.isEnabled('SplitView', 'test', 'info'), false);
            assert.equal(logger.isEnabled('SplitView', 'test', 'warn'), true);
            assert.equal(logger.isEnabled('SplitView', 'test', 'error'), true);
        });

        it('combines reason filtering and level checking', () => {
            logger.setEnabled(true);
            logger.register('SplitView', ['attach'], 'warn');
            assert.equal(logger.isEnabled('SplitView', 'attach', 'debug'), false);
            assert.equal(logger.isEnabled('SplitView', 'attach', 'warn'), true);
            assert.equal(logger.isEnabled('SplitView', 'detach', 'warn'), false);
        });
    });

    describe('logEnabled() convenience function', () => {
        it('delegates to logger.isEnabled()', () => {
            logger.setEnabled(true);
            logger.register('SplitView');
            assert.equal(logEnabled('SplitView', 'attach'), true);
            assert.equal(logEnabled('TabbedView', 'attach'), false);
        });
    });

    describe('log() function', () => {
        let consoleCalls = [];
        let originalMethods = {};

        beforeEach(() => {
            // Mock console methods
            consoleCalls = [];
            ['debug', 'info', 'warn', 'error', 'log'].forEach(method => {
                originalMethods[method] = console[method];
                console[method] = (...args) => {
                    consoleCalls.push({ method, args });
                };
            });
        });

        afterEach(() => {
            // Restore console methods
            Object.assign(console, originalMethods);
        });

        it('does not log when disabled', () => {
            logger.setEnabled(false);
            log('SplitView', 'attach', 'info', { data: 'test' });
            assert.equal(consoleCalls.length, 0);
        });

        it('does not log when class not registered', () => {
            logger.setEnabled(true);
            log('SplitView', 'attach', 'info', { data: 'test' });
            assert.equal(consoleCalls.length, 0);
        });

        it('logs when class is registered', () => {
            logger.setEnabled(true);
            logger.register('SplitView');
            log('SplitView', 'attach', 'info', { data: 'test' });

            assert.equal(consoleCalls.length, 1);
            assert.equal(consoleCalls[0].method, 'info');
            assert.deepEqual(consoleCalls[0].args, [
                '[SplitView]',
                'attach',
                { data: 'test' }
            ]);
        });

        it('uses correct console method based on level', () => {
            logger.setEnabled(true);
            logger.register('SplitView');

            log('SplitView', 'test', 'debug');
            log('SplitView', 'test', 'info');
            log('SplitView', 'test', 'warn');
            log('SplitView', 'test', 'error');

            assert.equal(consoleCalls.length, 4);
            assert.equal(consoleCalls[0].method, 'debug');
            assert.equal(consoleCalls[1].method, 'info');
            assert.equal(consoleCalls[2].method, 'warn');
            assert.equal(consoleCalls[3].method, 'error');
        });
    });

    describe('createLogger()', () => {
        let consoleCalls = [];
        let originalMethods = {};

        beforeEach(() => {
            // Mock console methods
            consoleCalls = [];
            ['debug', 'info', 'warn', 'error', 'log'].forEach(method => {
                originalMethods[method] = console[method];
                console[method] = (...args) => {
                    consoleCalls.push({ method, args });
                };
            });

            logger.setEnabled(true);
            logger.register('SplitView');
        });

        afterEach(() => {
            // Restore console methods
            Object.assign(console, originalMethods);
        });

        it('creates a bound logging function', () => {
            const logFn = createLogger('SplitView');
            logFn('attach', 'info', { container: 'test' });

            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args, [
                '[SplitView]',
                'attach',
                { container: 'test' }
            ]);
        });

        it('appends instance ID to class name', () => {
            logger.register('SplitView:instance-1');
            const logFn = createLogger('SplitView', 'instance-1');
            logFn('render', 'debug');

            assert.equal(consoleCalls.length, 1);
            assert.equal(consoleCalls[0].args[0], '[SplitView:instance-1]');
        });

        it('supports function for dynamic instance ID', () => {
            let instanceCounter = 1;
            const getId = () => `dynamic-${instanceCounter++}`;

            logger.register('SplitView:dynamic-1');
            logger.register('SplitView:dynamic-2');

            const logFn = createLogger('SplitView', getId);

            logFn('attach', 'info');
            logFn('detach', 'info');

            assert.equal(consoleCalls.length, 2);
            assert.equal(consoleCalls[0].args[0], '[SplitView:dynamic-1]');
            assert.equal(consoleCalls[1].args[0], '[SplitView:dynamic-2]');
        });
    });

    describe('Lazy evaluation', () => {
        let originalMethods;
        let consoleCalls;

        beforeEach(() => {
            logger.setEnabled(true);
            logger.register('TestClass');

            // Capture console calls
            originalMethods = {
                log: console.log,
                debug: console.debug,
                info: console.info,
                warn: console.warn,
                error: console.error,
            };

            consoleCalls = [];
            const capture = (method) => (...args) => {
                consoleCalls.push({ method, args });
            };

            console.log = capture('log');
            console.debug = capture('debug');
            console.info = capture('info');
            console.warn = capture('warn');
            console.error = capture('error');
        });

        afterEach(() => {
            // Restore console methods
            Object.assign(console, originalMethods);
            logger.clear();
        });

        it('evaluates functions when logging is enabled', () => {
            let called = false;
            const lazyData = () => {
                called = true;
                return { value: 42 };
            };

            logger.log('TestClass', 'test', 'debug', lazyData);
            
            assert.equal(called, true, 'Lazy function should be called');
            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args, ['[TestClass]', 'test', { value: 42 }]);
        });

        it('does not evaluate functions when logging is disabled', () => {
            logger.setEnabled(false);
            
            let called = false;
            const lazyData = () => {
                called = true;
                return { value: 42 };
            };

            logger.log('TestClass', 'test', 'debug', lazyData);
            
            assert.equal(called, false, 'Lazy function should not be called');
            assert.equal(consoleCalls.length, 0);
        });

        it('does not evaluate functions when class not registered', () => {
            logger.clear();
            logger.setEnabled(true);
            
            let called = false;
            const lazyData = () => {
                called = true;
                return { value: 42 };
            };

            logger.log('UnregisteredClass', 'test', 'debug', lazyData);
            
            assert.equal(called, false, 'Lazy function should not be called for unregistered class');
            assert.equal(consoleCalls.length, 0);
        });

        it('evaluates multiple lazy functions', () => {
            const lazy1 = () => ({ a: 1 });
            const lazy2 = () => ({ b: 2 });

            logger.log('TestClass', 'test', 'debug', lazy1, 'simple', lazy2);
            
            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args, [
                '[TestClass]',
                'test',
                { a: 1 },
                'simple',
                { b: 2 }
            ]);
        });

        it('mixes lazy functions with simple values', () => {
            const lazyData = () => ({ computed: 'value' });

            logger.log('TestClass', 'test', 'info', 'before', lazyData, 'after', 123);
            
            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args, [
                '[TestClass]',
                'test',
                'before',
                { computed: 'value' },
                'after',
                123
            ]);
        });

        it('works with log() convenience function', () => {
            let called = false;
            const lazyData = () => {
                called = true;
                return { lazy: true };
            };

            log('TestClass', 'test', 'debug', lazyData);
            
            assert.equal(called, true);
            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args[2], { lazy: true });
        });

        it('works with createLogger()', () => {
            const logFn = createLogger('TestClass');
            let called = false;
            const lazyData = () => {
                called = true;
                return { from: 'createLogger' };
            };

            logFn('test', 'debug', lazyData);
            
            assert.equal(called, true);
            assert.equal(consoleCalls.length, 1);
            assert.deepEqual(consoleCalls[0].args[2], { from: 'createLogger' });
        });
    });

    describe('globalThis exposure', () => {
        it('exposes logging API on globalThis', () => {
            assert.ok(globalThis.__microOtterLog);
            assert.ok(globalThis.__microOtterLog.logger);
            assert.equal(typeof globalThis.__microOtterLog.logEnabled, 'function');
            assert.equal(typeof globalThis.__microOtterLog.log, 'function');
            assert.equal(typeof globalThis.__microOtterLog.createLogger, 'function');
        });

        it('globalThis.logger is the singleton', () => {
            assert.equal(globalThis.__microOtterLog.logger, logger);
        });

        it('globalThis.logEnabled is exported function', () => {
            assert.equal(globalThis.__microOtterLog.logEnabled, logEnabled);
        });

        it('globalThis.log is exported function', () => {
            assert.equal(globalThis.__microOtterLog.log, log);
        });

        it('globalThis.createLogger is exported function', () => {
            assert.equal(globalThis.__microOtterLog.createLogger, createLogger);
        });
    });
});
