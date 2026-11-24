// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Lazy KaTeX loader for documentation areas.
 *
 * KaTeX is the single network dependency of the documentation-area feature. It is loaded
 * on demand — the first time a box reports that its Markdown contains math — and cached in
 * module state, so the page never pays for it unless it is used.
 *
 * The loader never rejects: an offline machine, a blocked CDN or a timeout all resolve
 * `'unavailable'`, and callers fall back to the readable source representation the
 * Markdown renderer emits. The CDN base and version are exported so tests can assert the
 * URL shape and a future offline bundle only has to change this module.
 */

import type { KatexLike } from './markdown-renderer.js';

export const KATEX_VERSION = '0.16.11';
export const KATEX_CDN_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/`;
export const KATEX_STYLESHEET_URL = `${KATEX_CDN_BASE}katex.min.css`;
export const KATEX_SCRIPT_URL = `${KATEX_CDN_BASE}katex.min.js`;

const DEFAULT_TIMEOUT_MS = 5000;

export type KatexLoadState = 'idle' | 'loading' | 'ready' | 'unavailable';
export type KatexLoadOutcome = 'ready' | 'unavailable';

export interface KatexLoadOptions {
    /** Milliseconds to wait for the CDN before reporting `'unavailable'`. */
    timeoutMs?: number;
}

let loadState: KatexLoadState = 'idle';
let pendingLoad: Promise<KatexLoadOutcome> | null = null;
let katexInstance: KatexLike | null = null;
let stylesheetInjected = false;
const stateListeners = new Set<(state: KatexLoadState) => void>();

/**
 * Publish a state transition to every current subscriber.
 * @param {KatexLoadState} next - New loader state.
 * @returns {void}
 */
function setLoadState(next: KatexLoadState): void {
    if (loadState === next) {
        return;
    }
    loadState = next;
    for (const listener of [...stateListeners]) {
        try {
            listener(next);
        } catch {
            // A misbehaving subscriber must not break the loader.
        }
    }
}

/**
 * Whether a DOM is available to inject the CDN assets into.
 * @returns {boolean} True when `document.head` exists.
 */
function hasDocumentHead(): boolean {
    return (
        typeof document !== 'undefined' &&
        !!document &&
        !!document.head &&
        typeof document.createElement === 'function'
    );
}

/**
 * Resolve the global `katex` object once the script has finished loading.
 * @returns {KatexLike | null} Usable KaTeX instance or null.
 */
function resolveKatexGlobal(): KatexLike | null {
    const scopes: unknown[] = [];
    if (typeof window !== 'undefined') {
        scopes.push(window);
    }
    if (typeof globalThis !== 'undefined') {
        scopes.push(globalThis);
    }

    for (const scope of scopes) {
        const candidate = (scope as { katex?: KatexLike }).katex;
        if (candidate && typeof candidate.renderToString === 'function') {
            return candidate;
        }
    }

    return null;
}

/**
 * Inject the KaTeX stylesheet exactly once per load cycle.
 * @returns {void}
 */
function injectStylesheet(): void {
    if (stylesheetInjected || !hasDocumentHead()) {
        return;
    }
    stylesheetInjected = true;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = KATEX_STYLESHEET_URL;
    link.dataset.katexLoader = 'stylesheet';
    document.head.appendChild(link);
}

/**
 * Load KaTeX from the CDN on demand.
 *
 * Concurrent calls share one load. The promise never rejects; it resolves
 * `'unavailable'` when the CDN cannot be reached.
 * @param {KatexLoadOptions} options - Optional timeout override.
 * @returns {Promise<KatexLoadOutcome>} Load outcome.
 */
export function loadKaTeX(options: KatexLoadOptions = {}): Promise<KatexLoadOutcome> {
    const requestedTimeout = options.timeoutMs;
    const timeoutMs =
        typeof requestedTimeout === 'number' && Number.isFinite(requestedTimeout)
            ? Math.max(0, requestedTimeout)
            : DEFAULT_TIMEOUT_MS;

    if (loadState === 'ready') {
        return Promise.resolve('ready');
    }
    if (loadState === 'unavailable') {
        return Promise.resolve('unavailable');
    }
    if (pendingLoad) {
        return pendingLoad;
    }

    if (!hasDocumentHead()) {
        setLoadState('unavailable');
        return Promise.resolve('unavailable');
    }

    const alreadyLoaded = resolveKatexGlobal();
    if (alreadyLoaded) {
        katexInstance = alreadyLoaded;
        setLoadState('ready');
        return Promise.resolve('ready');
    }

    setLoadState('loading');

    pendingLoad = new Promise<KatexLoadOutcome>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (outcome: KatexLoadOutcome): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }

            if (outcome === 'ready') {
                const katex = resolveKatexGlobal();
                if (katex) {
                    katexInstance = katex;
                    setLoadState('ready');
                    resolve('ready');
                    return;
                }
            }

            katexInstance = null;
            setLoadState('unavailable');
            resolve('unavailable');
        };

        const script = document.createElement('script');
        script.src = KATEX_SCRIPT_URL;
        script.async = true;
        script.dataset.katexLoader = 'script';
        script.addEventListener('load', () => finish('ready'));
        script.addEventListener('error', () => finish('unavailable'));

        injectStylesheet();
        document.head.appendChild(script);

        timer = setTimeout(() => finish('unavailable'), timeoutMs);
    });

    return pendingLoad;
}

/**
 * Current loader state.
 * @returns {KatexLoadState} One of `idle`, `loading`, `ready`, `unavailable`.
 */
export function getKatexLoadState(): KatexLoadState {
    return loadState;
}

/**
 * The loaded KaTeX instance, if any.
 * @returns {KatexLike | null} KaTeX instance or null.
 */
export function getKatex(): KatexLike | null {
    return katexInstance;
}

/**
 * Subscribe to loader state transitions.
 * @param {(state: KatexLoadState) => void} listener - Callback invoked on every transition.
 * @returns {() => void} Unsubscribe function.
 */
export function onKatexStateChange(listener: (state: KatexLoadState) => void): () => void {
    if (typeof listener !== 'function') {
        return () => {};
    }
    stateListeners.add(listener);
    return () => {
        stateListeners.delete(listener);
    };
}

/**
 * Reset the loader to `idle`, discarding the cached promise and instance.
 * Test-only seam: a reset allows a second load cycle (and a second injection).
 * @returns {void}
 */
export function __resetKatexLoaderForTests(): void {
    loadState = 'idle';
    pendingLoad = null;
    katexInstance = null;
    stylesheetInjected = false;
}
