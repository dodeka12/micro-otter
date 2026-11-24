// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Proxy rules for the `/device` requests only the Python backend can answer.
 *
 * Vite serves `/device` from `src/micro_otter/nodes/device` and must keep doing so: the app
 * `import`s `device/capabilities/*.json` and needs Vite's JSON→ES-module transform. Three
 * request shapes are not files at all:
 *
 *  - `/device/node_pkgs/index.json` — `addon_store.merged_index_payload` adds one entry per
 *    installed add-on,
 *  - `/device/runtime/<id>/manifest.json` — `addon_store.runtime_manifest_addons` adds
 *    `nodePackages.addons`,
 *  - `/device/node_pkgs/<addon-id>/…` — `addon_store.addon_asset_path` reaches into
 *    `Config.addons_dir` for files that are not in the repository.
 *
 * Without a proxy the Firmware tab lists no add-ons on the Vite origin: the only request that
 * can name them is answered from the checked-in files. Forwarding the whole `/device` prefix is
 * not an option — `capabilities/*.json` must keep Vite's transform, and the backend serves the
 * remaining sources from its own static root, which is a stale build in a source checkout.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Origin of the Python backend; `MICRO_OTTER_BACKEND_ORIGIN` overrides it. */
export const BACKEND_ORIGIN = process.env.MICRO_OTTER_BACKEND_ORIGIN || 'http://127.0.0.1:8000';

/** How long one backend probe stays valid before the next request re-probes. */
export const BACKEND_PROBE_TTL_MS = 3000;

const CAPABILITIES_PATH = '/api/server-capabilities';
const NODE_PKGS_PREFIX = '/device/node_pkgs/';
const NODE_PACKAGE_INDEX_PATH = `${NODE_PKGS_PREFIX}index.json`;
const RUNTIME_PREFIX = '/device/runtime/';
const RUNTIME_MANIFEST_NAME = 'manifest.json';
const PROBE_TIMEOUT_MS = 400;

/** One package id: a single path segment, which also rules out `.` and `..`. */
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Return the path of a request URL without query string or fragment.
 *
 * @param {string} requestUrl Raw `req.url` of the dev-server request.
 * @returns {string} Path component, `/` when empty.
 */
function requestPathOf(requestUrl) {
    const [pathname] = String(requestUrl || '').split(/[?#]/);
    return pathname || '/';
}

/**
 * Report whether the backend synthesizes this path, i.e. whether it is not a file.
 *
 * Mirrors `addon_store.merged_index_payload`, `addon_store.runtime_manifest_addons` and
 * `addon_store.addon_asset_path`, so the two servers cannot drift on which requests are
 * synthesized.
 *
 * @param {string} requestPath Request path without query string.
 * @param {string} nodePkgsDir The `device/node_pkgs` folder Vite serves from.
 * @returns {boolean} True when the request must reach the Python backend.
 */
export function isSynthesizedDevicePath(requestPath, nodePkgsDir) {
    if (requestPath === NODE_PACKAGE_INDEX_PATH) {
        return true;
    }

    if (requestPath.startsWith(RUNTIME_PREFIX) && requestPath.endsWith(`/${RUNTIME_MANIFEST_NAME}`)) {
        const runtimeId = requestPath.slice(
            RUNTIME_PREFIX.length,
            -(RUNTIME_MANIFEST_NAME.length + 1)
        );
        if (runtimeId && !runtimeId.includes('/')) {
            return true;
        }
    }

    if (!requestPath.startsWith(NODE_PKGS_PREFIX)) {
        return false;
    }

    const [packageId] = requestPath.slice(NODE_PKGS_PREFIX.length).split('/');
    if (!PACKAGE_ID_PATTERN.test(packageId)) {
        return false;
    }

    // A package that ships with the app keeps being served by Vite; only an id the source tree
    // does not know can be an installed add-on.
    return !fs.existsSync(path.join(nodePkgsDir, packageId));
}

/**
 * Ask the backend whether it is up and is a Micro Otter server.
 *
 * @returns {Promise<boolean>} True when `/api/server-capabilities` answered.
 */
export async function probeBackend() {
    try {
        const response = await fetch(`${BACKEND_ORIGIN}${CAPABILITIES_PATH}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) {
            return false;
        }

        const payload = await response.json();
        return payload?.serverType === 'micro-otter';
    } catch {
        return false;
    }
}

/**
 * Refresh *state* when its last probe is older than `BACKEND_PROBE_TTL_MS`.
 *
 * @param {{ reachable: boolean, checkedAt: number }} state Cache shared by every request.
 * @returns {Promise<boolean>} Whether the backend answered the last probe.
 */
async function ensureBackendReachable(state) {
    if (Date.now() - state.checkedAt <= BACKEND_PROBE_TTL_MS) {
        return state.reachable;
    }

    state.reachable = await probeBackend();
    state.checkedAt = Date.now();
    return state.reachable;
}

/**
 * Build the `server.proxy` entry that forwards the synthesized `/device` paths.
 *
 * `bypass` returns the request URL for everything Vite can serve from the source tree — and for
 * everything while the backend is unreachable, so `npm run dev:web` without
 * `npm run dev:backend` keeps working from the checked-in files. Vite awaits `bypass`: a string
 * serves the request locally, `undefined` proxies it.
 *
 * @param {string} nodePkgsDir The `device/node_pkgs` folder Vite serves from.
 * @returns {object} Vite proxy options for the `/device/` context.
 */
export function createDeviceDataProxy(nodePkgsDir) {
    const state = { reachable: false, checkedAt: 0 };

    return {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        async bypass(request) {
            if (!isSynthesizedDevicePath(requestPathOf(request.url), nodePkgsDir)) {
                return request.url;
            }

            if (!(await ensureBackendReachable(state))) {
                return request.url;
            }

            return undefined;
        },
    };
}
