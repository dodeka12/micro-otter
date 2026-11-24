/**
 * Splash Screen component for displaying progress during app initialization.
 *
 * Provides a visual overlay with branding and progress tracking capabilities.
 * The splash screen shows during startup and hides once initialization completes.
 *
 * Features:
 * - Semi-transparent backdrop to prevent interaction
 * - Centered card with Micro-Otter branding
 * - Progress bar with percentage display
 * - Progress message and history tracking
 * - Error highlighting and completion indicators
 * - Smooth fade-in/fade-out transitions
 *
 * Usage:
 * ```javascript
 * const splash = new SplashScreen();
 * splash.show();
 * // ... initialization work ...
 * splash.updateProgress(progressEvent);
 * splash.hide();
 * ```
 */

import { ProgressEventType, type ProgressEvent } from '../core/progress-events.js';
import { IconProvider } from './icon-provider.js';

interface SplashScreenOptions {
    title?: string;
    version?: string;
    maxHistoryItems?: number;
}

interface FeatureDetail {
    available: boolean;
    reason?: string;
}

type FeatureDetailsMap = Map<string, FeatureDetail>;
type FeatureListType = 'required' | 'optional';

export class SplashScreen {
    _title: string;
    _version: string;
    _maxHistoryItems: number;
    _isVisible: boolean;
    _container: HTMLDivElement | null;
    _progressContainer: HTMLDivElement | null;
    _progressBar: HTMLDivElement | null;
    _progressMessage: HTMLDivElement | null;
    _progressPercentage: HTMLDivElement | null;
    _progressHistory: HTMLDivElement | null;
    _historyItems: HTMLDivElement[];
    _featureWarningSection: HTMLDivElement | null;
    _continueButton: HTMLButtonElement | null;
    _hasRequiredFeaturesMissing: boolean;
    _showTimer: ReturnType<typeof setTimeout> | null;
    _hideTimer: ReturnType<typeof setTimeout> | null;

    /**
     * Create a new splash screen instance.
     * @param {Object} [options] Configuration options
     * @param {string} [options.title='Micro-Otter'] App title to display
     * @param {string} [options.version=''] Version string to display
     */
    constructor({ title = 'Micro-Otter', version = '', maxHistoryItems = 8 }: SplashScreenOptions = {}) {
        this._title = title;
        this._version = version;
        this._maxHistoryItems = maxHistoryItems;
        this._isVisible = false;
        this._container = null;
        this._progressContainer = null;
        this._progressBar = null;
        this._progressMessage = null;
        this._progressPercentage = null;
        this._progressHistory = null;
        this._historyItems = [];
        this._featureWarningSection = null;
        this._continueButton = null;
        this._hasRequiredFeaturesMissing = false;
        this._showTimer = null;
        this._hideTimer = null;

        this._createDOM();
    }

