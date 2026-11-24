// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isCompleteActiveTargetPayload } from '../../src/micro_otter/nodes/html/js/data/target-payload.js';

/**
 * Load one shipped device target file.
 * @param {string} fileName - File name below `src/micro_otter/nodes/device/targets/`.
 * @returns {unknown} Parsed JSON payload.
 */
function loadShippedTarget(fileName) {
    const url = new URL(
        `../../src/micro_otter/nodes/device/targets/${fileName}`,
        import.meta.url
    );
    return JSON.parse(readFileSync(url, 'utf8'));
}

describe('isCompleteActiveTargetPayload', () => {
    const completeWithPins = {
        targetId: 'esp32_s3',
        displayName: 'ESP32-S3',
        description: 'S3 target',
        configVersion: 1,
        pinCapabilities: { 2: { label: 'GPIO2', digital: { input: true, output: true } } },
    };

    const completeWithOpenPins = {
        targetId: 'generic_micropython',
        displayName: 'Generic',
        description: 'Open pin set',
        configVersion: 1,
        openPins: { min: 0, max: 255 },
    };

    const legacySkeleton = {
        targetId: 'esp32_s3_mini',
        displayName: 'ESP32-S3 Mini',
        description: 'Skeleton written by the old firmware bootstrap setup',
        configVersion: 1,
        capabilities: {},
    };

    const cases = [
        ['full payload', completeWithPins, true],
        ['open-pins-only payload', completeWithOpenPins, true],
        ['legacy five-key firmware skeleton', legacySkeleton, false],
        ['empty pin capability map', { ...completeWithPins, pinCapabilities: {} }, false],
        ['pinCapabilities is not an object', { ...completeWithPins, pinCapabilities: 3 }, false],
        ['blank target id', { ...completeWithPins, targetId: '   ' }, false],
        ['missing target id', { ...completeWithPins, targetId: undefined }, false],
        ['non-string target id', { ...completeWithPins, targetId: 42 }, false],
        ['unknown extra keys only', { capabilities: { digital: {} } }, false],
        ['stale capabilities key beside pin data', { ...completeWithPins, capabilities: {} }, true],
        ['openPins min greater than max', { ...completeWithOpenPins, openPins: { min: 9, max: 4 } }, false],
        ['openPins with infinite bound', { ...completeWithOpenPins, openPins: { min: 0, max: Infinity } }, false],
        ['openPins with string bounds', { ...completeWithOpenPins, openPins: { min: '0', max: '9' } }, false],
        ['openPins null', { ...completeWithOpenPins, openPins: null }, false],
        ['null payload', null, false],
        ['array payload', [], false],
        ['string payload', 'x', false],
        ['empty object', {}, false],
    ];

    for (const [name, payload, expected] of cases) {
        it(`returns ${expected} for ${name}`, () => {
            assert.equal(isCompleteActiveTargetPayload(payload), expected);
        });
    }

    it('accepts the shipped esp32_s3 target file (real pin capability map)', () => {
        assert.equal(isCompleteActiveTargetPayload(loadShippedTarget('esp32_s3.json')), true);
    });

    it('accepts the shipped generic_micropython target file (open pins only)', () => {
        assert.equal(
            isCompleteActiveTargetPayload(loadShippedTarget('generic_micropython.json')),
            true
        );
    });

    it('rejects a raw derived target file, which carries no pin data', () => {
        // `esp32_s3_mini.json` only declares `baseTargetId` and `targetData`
        // overrides. The predicate always runs on the resolved effective payload
        // (`getEffectiveTargetPayload`), so this documents why.
        assert.equal(isCompleteActiveTargetPayload(loadShippedTarget('esp32_s3_mini.json')), false);
    });
});
