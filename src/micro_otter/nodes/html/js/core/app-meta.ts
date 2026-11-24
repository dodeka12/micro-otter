// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { OPEN_SOURCE_PACKAGES } from './open-source-packages.generated.js';

const FALLBACK_APP_VERSION = '0.0.0-dev';

type VersionPayload = {
    version?: unknown;
};

declare global {
    interface GlobalThis {
        __MICRO_OTTER_APP_VERSION__?: string;
    }
}

export { OPEN_SOURCE_PACKAGES };

function getBuildInjectedVersion(): string | null {
    const injected = globalThis.__MICRO_OTTER_APP_VERSION__;
    return typeof injected === 'string' && injected.trim().length > 0 ? injected.trim() : null;
}

async function getRuntimeServedVersion(): Promise<string | null> {
    if (typeof fetch !== 'function') {
        return null;
    }

    try {
        const response = await fetch('/api/version', {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as VersionPayload;
        const version = payload?.version;
        return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null;
    } catch {
        return null;
    }
}

async function getStaticVersionFileVersion(): Promise<string | null> {
    if (typeof fetch !== 'function') {
        return null;
    }

    try {
        const response = await fetch('/html/version.json', {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as VersionPayload;
        const version = payload?.version;
        return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null;
    } catch {
        return null;
    }
}

/**
 * Resolve the current application version in both build and dev environments.
 *
 * Priority:
 * 1) Runtime server endpoint (`/api/version`) — the installed package version
 * 2) Static version file (`/html/version.json`) — the stamp `vite build` wrote into the bundle
 * 3) Vite build-time injected version
 * 4) Fallback placeholder
 *
 * @returns {Promise<string>}
 */
export async function resolveAppVersion(): Promise<string> {
    const runtimeVersion = await getRuntimeServedVersion();
    if (runtimeVersion) {
        return runtimeVersion;
    }

    const staticFileVersion = await getStaticVersionFileVersion();
    if (staticFileVersion) {
        return staticFileVersion;
    }

    const buildVersion = getBuildInjectedVersion();
    if (buildVersion) {
        return buildVersion;
    }

    return FALLBACK_APP_VERSION;
}
