// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isTargetCompatibleWithImage } from '../../src/micro_otter/nodes/html/js/data/target-compatibility.js';

function resolver() {
    return {
        getTargetBuildBaseId: (id) => (id === 'esp32_s3_mini' ? 'esp32_s3' : id),
        getCompileTarget: (id) =>
            id === 'esp32_s3' || id === 'esp32_s3_mini'
                ? { board: 'ESP32_GENERIC_S3', port: 'esp32' }
                : null,
    };
}

describe('isTargetCompatibleWithImage', () => {
    it('matches on the recorded build base id', () => {
        assert.equal(
            isTargetCompatibleWithImage('esp32_s3', { buildBaseTargetId: 'esp32_s3' }, resolver()),
            true
        );
        assert.equal(
            isTargetCompatibleWithImage('esp32_s3_mini', { buildBaseTargetId: 'esp32_s3' }, resolver()),
            true
        );
        assert.equal(
            isTargetCompatibleWithImage('esp32_wroom', { buildBaseTargetId: 'esp32_s3' }, resolver()),
            false
        );
    });

    it('expands a legacy allowed list through the resolver', () => {
        assert.equal(
            isTargetCompatibleWithImage('esp32_s3_mini', { allowedWebTargetIds: ['esp32_s3_mini'] }, resolver()),
            true
        );
        assert.equal(
            isTargetCompatibleWithImage('esp32_s3', { allowedWebTargetIds: ['esp32_s3_mini'] }, resolver()),
            true
        );
        assert.equal(
            isTargetCompatibleWithImage('esp32_wroom', { allowedWebTargetIds: ['esp32_s3_mini'] }, resolver()),
            false
        );
    });

    it('falls back to board comparison when neither field is set', () => {
        assert.equal(
            isTargetCompatibleWithImage('esp32_s3_mini', { compileBoard: 'ESP32_GENERIC_S3' }, resolver()),
            true
        );
        assert.equal(
            isTargetCompatibleWithImage('esp32_wroom', { compileBoard: 'ESP32_GENERIC_S3' }, resolver()),
            false
        );
    });

    it('allows when the image records no compatibility metadata', () => {
        assert.equal(isTargetCompatibleWithImage('esp32_wroom', {}, resolver()), true);
    });
});
