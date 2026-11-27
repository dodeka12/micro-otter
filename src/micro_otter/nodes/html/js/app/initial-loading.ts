// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Initial-loading splash bootstrap.
 *
 * The body is the script that used to sit inline in `index.html`, moved into a module file so the
 * hosted bundle can ship `Content-Security-Policy: script-src 'self'` — an inline script would
 * need `'unsafe-inline'` and would be blocked outright.
 *
 * Keep this file import-free: it must stay a standalone early script, because it has to run before
 * the app's module graph does any work. As a module it is deferred, so it starts marginally later
 * than the old inline script; the splash markup is static, so the visible behaviour is unchanged.
 */

const initialLoading = document.getElementById('initial-loading');
const initialLoadingText = document.getElementById('initial-loading-text');

if (initialLoading) {
    const initialLoadingIcon = new Image();
    let isResolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    initialLoadingIcon.id = 'initial-loading-icon';
    initialLoadingIcon.alt = '';
    initialLoadingIcon.setAttribute('aria-hidden', 'true');

    /**
     * Swap the animated dots for the icon as soon as it has loaded.
     * @returns {void}
     */
    const showInitialLoadingIcon = (): void => {
        if (isResolved) {
            return;
        }
        isResolved = true;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        initialLoading.insertBefore(
            initialLoadingIcon,
            initialLoadingText ?? initialLoading.firstChild
        );
        requestAnimationFrame(() => {
            initialLoadingIcon.classList.add('is-loaded');
        });
        initialLoading.classList.remove('is-icon-loading');
    };

    /**
     * Stop animating when the icon cannot be loaded; the text stays.
     * @returns {void}
     */
    const hideLoadingDots = (): void => {
        if (isResolved) {
            return;
        }
        isResolved = true;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        initialLoading.classList.remove('is-icon-loading');
    };

    /**
     * Report a slow start instead of animating the dots forever.
     * @returns {void}
     */
    const handleSlowLoadTimeout = (): void => {
        if (isResolved) {
            return;
        }
        isResolved = true;
        initialLoading.classList.remove('is-icon-loading');
        if (initialLoadingText) {
            initialLoadingText.textContent = 'taking unusually long...';
        }
    };

    initialLoadingIcon.addEventListener('load', showInitialLoadingIcon, { once: true });
    initialLoadingIcon.addEventListener('error', hideLoadingDots, { once: true });
    timeoutId = setTimeout(handleSlowLoadTimeout, 2000);
    initialLoadingIcon.src = 'html/icons/micro-otter-white-128px.svg';
}

export {};
