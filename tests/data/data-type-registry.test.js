// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { DataTypeRegistry } from '../../src/micro_otter/nodes/html/js/data/data-type-registry.js';

describe('DataTypeRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new DataTypeRegistry();
    });

    describe('Built-in types', () => {
        it('should register double type by default', () => {
            assert.equal(registry.has('double'), true);
            const doubleType = registry.get('double');
            assert.ok(doubleType);
            assert.ok(doubleType.name);
            assert.equal(doubleType.color, '#c4a63f');
        });

        it('should register int, float, bool, and any types by default', () => {
            assert.equal(registry.has('int'), true);
            assert.equal(registry.has('float'), true);
            assert.equal(registry.has('bool'), true);
            assert.equal(registry.has('any'), true);

            assert.equal(registry.get('int')?.color, '#e7c66b');
            assert.equal(registry.get('float')?.color, '#d8bf52');
            assert.equal(registry.get('bool')?.color, '#7ba3d6');
            assert.equal(registry.get('any')?.color, '#e3e3e3');
        });

        it('should register string type by default', () => {
            assert.equal(registry.has('string'), true);
            const stringType = registry.get('string');
            assert.ok(stringType);
            assert.ok(stringType.name);
            assert.equal(stringType.color, '#6fbf73');
        });

        it('should not allow removal of built-in types', () => {
            const removed = registry.remove('double');
            assert.equal(removed, false);
            assert.equal(registry.has('double'), true);
        });
    });

    describe('register()', () => {
        it('should register a custom type', () => {
            registry.register('rgbColor', {
                name: { en: 'RGB Color', de: 'RGB-Farbe' },
                description: { en: 'Red, Green, Blue color values', de: 'Rot-, Grün-, Blauwerte' },
                color: '#ff6b9e',
                icon: 'icons/color_24dp.svg',
            });

            assert.equal(registry.has('rgbColor'), true);
            const type = registry.get('rgbColor');
            assert.equal(type.name.en, 'RGB Color');
            assert.equal(type.color, '#ff6b9e');
        });

        it('should throw if typeId is not a string', () => {
            assert.throws(() => {
                registry.register(123, { name: 'Test' });
            }, TypeError);
        });

        it('should throw if typeId is empty', () => {
            assert.throws(() => {
                registry.register('', { name: 'Test' });
            }, TypeError);
        });

        it('should throw if typeId is whitespace only', () => {
            assert.throws(() => {
                registry.register('   ', { name: 'Test' });
            }, TypeError);
        });

        it('should throw if definition is not an object', () => {
            assert.throws(() => {
                registry.register('test', 'not an object');
            }, TypeError);
        });

        it('should throw if definition is null', () => {
            assert.throws(() => {
                registry.register('test', null);
            }, TypeError);
        });

        it('should throw if definition missing name property', () => {
            assert.throws(() => {
                registry.register('test', { color: '#123456' });
            }, Error);
        });

        it('should throw if type already registered', () => {
            registry.register('test', { name: 'Test' });
            assert.throws(() => {
                registry.register('test', { name: 'Test 2' });
            }, Error);
        });

        it('should trim whitespace from typeId', () => {
            registry.register('  vector3  ', { name: 'Vector' });
            assert.equal(registry.has('vector3'), true);
        });

        it('should use default color if not provided', () => {
            registry.register('test', { name: 'Test' });
            const type = registry.get('test');
            assert.equal(type.color, '#888888');
        });

        it('should set icon to null if not provided', () => {
            registry.register('test', { name: 'Test' });
            const type = registry.get('test');
            assert.equal(type.icon, null);
        });

        it('should apply default connection policy when not provided', () => {
            registry.register('test', { name: 'Test' });
            const type = registry.get('test');
            assert.deepEqual(type.connectionPolicy, {
                input: { maxConnections: 1 },
                output: { maxConnections: 0 },
            });
        });

        it("should default kind to 'value' when not provided", () => {
            registry.register('test', { name: 'Test' });
            const type = registry.get('test');
            assert.equal(type.kind, 'value');
        });

        it("should preserve explicit 'structure' kind", () => {
            registry.register('web.element', {
                name: 'Web Element',
                kind: 'structure',
            });

            const type = registry.get('web.element');
            assert.equal(type.kind, 'structure');
        });

        it("should normalize unsupported kind values to default 'value'", () => {
            registry.register('legacy', {
                name: 'Legacy',
                kind: 'unexpected-kind',
            });

            const type = registry.get('legacy');
            assert.equal(type.kind, 'value');
        });

        it('should preserve explicit connection policy values', () => {
            registry.register('web.element', {
                name: 'Web Element',
                connectionPolicy: {
                    input: { maxConnections: 1 },
                    output: { maxConnections: 1 },
                },
            });

            const type = registry.get('web.element');
            assert.deepEqual(type.connectionPolicy, {
                input: { maxConnections: 1 },
                output: { maxConnections: 1 },
            });
        });

        it('should emit type-registered event', () => {
            /** @type {import('../../src/micro_otter/nodes/html/js/core/app-event.js').AppEvent|null} */
            let emitted = null;
            registry.on('type-registered', (event) => {
                emitted = event;
            });
            registry.register('test', { name: 'Test' });
            assert.ok(emitted);
            assert.equal(emitted.name, 'type-registered');
            const validated = assertAppEventPayloadType(
                emitted,
                'DataTypeRegistry.TypeRegistered.v1',
                'DataTypeRegistry test listener'
            );
            assert.equal(validated.detail.typeId, 'test');
        });
    });

    describe('get()', () => {
        it('should return type definition', () => {
            registry.register('test', {
                name: 'Test',
                description: 'Test description',
                color: '#123456',
            });
            const type = registry.get('test');
            assert.equal(type.name, 'Test');
            assert.equal(type.description, 'Test description');
            assert.equal(type.color, '#123456');
        });

        it('should return null for non-existent type', () => {
            assert.equal(registry.get('nonexistent'), null);
        });
    });

    describe('has()', () => {
        it('should return true for registered type', () => {
            registry.register('test', { name: 'Test' });
            assert.equal(registry.has('test'), true);
        });

        it('should return false for non-existent type', () => {
            assert.equal(registry.has('nonexistent'), false);
        });
    });

    describe('getAll()', () => {
        it('should return all types including built-ins', () => {
            const types = registry.getAll();
            assert.ok(types.length >= 6); // int, float, double, bool, string, any
            assert.ok(types.some((t) => t.id === 'int'));
            assert.ok(types.some((t) => t.id === 'float'));
            assert.ok(types.some((t) => t.id === 'double'));
            assert.ok(types.some((t) => t.id === 'bool'));
            assert.ok(types.some((t) => t.id === 'string'));
            assert.ok(types.some((t) => t.id === 'any'));
        });

        it('should return custom types', () => {
            registry.register('test1', { name: 'Test 1' });
            registry.register('test2', { name: 'Test 2' });
            const types = registry.getAll();
            assert.ok(types.some((t) => t.id === 'test1'));
            assert.ok(types.some((t) => t.id === 'test2'));
        });

        it('should return array with id and definition', () => {
            registry.register('test', { name: 'Test', color: '#123456' });
            const types = registry.getAll();
            const testType = types.find((t) => t.id === 'test');
            assert.ok(testType);
            assert.equal(testType.definition.name, 'Test');
            assert.equal(testType.definition.color, '#123456');
        });
    });

    describe('clear()', () => {
        it('should remove all custom types', () => {
            registry.register('test1', { name: 'Test 1' });
            registry.register('test2', { name: 'Test 2' });
            registry.clear();
            assert.equal(registry.has('test1'), false);
            assert.equal(registry.has('test2'), false);
        });

        it('should preserve built-in types', () => {
            registry.register('test', { name: 'Test' });
            registry.clear();
            assert.equal(registry.has('int'), true);
            assert.equal(registry.has('float'), true);
            assert.equal(registry.has('double'), true);
            assert.equal(registry.has('bool'), true);
            assert.equal(registry.has('string'), true);
            assert.equal(registry.has('any'), true);
        });

        it('should emit types-cleared event', () => {
            /** @type {import('../../src/micro_otter/nodes/html/js/core/app-event.js').AppEvent|null} */
            let emitted = null;
            registry.on('types-cleared', (event) => {
                emitted = event;
            });
            registry.clear();
            assert.ok(emitted);
            assert.equal(emitted.name, 'types-cleared');
            assertAppEventPayloadType(
                emitted,
                'DataTypeRegistry.TypesCleared.v1',
                'DataTypeRegistry test listener'
            );
        });
    });

    describe('remove()', () => {
        it('should remove custom type', () => {
            registry.register('test', { name: 'Test' });
            const removed = registry.remove('test');
            assert.equal(removed, true);
            assert.equal(registry.has('test'), false);
        });

        it('should return false for non-existent type', () => {
            const removed = registry.remove('nonexistent');
            assert.equal(removed, false);
        });

        it('should not remove built-in types', () => {
            const removed1 = registry.remove('double');
            const removed2 = registry.remove('int');
            const removed3 = registry.remove('float');
            const removed4 = registry.remove('bool');
            const removed5 = registry.remove('string');
            const removed6 = registry.remove('any');
            assert.equal(removed1, false);
            assert.equal(removed2, false);
            assert.equal(removed3, false);
            assert.equal(removed4, false);
            assert.equal(removed5, false);
            assert.equal(removed6, false);
            assert.equal(registry.has('double'), true);
            assert.equal(registry.has('int'), true);
            assert.equal(registry.has('float'), true);
            assert.equal(registry.has('bool'), true);
            assert.equal(registry.has('string'), true);
            assert.equal(registry.has('any'), true);
        });

        it('should emit type-removed event', () => {
            registry.register('test', { name: 'Test' });
            /** @type {import('../../src/micro_otter/nodes/html/js/core/app-event.js').AppEvent|null} */
            let emitted = null;
            registry.on('type-removed', (event) => {
                emitted = event;
            });
            registry.remove('test');
            assert.ok(emitted);
            assert.equal(emitted.name, 'type-removed');
            const validated = assertAppEventPayloadType(
                emitted,
                'DataTypeRegistry.TypeRemoved.v1',
                'DataTypeRegistry test listener'
            );
            assert.equal(validated.detail.typeId, 'test');
        });
    });
});
