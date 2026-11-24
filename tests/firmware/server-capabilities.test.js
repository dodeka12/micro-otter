// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ServerCapabilitiesStore,
    normalizeCapabilitiesPayload,
    probeServerCapabilities,
} from '../../src/micro_otter/nodes/html/js/firmware/server-capabilities.js';

const VALID_PAYLOAD = {
    serverType: 'micro-otter',
    version: '1.2.3',
    features: ['serial-bridge', 'local-package-scan', 'firmware-compile'],
    buildBackends: [
        { id: 'esp-idf', available: true, version: '5.4', reason: '/opt/esp-idf', targets: ['esp32'] },
    ],
    flashBackends: [
        { id: 'esptool', available: true, version: '4.8', reason: null, targets: ['esp32', 'esp32s3'] },
    ],
    firmwareSources: ['local'],
    releaseIndexUrl: '',
};

function okResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function errorResponse(status) {
    return { ok: false, status, json: async () => ({}) };
}

describe('probeServerCapabilities', () => {
    it('maps a valid payload to ready', async () => {
        const result = await probeServerCapabilities({
            fetchImpl: async () => okResponse(VALID_PAYLOAD),
        });
        assert.equal(result.state, 'ready');
        assert.equal(result.capabilities.serverType, 'micro-otter');
        assert.deepEqual(result.capabilities.features, VALID_PAYLOAD.features);
    });

    it('maps a 404 to unreachable with an HTTP detail', async () => {
        const result = await probeServerCapabilities({
            fetchImpl: async () => errorResponse(404),
        });
        assert.equal(result.state, 'unavailable');
        assert.equal(result.reason, 'unreachable');
        assert.equal(result.detail, 'HTTP 404');
    });

    it('maps a thrown fetch error to unreachable', async () => {
        const result = await probeServerCapabilities({
            fetchImpl: async () => {
                throw new TypeError('fetch failed');
            },
        });
        assert.equal(result.state, 'unavailable');
        assert.equal(result.reason, 'unreachable');
    });

    it('maps a timeout to unreachable', async () => {
        const result = await probeServerCapabilities({
            fetchImpl: (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
                }),
            timeoutMs: 5,
        });
        assert.equal(result.state, 'unavailable');
        assert.equal(result.reason, 'unreachable');
    });
});

describe('normalizeCapabilitiesPayload', () => {
    it('rejects invalid JSON as malformed', () => {
        const result = normalizeCapabilitiesPayload(null);
        assert.equal(result.state, 'unavailable');
        assert.equal(result.reason, 'malformed');
    });

    it('rejects a missing serverType as malformed', () => {
        const result = normalizeCapabilitiesPayload({ features: [] });
        assert.equal(result.reason, 'malformed');
    });

    it('rejects a non-array features as malformed', () => {
        const result = normalizeCapabilitiesPayload({ serverType: 'micro-otter', features: {} });
        assert.equal(result.reason, 'malformed');
    });

    it('rejects a foreign serverType as not-micro-otter', () => {
        const result = normalizeCapabilitiesPayload({ serverType: 'other', features: [] });
        assert.equal(result.reason, 'not-micro-otter');
    });

    it('keeps unknown keys working', () => {
        const result = normalizeCapabilitiesPayload({ ...VALID_PAYLOAD, extraKey: 42 });
        assert.equal(result.state, 'ready');
    });

    it('normalises a payload containing local-file-access', () => {
        const result = normalizeCapabilitiesPayload({
            ...VALID_PAYLOAD,
            features: [...VALID_PAYLOAD.features, 'local-file-access'],
        });
        assert.equal(result.state, 'ready');
        assert.ok(result.capabilities.features.includes('local-file-access'));
    });

    it('keeps a payload without local-file-access absent', () => {
        const result = normalizeCapabilitiesPayload(VALID_PAYLOAD);
        assert.equal(result.capabilities.features.includes('local-file-access'), false);
    });
});

describe('ServerCapabilitiesStore', () => {
    it('shares one fetch between concurrent refreshes', async () => {
        let calls = 0;
        const store = new ServerCapabilitiesStore();
        const fetchImpl = async () => {
            calls += 1;
            return okResponse(VALID_PAYLOAD);
        };
        const [a, b] = await Promise.all([
            store.refresh({ fetchImpl }),
            store.refresh({ fetchImpl }),
        ]);
        assert.equal(a.state, 'ready');
        assert.equal(b.state, 'ready');
        assert.equal(calls, 1);
    });

    it('does not refetch within the TTL unless forced', async () => {
        let calls = 0;
        const store = new ServerCapabilitiesStore();
        const fetchImpl = async () => {
            calls += 1;
            return okResponse(VALID_PAYLOAD);
        };
        await store.refresh({ fetchImpl });
        await store.refresh({ fetchImpl });
        assert.equal(calls, 1);
        await store.refresh({ fetchImpl, force: true });
        assert.equal(calls, 2);
    });

    it('subscribes and unsubscribes listeners', async () => {
        const store = new ServerCapabilitiesStore();
        let fired = 0;
        const unsubscribe = store.subscribe(() => {
            fired += 1;
        });
        await store.refresh({ fetchImpl: async () => okResponse(VALID_PAYLOAD) });
        assert.equal(fired, 1);
        unsubscribe();
        await store.refresh({ fetchImpl: async () => okResponse(VALID_PAYLOAD), force: true });
        assert.equal(fired, 1);
    });
});
