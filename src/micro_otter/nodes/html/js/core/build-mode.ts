// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Build-mode switch for the hosted bundle.
 *
 * The hosted bundle is the same editor with the local Micro-Otter server taken out of the
 * picture: it runs on a static host, so it must not probe `/api/server-capabilities` or
 * `/api/version`, must never render the server badge, and must explain in the Firmware tab why
 * the local-server features are missing.
 *
 * Both values are build-time constants injected by `define` in `vite.config.js`:
 * `MICRO_OTTER_HOSTED=1` (set by `mo webapp build`) and `MICRO_OTTER_WEBAPP_DOCS_URL`. There is
 * deliberately no Vite environment variable here — the bundle has exactly one build path, and
 * `define` is the seam the app version already uses, so the minifier can collapse the branch in
 * a local build.
 */

declare global {
    interface GlobalThis {
        /** `true` only in a hosted bundle; injected by `define` in `vite.config.js`. */
        __MICRO_OTTER_HOSTED__?: boolean;
        /** Absolute install/docs URL, or `''`; injected by `define` in `vite.config.js`. */
        __MICRO_OTTER_DOCS_URL__?: string;
    }
}

/**
 * Whether this bundle is the hosted (static-host) build.
 *
 * The comparison is strict on purpose: only the boolean `true` switches modes, so a stray
 * string from a hand-edited `define` can never turn a local build into a hosted one.
 *
 * Default in a local build: `false`.
 *
 * @returns {boolean} `true` only when the injected flag is the boolean `true`.
 */
export function isHostedBuild(): boolean {
    return globalThis.__MICRO_OTTER_HOSTED__ === true;
}

/**
 * Absolute URL of the hosted install instructions, as supplied at build time.
 *
 * The value arrives from `mo webapp build --docs-url` through
 * `MICRO_OTTER_WEBAPP_DOCS_URL`. Default in a local build: `null` — nothing here invents a host,
 * because the build is hoster-agnostic and a wrong link is worse than no link.
 *
 * @returns {string | null} The trimmed URL, or `null` when it is absent, blank or not a string.
 */
export function getHostedDocsUrl(): string | null {
    const url = globalThis.__MICRO_OTTER_DOCS_URL__;
    if (typeof url !== 'string') {
        return null;
    }
    const trimmed = url.trim();
    return trimmed.length > 0 ? trimmed : null;
}
