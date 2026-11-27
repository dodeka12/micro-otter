// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Contract for the hosted build flag. `vite.config.js` `define` injects two globals; only the
// boolean `true` switches modes, and the app-meta cases pin the one request a hosted bundle must
// never make.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    isHostedBuild,
    getHostedDocsUrl,
} from '../../src/micro_otter/nodes/html/js/core/build-mode.js';
import { resolveAppVersion } from '../../src/micro_otter/nodes/html/js/core/app-meta.js';

const originalFetch = globalThis.fetch;

/** Restore the injected globals and `fetch` so one case cannot leak into the next. */
afterEach(() => {
    delete globalThis.__MICRO_OTTER_HOSTED__;
    delete globalThis.__MICRO_OTTER_DOCS_URL__;
    delete globalThis.__MICRO_OTTER_APP_VERSION__;
    if (originalFetch === undefined) {
        delete globalThis.fetch;
    } else {
        globalThis.fetch = originalFetch;
    }
});

describe('isHostedBuild', () => {
    it('is false when the injected flag is absent', () => {
        assert.equal(isHostedBuild(), false);
    });

    it('is false for every value that is not the boolean true', () => {
        for (const value of [false, '1', 'true', 1, null, undefined]) {
            globalThis.__MICRO_OTTER_HOSTED__ = value;
            assert.equal(isHostedBuild(), false, `value ${JSON.stringify(value)} stays local`);
        }
    });

    it('is true only for the boolean true', () => {
        globalThis.__MICRO_OTTER_HOSTED__ = true;
        assert.equal(isHostedBuild(), true);
    });
});

describe('getHostedDocsUrl', () => {
    it('is null when the injected value is absent, blank or not a string', () => {
        for (const value of [undefined, '', '   ', 42, null]) {
            globalThis.__MICRO_OTTER_DOCS_URL__ = value;
            assert.equal(getHostedDocsUrl(), null, `value ${JSON.stringify(value)} yields null`);
        }
    });

    it('returns the trimmed url', () => {
        globalThis.__MICRO_OTTER_DOCS_URL__ = '  https://example.invalid/install  ';
        assert.equal(getHostedDocsUrl(), 'https://example.invalid/install');
    });
});

describe('app-meta hosted version source', () => {
    it('skips /api/version and reads /html/version.json in a hosted bundle', async () => {
        const requests = [];
        globalThis.__MICRO_OTTER_HOSTED__ = true;
        globalThis.fetch = async (url) => {
            requests.push(String(url));
            if (String(url) === '/html/version.json') {
                return { ok: true, status: 200, json: async () => ({ version: '1.2.3-hosted' }) };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };

        assert.equal(await resolveAppVersion(), '1.2.3-hosted');
        assert.deepEqual(requests, ['/html/version.json']);
    });

    it('falls back to the injected build version when the version file fails', async () => {
        globalThis.__MICRO_OTTER_HOSTED__ = true;
        globalThis.__MICRO_OTTER_APP_VERSION__ = '0.0.1-injected';
        globalThis.fetch = async () => {
            throw new Error('offline');
        };

        assert.equal(await resolveAppVersion(), '0.0.1-injected');
    });

    it('asks /api/version first in a local build', async () => {
        const requests = [];
        globalThis.fetch = async (url) => {
            requests.push(String(url));
            return { ok: true, status: 200, json: async () => ({ version: 'local-server' }) };
        };

        assert.equal(await resolveAppVersion(), 'local-server');
        assert.deepEqual(requests, ['/api/version']);
    });
});
