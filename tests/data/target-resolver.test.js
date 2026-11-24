// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import TargetResolver from '../../src/micro_otter/nodes/html/js/data/target-resolver.js';

const S3_BASE = {
    targetId: 'esp32_s3',
    displayName: 'ESP32-S3',
    description: 'Chip-level S3',
    metadata: { notes: ['base note'] },
    pinCapabilities: {
        1: { label: 'GPIO1', digital: { input: true, output: true } },
        2: { label: 'GPIO2', digital: { input: true, output: true } },
    },
    generalCapabilities: { viper: { supported: true } },
};

describe('TargetResolver', () => {
    it('resolves a derived shipped target to its terminal base', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'esp32_s3', payload: S3_BASE },
            {
                id: 'esp32_s3_mini',
                payload: {
                    targetId: 'esp32_s3_mini',
                    displayName: 'ESP32-S3 Mini',
                    description: 'Mini board',
                    baseTargetId: 'esp32_s3',
                    targetData: {
                        metadata: { notes: ['mini note'] },
                        pinCapabilities: { 2: null },
                    },
                },
            },
        ]);

        const resolved = resolver.resolve('esp32_s3_mini');
        assert.ok(resolved);
        assert.equal(resolved.buildBaseId, 'esp32_s3');
        assert.deepEqual(resolved.chain, ['esp32_s3_mini', 'esp32_s3']);
        assert.equal(resolved.payload.targetId, 'esp32_s3_mini');
        assert.equal(resolved.payload.displayName, 'ESP32-S3 Mini');
        assert.equal(resolved.payload.description, 'Mini board');
        assert.equal(resolved.payload.pinCapabilities[1].label, 'GPIO1');
        assert.equal(resolved.payload.pinCapabilities[2], undefined);
        assert.deepEqual(resolved.payload.metadata.notes, ['base note', 'mini note']);
    });

    it('walks a multi-level shipped chain', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'a', payload: { targetId: 'a', pinCapabilities: { 1: { label: 'A1' } } } },
            {
                id: 'b',
                payload: { targetId: 'b', baseTargetId: 'a', targetData: { displayName: 'B' } },
            },
            {
                id: 'c',
                payload: {
                    targetId: 'c',
                    baseTargetId: 'b',
                    targetData: { description: 'C derived' },
                },
            },
        ]);

        const resolved = resolver.resolve('c');
        assert.ok(resolved);
        assert.equal(resolved.buildBaseId, 'a');
        assert.deepEqual(resolved.chain, ['c', 'b', 'a']);
        assert.equal(resolved.payload.pinCapabilities[1].label, 'A1');
    });

    it('resolves a user target onto a shipped base', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([{ id: 'esp32_s3', payload: S3_BASE }]);
        resolver.setUserTargets([
            {
                id: 'my_s3',
                displayName: 'My S3',
                version: '1.0.0',
                source: 'user',
                created: '2026-11-14',
                baseTargetId: 'esp32_s3',
                targetData: { id: 'my_s3', targetId: 'my_s3', pinCapabilities: { 1: null } },
            },
        ]);

        const resolved = resolver.resolve('my_s3');
        assert.ok(resolved);
        assert.equal(resolved.buildBaseId, 'esp32_s3');
        assert.equal(resolved.payload.targetId, 'my_s3');
        assert.equal(resolved.payload.displayName, 'My S3');
        assert.equal(resolved.payload.pinCapabilities[1], undefined);
        assert.equal(resolved.payload.pinCapabilities[2].label, 'GPIO2');
    });

    it('returns null for an unknown leaf id', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([{ id: 'esp32_s3', payload: S3_BASE }]);
        assert.equal(resolver.resolve('unknown'), null);
        assert.equal(resolver.resolveBuildBaseId('unknown'), null);
    });

    it('throws ERR_TARGET_BASE_UNKNOWN for an unknown base', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'a', payload: { targetId: 'a', baseTargetId: 'nope', targetData: {} } },
        ]);
        assert.throws(
            () => resolver.resolve('a'),
            (error) => error.code === 'ERR_TARGET_BASE_UNKNOWN'
        );
    });

    it('throws ERR_TARGET_CYCLE on a base cycle', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'a', payload: { targetId: 'a', baseTargetId: 'b', targetData: {} } },
            { id: 'b', payload: { targetId: 'b', baseTargetId: 'a', targetData: {} } },
        ]);
        assert.throws(() => resolver.resolve('a'), (error) => error.code === 'ERR_TARGET_CYCLE');
    });

    it('throws ERR_TARGET_CHAIN_LIMIT past eight hops', () => {
        const resolver = new TargetResolver();
        const entries = [];
        for (let index = 0; index < 10; index += 1) {
            entries.push({
                id: `t${index}`,
                payload: {
                    targetId: `t${index}`,
                    baseTargetId: index > 0 ? `t${index - 1}` : null,
                    targetData: index > 0 ? {} : undefined,
                },
            });
        }
        resolver.setShippedTargets(entries);
        assert.throws(
            () => resolver.resolve('t9'),
            (error) => error.code === 'ERR_TARGET_CHAIN_LIMIT'
        );
    });

    it('throws ERR_TARGET_OPEN_PINS_OVERRIDE on a duplicate openPins', () => {
        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'base', payload: { targetId: 'base', openPins: { min: 0, max: 255 } } },
            {
                id: 'derived',
                payload: {
                    targetId: 'derived',
                    baseTargetId: 'base',
                    targetData: { openPins: { min: 0, max: 10 } },
                },
            },
        ]);
        assert.throws(
            () => resolver.resolve('derived'),
            (error) => error.code === 'ERR_TARGET_OPEN_PINS_OVERRIDE'
        );
    });
});