    /**
     * Create the splash screen DOM structure and append to body.
     * @private
     */
    _createDOM(): void {
        this._container = document.createElement('div');
        this._container.className = 'splash-screen';
        this._container.style.display = 'none';

        const backdrop = document.createElement('div');
        backdrop.className = 'splash-screen__backdrop';

        const card = document.createElement('div');
        card.className = 'splash-screen__card';

        const logoSection = document.createElement('div');
        logoSection.className = 'splash-screen__logo-section';

        const logo = document.createElement('img');
        logo.className = 'splash-screen__logo';
        logo.src = IconProvider.otterWhite128;
        logo.alt = 'Micro-Otter Logo';
        logoSection.appendChild(logo);

        const titleSection = document.createElement('div');
        titleSection.className = 'splash-screen__title-section';

        const title = document.createElement('h1');
        title.className = 'splash-screen__title';
        title.textContent = this._title;
        titleSection.appendChild(title);

        if (this._version) {
            const version = document.createElement('div');
            version.className = 'splash-screen__version';
            version.textContent = `v${this._version}`;
            titleSection.appendChild(version);
        }

        this._progressContainer = document.createElement('div');
        this._progressContainer.className = 'splash-screen__progress-container';

        const progressBarSection = document.createElement('div');
        progressBarSection.className = 'splash-screen__progress-bar-section';

        this._progressBar = document.createElement('div');
        this._progressBar.className = 'splash-screen__progress-bar';

        const progressBarFill = document.createElement('div');
        progressBarFill.className = 'splash-screen__progress-bar-fill';
        this._progressBar.appendChild(progressBarFill);

        this._progressPercentage = document.createElement('div');
        this._progressPercentage.className = 'splash-screen__progress-percentage';
        this._progressPercentage.textContent = '0%';

        progressBarSection.appendChild(this._progressBar);
        progressBarSection.appendChild(this._progressPercentage);

        this._progressMessage = document.createElement('div');
        this._progressMessage.className = 'splash-screen__progress-message';
        this._progressMessage.textContent = 'Initializing...';

        this._progressHistory = document.createElement('div');
        this._progressHistory.className = 'splash-screen__progress-history';

        this._progressContainer.appendChild(progressBarSection);
        this._progressContainer.appendChild(this._progressMessage);
        this._progressContainer.appendChild(this._progressHistory);

        this._featureWarningSection = document.createElement('div');
        this._featureWarningSection.className = 'splash-screen__feature-warnings';
        this._featureWarningSection.style.display = 'none';

        card.appendChild(logoSection);
        card.appendChild(titleSection);
        card.appendChild(this._progressContainer);
        card.appendChild(this._featureWarningSection);

        this._container.appendChild(backdrop);
        this._container.appendChild(card);

        document.body.appendChild(this._container);
    }

    /**
     * Show the splash screen with a fade-in transition.
     * @returns {Promise<void>} Resolves when the fade-in animation completes
     */
    async show(): Promise<void> {
        if (this._isVisible) {
            return;
        }

        this._isVisible = true;

        const container = this._container!;
        container.style.display = 'flex';

        void container.offsetHeight;

        container.classList.add('splash-screen--visible');

        return new Promise<void>((resolve: () => void) => {
            const handleTransitionEnd = (event: TransitionEvent): void => {
                if (event.target === container && event.propertyName === 'opacity') {
                    container.removeEventListener('transitionend', handleTransitionEnd);
                    resolve();
                }
            };

            container.addEventListener('transitionend', handleTransitionEnd);

            this._showTimer = setTimeout((): void => {
                this._showTimer = null;
                resolve();
            }, 400);
        });
    }

    /**
     * Hide the splash screen with a fade-out transition.
     * @returns {Promise<void>} Resolves when the fade-out animation completes
     */
    async hide(): Promise<void> {
        if (!this._isVisible) {
            return;
        }

        this._isVisible = false;

        const container = this._container!;
        container.classList.remove('splash-screen--visible');

        return new Promise<void>((resolve: () => void) => {
            const handleTransitionEnd = (event: TransitionEvent): void => {
                if (event.target === container && event.propertyName === 'opacity') {
                    container.removeEventListener('transitionend', handleTransitionEnd);
                    container.style.display = 'none';
                    resolve();
                }
            };

            container.addEventListener('transitionend', handleTransitionEnd);

            this._hideTimer = setTimeout((): void => {
                this._hideTimer = null;
                container.style.display = 'none';
                resolve();
            }, 400);
        });
    }

    /**
     * Check if the splash screen is currently visible.
     * @returns {boolean} True if visible
     */
    get isVisible(): boolean {
        return this._isVisible;
    }

    /**
     * Get the progress container element for manual manipulation.
     * Use this to add progress elements or other content.
     * @returns {HTMLElement} The progress container element
     */
    get progressContainer(): HTMLDivElement | null {
        return this._progressContainer;
    }

