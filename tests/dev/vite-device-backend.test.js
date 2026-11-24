import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    createDeviceDataProxy,
    isSynthesizedDevicePath,
    probeBackend,
} from '../../tools/vite-device-backend.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE_PKGS_DIR = path.join(REPO_ROOT, 'src/micro_otter/nodes/device/node_pkgs');

describe('dev-server /device proxy classification', () => {
    it('claims the merged package index', () => {
        assert.equal(isSynthesizedDevicePath('/device/node_pkgs/index.json', NODE_PKGS_DIR), true);
    });

    it('claims a runtime manifest but not the runtime sources', () => {
        assert.equal(
            isSynthesizedDevicePath('/device/runtime/general/manifest.json', NODE_PKGS_DIR),
            true
        );
        assert.equal(isSynthesizedDevicePath('/device/runtime/manifest.json', NODE_PKGS_DIR), false);
        assert.equal(
            isSynthesizedDevicePath('/device/runtime/general/otter_runtime/logger.py', NODE_PKGS_DIR),
            false
        );
        assert.equal(
            isSynthesizedDevicePath('/device/runtime/a/b/manifest.json', NODE_PKGS_DIR),
            false
        );
    });

    it('leaves the packages that ship with the app to Vite', () => {
        assert.equal(
            isSynthesizedDevicePath('/device/node_pkgs/core/manifest.json', NODE_PKGS_DIR),
            false
        );
        assert.equal(
            isSynthesizedDevicePath('/device/node_pkgs/core/node_generators.js', NODE_PKGS_DIR),
            false
        );
    });

    it('claims the files of a package the source tree does not know', () => {
        assert.equal(
            isSynthesizedDevicePath('/device/node_pkgs/pulse/manifest.json', NODE_PKGS_DIR),
            true
        );
        assert.equal(
            isSynthesizedDevicePath('/device/node_pkgs/pulse/moa_pulse/__init__.py', NODE_PKGS_DIR),
            true
        );
    });

    it('never claims a path that is not a single well-formed package id', () => {
        assert.equal(isSynthesizedDevicePath('/device/node_pkgs/../secret', NODE_PKGS_DIR), false);
        assert.equal(isSynthesizedDevicePath('/device/node_pkgs/', NODE_PKGS_DIR), false);
        assert.equal(isSynthesizedDevicePath('/device/node_pkgs', NODE_PKGS_DIR), false);
    });

    it('keeps the files Vite has to transform out of the proxy', () => {
        assert.equal(
            isSynthesizedDevicePath('/device/capabilities/general.json', NODE_PKGS_DIR),
            false
        );
        assert.equal(
            isSynthesizedDevicePath('/device/capabilities/index.json?import', NODE_PKGS_DIR),
            false
        );
        assert.equal(
            isSynthesizedDevicePath('/device/targets/esp32_wroom.json', NODE_PKGS_DIR),
            false
        );
    });
});

describe('dev-server /device proxy bypass', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('serves the checked-in file while the backend is unreachable', async () => {
        globalThis.fetch = async () => {
            throw new Error('ECONNREFUSED');
        };
        const proxy = createDeviceDataProxy(NODE_PKGS_DIR);

        assert.equal(
            await proxy.bypass({ url: '/device/node_pkgs/index.json' }),
            '/device/node_pkgs/index.json'
        );
    });

    it('forwards a synthesized request and leaves the rest local', async () => {
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ serverType: 'micro-otter' }),
        });
        const proxy = createDeviceDataProxy(NODE_PKGS_DIR);

        assert.equal(await proxy.bypass({ url: '/device/node_pkgs/index.json' }), undefined);
        assert.equal(
            await proxy.bypass({ url: '/device/node_pkgs/core/manifest.json' }),
            '/device/node_pkgs/core/manifest.json'
        );
        assert.equal(
            await proxy.bypass({ url: '/device/capabilities/general.json?import' }),
            '/device/capabilities/general.json?import'
        );
    });

    it('treats a foreign service on the port as "no backend"', async () => {
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ serverType: 'nginx' }),
        });

        assert.equal(await probeBackend(), false);
    });
});
