import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    BOOTSTRAP_SETUP_SCHEMA_VERSION,
    BOOTSTRAP_SETUP_REQUIRED_PATHS,
    BOOTSTRAP_SETUP_ACTION_RESULTS,
    BOOTSTRAP_SETUP_ERROR_CATEGORIES,
    normalizeBootstrapSetupStatusPayload,
    normalizeBootstrapSetupApplyPayload,
} from '../../src/micro_otter/nodes/html/js/deployment/bootstrap-setup-contract.js';

describe('bootstrap setup contract', () => {
    it('freezes schema constants and vocabularies', () => {
        assert.equal(BOOTSTRAP_SETUP_SCHEMA_VERSION, 1);
        assert.deepEqual(BOOTSTRAP_SETUP_REQUIRED_PATHS, [
            '/manifest.json',
            '/device.json',
            '/app/main_loop.py',
        ]);
        assert.deepEqual(BOOTSTRAP_SETUP_ACTION_RESULTS, [
            'created',
            'updated',
            'unchanged',
            'error',
        ]);
        assert.deepEqual(BOOTSTRAP_SETUP_ERROR_CATEGORIES, [
            'validation',
            'filesystem',
            'runtime',
            'unsupported',
            'internal',
        ]);
    });

    it('normalizes a valid setup status payload', () => {
        const payload = {
            schemaVersion: 1,
            ready: false,
            files: [
                { path: '/manifest.json', exists: true, valid: true },
                { path: '/device.json', exists: false, valid: false, reason: 'missing' },
            ],
            missingOrInvalid: [{ path: '/device.json', reason: 'missing' }],
            errors: [
                { category: 'validation', message: 'device schema invalid', path: '/device.json' },
            ],
        };

        const normalized = normalizeBootstrapSetupStatusPayload(payload);
        assert.ok(normalized);
        assert.equal(normalized.ready, false);
        assert.equal(normalized.files.length, 2);
        assert.equal(normalized.errors[0].category, 'validation');
    });

    it('accepts status rows for three paths and for old firmware with a fourth target row', () => {
        const threePathStatus = {
            schemaVersion: 1,
            ready: true,
            files: BOOTSTRAP_SETUP_REQUIRED_PATHS.map((path) => ({
                path,
                exists: true,
                valid: true,
                reason: null,
            })),
            missingOrInvalid: [],
            errors: [],
        };

        const normalizedThree = normalizeBootstrapSetupStatusPayload(threePathStatus);
        assert.ok(normalizedThree);
        assert.equal(normalizedThree.files.length, 3);

        const legacyRow = {
            path: '/device/targets/active_target.json',
            exists: true,
            valid: true,
            reason: null,
        };
        const normalizedFour = normalizeBootstrapSetupStatusPayload({
            ...threePathStatus,
            files: [...threePathStatus.files, legacyRow],
        });
        assert.ok(normalizedFour);
        assert.equal(normalizedFour.files.length, 4);
        assert.equal(normalizedFour.files[3].path, '/device/targets/active_target.json');
    });

    it('rejects malformed setup status payloads', () => {
        assert.equal(normalizeBootstrapSetupStatusPayload(null), null);
        assert.equal(
            normalizeBootstrapSetupStatusPayload({ schemaVersion: 1, ready: true, files: [] }),
            null
        );
        assert.equal(
            normalizeBootstrapSetupStatusPayload({
                schemaVersion: 1,
                ready: true,
                files: [{ path: '/manifest.json', exists: 'yes', valid: true }],
                missingOrInvalid: [],
                errors: [],
            }),
            null
        );
    });

    it('normalizes a valid setup apply payload', () => {
        const payload = {
            schemaVersion: 1,
            ok: true,
            results: [
                { path: '/manifest.json', action: 'created' },
                { path: '/device.json', action: 'unchanged' },
            ],
            errors: [],
        };

        const normalized = normalizeBootstrapSetupApplyPayload(payload);
        assert.ok(normalized);
        assert.equal(normalized.ok, true);
        assert.deepEqual(
            normalized.results.map((entry) => entry.action),
            ['created', 'unchanged']
        );
    });

    it('rejects malformed setup apply payloads', () => {
        assert.equal(
            normalizeBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: true,
                results: [{ path: '/manifest.json', action: 'write' }],
                errors: [],
            }),
            null
        );

        assert.equal(
            normalizeBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: false,
                results: [],
                errors: [{ category: 'unknown', message: 'bad' }],
            }),
            null
        );
    });
});