    /**
     * Update the splash screen with a progress event.
     * @param {import('../core/progress-events.js').ProgressEvent} event Progress event
     */
    updateProgress(event: ProgressEvent | null | undefined): void {
        if (!event) {
            console.warn('[SplashScreen] updateProgress called with no event');
            return;
        }

        const progressBar = this._progressBar!;
        const progressPercentage = this._progressPercentage!;
        const progressMessage = this._progressMessage!;

        if (typeof event.progress === 'number') {
            const clampedProgress = Math.max(0, Math.min(100, event.progress));
            const fill = progressBar.querySelector<HTMLDivElement>('.splash-screen__progress-bar-fill');
            if (fill) {
                fill.style.width = `${clampedProgress}%`;
            }
            progressPercentage.textContent = `${Math.round(clampedProgress)}%`;
        }

        progressMessage.textContent = event.message || 'Processing...';

        progressMessage.className = 'splash-screen__progress-message';
        if (event.type === ProgressEventType.ERROR) {
            progressMessage.classList.add('splash-screen__progress-message--error');
        } else if (event.type === ProgressEventType.COMPLETE) {
            progressMessage.classList.add('splash-screen__progress-message--complete');
        }

        this._addHistoryItem(event);
    }

    /**
     * Add an item to the progress history list.
     * @param {import('../core/progress-events.js').ProgressEvent} event Progress event
     * @private
     */
    _addHistoryItem(event: ProgressEvent): void {
        const item = document.createElement('div');
        item.className = 'splash-screen__history-item';

        const icon = document.createElement('span');
        icon.className = 'splash-screen__history-icon';
        switch (event.type) {
            case ProgressEventType.START:
                icon.textContent = '▶';
                break;
            case ProgressEventType.UPDATE:
                icon.textContent = '●';
                break;
            case ProgressEventType.COMPLETE:
                icon.textContent = '✓';
                item.classList.add('splash-screen__history-item--complete');
                break;
            case ProgressEventType.ERROR:
                icon.textContent = '✗';
                item.classList.add('splash-screen__history-item--error');
                break;
            default:
                icon.textContent = '○';
        }
        item.appendChild(icon);

        const source = document.createElement('span');
        source.className = 'splash-screen__history-source';
        source.textContent = event.source;
        item.appendChild(source);

        const message = document.createElement('span');
        message.className = 'splash-screen__history-message';
        message.textContent = event.message;
        item.appendChild(message);

        if (typeof event.progress === 'number') {
            const progress = document.createElement('span');
            progress.className = 'splash-screen__history-progress';
            progress.textContent = `${Math.round(event.progress)}%`;
            item.appendChild(progress);
        }

        const progressHistory = this._progressHistory!;
        progressHistory.appendChild(item);
        this._historyItems.push(item);

        if (this._historyItems.length > this._maxHistoryItems) {
            const oldestItem = this._historyItems.shift();
            if (oldestItem && oldestItem.parentNode) {
                oldestItem.parentNode.removeChild(oldestItem);
            }
        }

        progressHistory.scrollTop = progressHistory.scrollHeight;
    }

    /**
     * Show feature warnings for missing required or optional features.
     * @param {string[]} missingRequired Array of missing required feature names
     * @param {string[]} missingOptional Array of missing optional feature names
     * @param {Map<string, {available: boolean, reason?: string}>} details Feature details map
     */
    showFeatureWarnings(
        missingRequired: string[] = [],
        missingOptional: string[] = [],
        details: FeatureDetailsMap = new Map()
    ): void {
        this._hasRequiredFeaturesMissing = missingRequired.length > 0;

        const featureWarningSection = this._featureWarningSection!;
        featureWarningSection.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'splash-screen__warnings-header';

        const icon = document.createElement('div');
        icon.className = 'splash-screen__warnings-icon';
        icon.textContent = this._hasRequiredFeaturesMissing ? '⚠️' : 'ℹ️';
        header.appendChild(icon);

        const title = document.createElement('div');
        title.className = 'splash-screen__warnings-title';
        title.textContent = this._hasRequiredFeaturesMissing
            ? 'Browser Compatibility Issue'
            : 'Optional Features Unavailable';
        header.appendChild(title);

        featureWarningSection.appendChild(header);

        const subtitle = document.createElement('div');
        subtitle.className = 'splash-screen__warnings-subtitle';
        subtitle.textContent = this._hasRequiredFeaturesMissing
            ? 'Your browser is missing required features to run Micro-Otter.'
            : 'Some optional features are not available but the app can still run.';
        featureWarningSection.appendChild(subtitle);

        if (missingRequired.length > 0) {
            const requiredSection = this._createFeatureList(
                'Required Features Missing:',
                missingRequired,
                details,
                'required'
            );
            featureWarningSection.appendChild(requiredSection);
        }

        if (missingOptional.length > 0) {
            const optionalSection = this._createFeatureList(
                'Optional Features Unavailable:',
                missingOptional,
                details,
                'optional'
            );
            featureWarningSection.appendChild(optionalSection);
        }

        const footer = document.createElement('div');
        footer.className = 'splash-screen__warnings-footer';

        if (this._hasRequiredFeaturesMissing) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'splash-screen__warnings-error-message';
            errorMsg.textContent =
                'Cannot start - please update your browser or try a different one.';
            footer.appendChild(errorMsg);
        } else {
            this._continueButton = document.createElement('button');
            this._continueButton.className = 'splash-screen__warnings-continue-btn';
            this._continueButton.textContent = 'Continue Anyway';
            this._continueButton.addEventListener('click', (): void => {
                this.hideFeatureWarnings();
                const event = new CustomEvent('splash-continue', {
                    detail: { missingOptional },
                });
                this._container!.dispatchEvent(event);
            });
            footer.appendChild(this._continueButton);
        }

