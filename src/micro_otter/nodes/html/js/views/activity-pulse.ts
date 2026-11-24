// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Reusable soft pulse that marks a region as "something is happening".
 *
 * The effect is one CSS class (`mo-activity-pulse`, defined in
 * `styles/standard/activity-pulse.css`) that animates an inset glow. Triggers are
 * named reasons rather than a boolean, so independent background activities can
 * overlap: the pulse stops only after the last reason has been released, and one
 * activity can never clear the cue of another.
 */

/** Options for {@link ActivityPulse}. */
export interface ActivityPulseOptions {
    /** Class toggled on the element while at least one reason is active. */
    className?: string;
}

/**
 * Drive the activity pulse of a single element through named reasons.
 *
 * The class is applied only while `reasons` is non-empty, so callers stay
 * independent of each other's lifecycle. The class itself carries the animation
 * (and a static fallback under `prefers-reduced-motion: reduce`); this class never
 * writes inline styles and therefore cannot fight a host element's inline chrome.
 */
export class ActivityPulse {
    /** Element whose class list reflects the pulse. */
    readonly element: HTMLElement;

    /** Class toggled while any reason is active. */
    readonly className: string;

    /** Reasons currently keeping the pulse alive; the pulse is on while this is non-empty. */
    #reasons = new Set<string>();

    /**
     * Bind the pulse to *element*.
     * @param {HTMLElement} element Element that receives the pulse class.
     * @param {ActivityPulseOptions} [options] Class-name override.
     */
    constructor(
        element: HTMLElement,
        { className = 'mo-activity-pulse' }: ActivityPulseOptions = {}
    ) {
        this.element = element;
        this.className = className;
    }

    /** Whether at least one reason is active. */
    get active(): boolean {
        return this.#reasons.size > 0;
    }

    /** Snapshot of the active reasons, in the order they were started. */
    get reasons(): readonly string[] {
        return [...this.#reasons];
    }

    /**
     * Keep the pulse running for *reason*; repeated calls are idempotent.
     * @param {string} reason Name of the activity that needs the pulse, e.g. `'device-connection'`.
     */
    start(reason: string): void {
        const key = ActivityPulse.#normalizeReason(reason);
        if (!key || this.#reasons.has(key)) {
            return;
        }
        this.#reasons.add(key);
        this.element.classList.add(this.className);
    }

    /**
     * Release *reason*; the pulse stops once the last reason is released.
     *
     * Unknown reasons are ignored, so a stop without a matching start is harmless.
     * @param {string} reason Name of the activity that no longer needs the pulse.
     */
    stop(reason: string): void {
        const key = ActivityPulse.#normalizeReason(reason);
        if (!key || !this.#reasons.delete(key)) {
            return;
        }
        if (this.#reasons.size === 0) {
            this.element.classList.remove(this.className);
        }
    }

    /** Release every reason, e.g. when the host is detached or re-rendered. */
    stopAll(): void {
        this.#reasons.clear();
        this.element.classList.remove(this.className);
    }

    /**
     * Trim a reason to its comparable form.
     * @param {string} reason Candidate reason.
     * @returns {string} The trimmed reason, or an empty string when it is unusable.
     */
    static #normalizeReason(reason: string): string {
        return typeof reason === 'string' ? reason.trim() : '';
    }
}
