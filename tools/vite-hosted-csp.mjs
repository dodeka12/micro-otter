// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Build-time Content-Security-Policy for the hosted bundle.
 *
 * A static bundle cannot set response headers on shared hosting, so the policy ships as a
 * `<meta http-equiv="Content-Security-Policy">` the Vite HTML transform injects into
 * `index.html`. The local build gets no policy at all: it talks to the dev server and the
 * Micro-Otter backend on the same origin, and a policy there would only hide regressions in the
 * hosted one.
 *
 * Two omissions are deliberate and documented in `docs/dev/deployment/hosted-webapp.md`:
 *
 *  - no `'unsafe-inline'` and no `'unsafe-eval'` — `index.html` carries no inline `<style>` or
 *    `<script>` (the splash bootstrap is a module file), and the startup feature probes use direct
 *    syntax checks instead of `eval()`;
 *  - no `frame-ancestors` — it is ignored inside `<meta>` and belongs in server configuration
 *    (`.htaccess`), which is optional material, not part of the bundle.
 */

/**
 * The policy the hosted bundle ships, verbatim.
 *
 * `connect-src 'self'` covers the runtime fetches of `/device/*`, `/html/locales/*` and
 * `/html/version.json`; `img-src` additionally allows `data:` and `blob:` for generated images.
 * KaTeX is the one runtime dependency that lives on a CDN, so math in documentation areas is
 * reported unavailable and the renderer falls back to readable source text.
 *
 * @type {string}
 */
export const HOSTED_CSP_POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; object-src 'none'";

/**
 * Create the plugin that injects {@link HOSTED_CSP_POLICY} into the built `index.html`.
 *
 * @param {{ hosted?: boolean }} [options] - `hosted: true` enables the injection.
 * @returns {import('vite').Plugin} A plugin that is a no-op for a local build.
 */
export function hostedCspPlugin({ hosted = false } = {}) {
    return {
        name: 'micro-otter-hosted-csp',
        transformIndexHtml(html) {
            if (!hosted) {
                return undefined;
            }
            return {
                html,
                tags: [
                    {
                        tag: 'meta',
                        attrs: {
                            'http-equiv': 'Content-Security-Policy',
                            content: HOSTED_CSP_POLICY,
                        },
                        injectTo: 'head-prepend',
                    },
                ],
            };
        },
    };
}