        featureWarningSection.appendChild(footer);

        featureWarningSection.style.display = 'flex';
    }

    /**
     * Hide the feature warnings section.
     */
    hideFeatureWarnings(): void {
        if (this._featureWarningSection) {
            this._featureWarningSection.style.display = 'none';
        }
    }

    /**
     * Create a feature list section.
     * @param {string} title Section title
     * @param {string[]} features Array of feature names
     * @param {Map<string, {available: boolean, reason?: string}>} details Feature details
     * @param {string} type 'required' or 'optional'
     * @returns {HTMLElement} Feature list section
     * @private
     */
    _createFeatureList(
        title: string,
        features: string[],
        details: FeatureDetailsMap,
        type: FeatureListType
    ): HTMLDivElement {
        const section = document.createElement('div');
        section.className = 'splash-screen__feature-list-section';

        const listTitle = document.createElement('div');
        listTitle.className = 'splash-screen__feature-list-title';
        listTitle.textContent = title;
        section.appendChild(listTitle);

        const list = document.createElement('div');
        list.className = 'splash-screen__feature-list';

        for (const featureName of features) {
            const detail = details.get(featureName);
            const item = document.createElement('div');
            item.className = `splash-screen__feature-item splash-screen__feature-item--${type}`;

            const nameRow = document.createElement('div');
            nameRow.className = 'splash-screen__feature-name';
            const iconSpan = document.createElement('span');
            iconSpan.textContent = '✗ ';
            nameRow.appendChild(iconSpan);
            nameRow.appendChild(document.createTextNode(featureName));
            item.appendChild(nameRow);

            if (detail?.reason) {
                const reason = document.createElement('div');
                reason.className = 'splash-screen__feature-reason';
                reason.textContent = detail.reason;
                item.appendChild(reason);
            }

            list.appendChild(item);
        }

        section.appendChild(list);
        return section;
    }

    /**
     * Clear all progress history items.
     */
    clearHistory(): void {
        this._historyItems.forEach((item: HTMLDivElement): void => {
            if (item && item.parentNode) {
                item.parentNode.removeChild(item);
            }
        });
        this._historyItems = [];
    }

    /**
     * Reset progress display to initial state.
     */
    resetProgress(): void {
        const progressBar = this._progressBar!;
        const progressPercentage = this._progressPercentage!;
        const progressMessage = this._progressMessage!;

        const fill = progressBar.querySelector<HTMLDivElement>('.splash-screen__progress-bar-fill');
        if (fill) {
            fill.style.width = '0%';
        }
        progressPercentage.textContent = '0%';

        progressMessage.textContent = 'Initializing...';
        progressMessage.className = 'splash-screen__progress-message';

        this.clearHistory();
    }

    /**
     * Remove the splash screen from the DOM completely.
     * Call this when the splash screen is no longer needed.
     */
    destroy(): void {
        if (this._showTimer) {
            clearTimeout(this._showTimer);
            this._showTimer = null;
        }

        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._container = null;
        this._progressContainer = null;
        this._isVisible = false;
    }
}
