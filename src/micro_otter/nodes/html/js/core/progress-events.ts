/**
 * @file Progress event system for tracking application initialization.
 *
 * This module provides a type-safe event system for emitting and subscribing to
 * progress updates during application startup. It includes:
 * - ProgressEventType: Enum of event types (START, UPDATE, COMPLETE, ERROR)
 * - ProgressEvent: Immutable event class with validation
 * - ProgressEventBus: Global event bus for publish/subscribe (to be implemented in Step 1.2)
 * - ProgressTracker: Helper for simplified progress reporting (to be implemented in Step 1.3)
 *
 * @module core/progress-events
 * @copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
 */

/**
 * Progress event types indicating the lifecycle stage of an operation.
 *
 * @enum {string}
 * @readonly
 */
export const ProgressEventType = Object.freeze({
    /**
     * Emitted when an operation begins.
     * Progress should be 0 or undefined.
     */
    START: 'start',

    /**
     * Emitted during an operation to report incremental progress.
     * Progress should be between 0 and 100 (exclusive).
     */
    UPDATE: 'update',

    /**
     * Emitted when an operation finishes successfully.
     * Progress should be 100 or undefined.
     */
    COMPLETE: 'complete',

    /**
     * Emitted when an operation fails or encounters an error.
     * Progress is typically undefined; detail should contain error info.
     */
    ERROR: 'error',
});

export type ProgressEventTypeValue = (typeof ProgressEventType)[keyof typeof ProgressEventType];

export interface ProgressEventConfig {
    source: string;
    type: ProgressEventTypeValue;
    message: string;
    progress?: number;
    detail?: unknown;
    timestamp?: number;
}

export type ProgressEventListener = (event: ProgressEvent) => void;

/**
 * Immutable progress event representing a single update from an initialization source.
 *
 * Events are created with validation to ensure data integrity. Once created,
 * events cannot be modified (all properties are read-only via getters).
 *
 * @class
 * @example
 * // Create a simple start event
 * const event = new ProgressEvent({
 *   source: 'workspace',
 *   type: ProgressEventType.START,
 *   message: 'Initializing workspace...'
 * });
 *
 * @example
 * // Create an update event with progress
 * const event = new ProgressEvent({
 *   source: 'node-packages',
 *   type: ProgressEventType.UPDATE,
 *   message: 'Loading package 3 of 5',
 *   progress: 60
 * });
 *
 * @example
 * // Create an error event with details
 * const event = new ProgressEvent({
 *   source: 'device-runtime',
 *   type: ProgressEventType.ERROR,
 *   message: 'Failed to load device collection',
 *   detail: { error: err, collectionId: 'stdmo-v1' }
 * });
 */
export class ProgressEvent {
    /**
     * @private
     * @type {string}
     */
    #source: string;

    /**
     * @private
     * @type {string}
     */
    #type: ProgressEventTypeValue;

    /**
     * @private
     * @type {string}
     */
    #message: string;

    /**
     * @private
     * @type {number|undefined}
     */
    #progress: number | undefined;

    /**
     * @private
     * @type {any}
     */
    #detail: unknown;

    /**
     * @private
     * @type {number}
     */
    #timestamp: number;

    /**
     * Create a new progress event with validation.
     *
     * @param {Object} config - Event configuration
     * @param {string} config.source - Source identifier (e.g., 'workspace', 'node-packages')
     * @param {string} config.type - Event type from ProgressEventType enum
     * @param {string} config.message - Human-readable progress message
     * @param {number} [config.progress] - Optional progress percentage (0-100)
     * @param {any} [config.detail] - Optional metadata (error objects, IDs, etc.)
     * @param {number} [config.timestamp=Date.now()] - Optional timestamp (auto-generated if omitted)
     * @throws {TypeError} If required fields are missing or invalid
     * @throws {RangeError} If progress is outside 0-100 range
     */
    constructor({ source, type, message, progress, detail, timestamp }: ProgressEventConfig) {
        // Validate required fields
        if (typeof source !== 'string' || source.trim() === '') {
            throw new TypeError('ProgressEvent: source must be a non-empty string');
        }

        if (!Object.values(ProgressEventType).includes(type)) {
            throw new TypeError(
                `ProgressEvent: type must be one of ${Object.values(ProgressEventType).join(', ')} ` +
                    `(got: ${type})`
            );
        }

        if (typeof message !== 'string' || message.trim() === '') {
            throw new TypeError('ProgressEvent: message must be a non-empty string');
        }

        // Validate optional progress field
        if (progress !== undefined) {
            if (typeof progress !== 'number' || isNaN(progress)) {
                throw new TypeError('ProgressEvent: progress must be a number');
            }

            if (progress < 0 || progress > 100) {
                throw new RangeError('ProgressEvent: progress must be between 0 and 100');
            }
        }

        // Validate optional timestamp
        if (timestamp !== undefined) {
            if (typeof timestamp !== 'number' || isNaN(timestamp) || timestamp < 0) {
                throw new TypeError('ProgressEvent: timestamp must be a non-negative number');
            }
        }

        // Store validated values in private fields
        this.#source = source.trim();
        this.#type = type;
        this.#message = message.trim();
        this.#progress = progress;
        this.#detail = detail;
        this.#timestamp = timestamp ?? Date.now();

        // Freeze the instance to make it immutable
        Object.freeze(this);
    }

    /**
     * Get the source identifier for this event.
     * @type {string}
     * @readonly
     */
    get source(): string {
        return this.#source;
    }

    /**
     * Get the event type.
     * @type {string}
     * @readonly
     */
    get type(): ProgressEventTypeValue {
        return this.#type;
    }

    /**
     * Get the human-readable progress message.
     * @type {string}
     * @readonly
     */
    get message(): string {
        return this.#message;
    }

    /**
     * Get the progress percentage (0-100), if available.
     * @type {number|undefined}
     * @readonly
     */
    get progress(): number | undefined {
        return this.#progress;
    }

    /**
     * Get optional metadata/details for this event.
     * @type {any}
     * @readonly
     */
    get detail(): unknown {
        return this.#detail;
    }

    /**
     * Get the timestamp when this event was created (milliseconds since epoch).
     * @type {number}
     * @readonly
     */
    get timestamp(): number {
        return this.#timestamp;
    }

    /**
     * Create a JSON-serializable representation of this event.
     *
     * @returns {Object} Plain object with all event properties
     */
    toJSON(): {
        source: string;
        type: ProgressEventTypeValue;
        message: string;
        progress: number | undefined;
        detail: unknown;
        timestamp: number;
    } {
        return {
            source: this.#source,
            type: this.#type,
            message: this.#message,
            progress: this.#progress,
            detail: this.#detail,
            timestamp: this.#timestamp,
        };
    }

    /**
     * Create a readable string representation of this event.
     *
     * @returns {string} Formatted event string
     */
    toString(): string {
        const progressStr = this.#progress !== undefined ? ` [${this.#progress}%]` : '';
        return `[${this.#type.toUpperCase()}] ${this.#source}${progressStr}: ${this.#message}`;
    }
}

/**
 * Global event bus for progress events (singleton pattern).
 *
 * The ProgressEventBus provides a centralized publish-subscribe system for
 * progress events. Multiple components can emit events, and multiple listeners
 * can subscribe to receive all events.
 *
 * Features:
 * - Singleton pattern ensures single source of truth
 * - Set-based listener management prevents duplicates
 * - Error isolation: one failing listener doesn't affect others
 * - Type validation ensures only ProgressEvent instances are emitted
 * - Thread-safe listener modification during emission
 *
 * @class
 * @example
 * // Subscribe to all progress events
 * const listener = (event) => {
 *   logger.info(event.toString());
 * };
 * ProgressEventBus.subscribe(listener);
 *
 * // Emit an event
 * const event = new ProgressEvent({
 *   source: 'workspace',
 *   type: ProgressEventType.START,
 *   message: 'Initializing...'
 * });
 * ProgressEventBus.emit(event);
 *
 * // Unsubscribe when done
 * ProgressEventBus.unsubscribe(listener);
 */
export class ProgressEventBus {
    /**
     * Set of registered listener functions.
     * Using Set prevents duplicate listeners.
     * @type {Set<Function>}
     * @private
     */
    static #listeners: Set<ProgressEventListener> = new Set();

    /**
     * Singleton instance (created on first access).
     * @type {ProgressEventBus|null}
     * @private
     */
    static #instance: ProgressEventBus | null = null;

    /**
     * Private constructor enforces singleton pattern.
     * Use static methods instead of creating instances.
     * @private
     */
    constructor() {
        if (ProgressEventBus.#instance) {
            throw new Error(
                'ProgressEventBus is a singleton. Use static methods instead of constructor.'
            );
        }
        ProgressEventBus.#instance = this;
    }

    /**
     * Subscribe a listener function to receive progress events.
     *
     * Listeners are called synchronously when events are emitted.
     * If a listener throws an error, it is caught and logged, but other
     * listeners continue to receive the event.
     *
     * Duplicate subscriptions are ignored (idempotent operation).
     *
     * @param {Function} listener - Callback function that receives ProgressEvent instances
     * @throws {TypeError} If listener is not a function
     * @example
     * ProgressEventBus.subscribe((event) => {
     *   if (event.type === ProgressEventType.ERROR) {
     *     console.error('Progress error:', event.message);
     *   }
     * });
     */
    static subscribe(listener: ProgressEventListener): void {
        if (typeof listener !== 'function') {
            throw new TypeError('ProgressEventBus.subscribe: listener must be a function');
        }
        this.#listeners.add(listener);
    }

    /**
     * Unsubscribe a listener function from progress events.
     *
     * If the listener is not currently subscribed, this is a no-op.
     *
     * @param {Function} listener - The callback function to remove
     * @returns {boolean} True if listener was removed, false if it wasn't subscribed
     * @example
     * const listener = (event) => logger.info(event);
     * ProgressEventBus.subscribe(listener);
     * // Later...
     * const wasRemoved = ProgressEventBus.unsubscribe(listener); // true
     */
    static unsubscribe(listener: ProgressEventListener): boolean {
        return this.#listeners.delete(listener);
    }

    /**
     * Emit a progress event to all subscribed listeners.
     *
     * Listeners are called synchronously in registration order. If a listener
     * throws an error, the error is caught, logged to console, and subsequent
     * listeners continue to execute.
     *
     * Events are validated to ensure they are ProgressEvent instances.
     *
     * @param {ProgressEvent} event - The event to emit
     * @throws {TypeError} If event is not a ProgressEvent instance
     * @example
     * const event = new ProgressEvent({
     *   source: 'node-packages',
     *   type: ProgressEventType.UPDATE,
     *   message: 'Loaded 3 of 5 packages',
     *   progress: 60
     * });
     * ProgressEventBus.emit(event);
     */
    static emit(event: ProgressEvent): void {
        if (!(event instanceof ProgressEvent)) {
            throw new TypeError('ProgressEventBus.emit: event must be a ProgressEvent instance');
        }

        // Create a snapshot of listeners to allow modification during emission
        // This prevents issues if a listener unsubscribes itself or others
        const listenerSnapshot = Array.from(this.#listeners);

        for (const listener of listenerSnapshot) {
            try {
                listener(event);
            } catch (error) {
                // Isolate listener errors - log and continue
                console.error(
                    `ProgressEventBus: Listener error for event ${event.toString()}`,
                    error
                );
            }
        }
    }

    /**
     * Get the current number of subscribed listeners.
     * Primarily useful for testing and debugging.
     *
     * @returns {number} Number of active listeners
     */
    static getListenerCount(): number {
        return this.#listeners.size;
    }

    /**
     * Remove all listeners (primarily for testing).
     * Use with caution in production code.
     *
     * @internal
     */
    static clearAllListeners(): void {
        this.#listeners.clear();
    }
}

/**
 * Helper class to simplify progress reporting for initialization operations.
 *
 * ProgressTracker wraps the event bus and provides convenient methods for
 * emitting progress events with automatic progress calculation. It's designed
 * for operations that have a known number of steps or continuous progress.
 *
 * Features:
 * - Automatic progress percentage calculation (if totalSteps provided)
 * - Simple API: start(), update(), complete(), error()
 * - Consistent event formatting with source tagging
 * - Step tracking and validation
 * - Direct integration with ProgressEventBus
 *
 * @class
 * @example
 * // Simple usage without step tracking
 * const tracker = new ProgressTracker('workspace');
 * tracker.start('Initializing workspace...');
 * tracker.update('Loading configuration...');
 * tracker.complete('Workspace ready');
 *
 * @example
 * // Usage with automatic progress calculation
 * const tracker = new ProgressTracker('node-packages', 5);
 * tracker.start('Loading packages...');
 * tracker.update('Loaded core package', 1);      // 20%
 * tracker.update('Loaded ui package', 2);        // 40%
 * tracker.update('Loaded devices package', 3);   // 60%
 * tracker.update('Loaded runtime package', 4);   // 80%
 * tracker.update('Loaded utils package', 5);     // 100%
 * tracker.complete('All packages loaded');
 *
 * @example
 * // Error handling
 * const tracker = new ProgressTracker('device-runtime');
 * tracker.start('Loading device collections...');
 * try {
 *   // ... operation that might fail
 * } catch (err) {
 *   tracker.error('Failed to load collections', err);
 * }
 */
export class ProgressTracker {
    /**
     * Source identifier for all events from this tracker.
     * @type {string}
     * @private
     */
    #source: string;

    /**
     * Total number of steps (optional, for automatic progress calculation).
     * @type {number|undefined}
     * @private
     */
    #totalSteps: number | undefined;

    /**
     * Current step number (tracked internally).
     * @type {number}
     * @private
     */
    #currentStep: number;

    /**
     * Whether the tracker has been started.
     * @type {boolean}
     * @private
     */
    #started: boolean;

    /**
     * Whether the tracker has been completed or errored.
     * @type {boolean}
     * @private
     */
    #finished: boolean;

    /**
     * Create a new progress tracker.
     *
     * @param {string} source - Source identifier (e.g., 'workspace', 'node-packages')
     * @param {number} [totalSteps] - Optional total number of steps for automatic progress calculation
     * @throws {TypeError} If source is not a non-empty string
     * @throws {TypeError} If totalSteps is provided but not a positive number
     */
    constructor(source: string, totalSteps?: number) {
        if (typeof source !== 'string' || source.trim() === '') {
            throw new TypeError('ProgressTracker: source must be a non-empty string');
        }

        if (totalSteps !== undefined) {
            if (typeof totalSteps !== 'number' || isNaN(totalSteps) || totalSteps <= 0) {
                throw new TypeError('ProgressTracker: totalSteps must be a positive number');
            }
        }

        this.#source = source.trim();
        this.#totalSteps = totalSteps;
        this.#currentStep = 0;
        this.#started = false;
        this.#finished = false;
    }

    /**
     * Emit a START event to indicate the operation has begun.
     *
     * This should be called once at the beginning of the operation.
     * Multiple calls will emit multiple START events (for re-startable operations).
     *
     * @param {string} message - Human-readable start message
     * @param {any} [detail] - Optional metadata
     * @throws {TypeError} If message is not a string
     * @example
     * tracker.start('Loading workspace configuration...');
     */
    start(message: string, detail?: unknown): void {
        if (typeof message !== 'string') {
            throw new TypeError('ProgressTracker.start: message must be a string');
        }

        this.#started = true;
        this.#finished = false;
        this.#currentStep = 0;

        const event = new ProgressEvent({
            source: this.#source,
            type: ProgressEventType.START,
            message,
            progress: 0,
            detail,
        });

        ProgressEventBus.emit(event);
    }

    /**
     * Emit an UPDATE event to report progress.
     *
     * If totalSteps was provided in constructor, progress is calculated automatically
     * based on the step parameter. Otherwise, progress can be provided explicitly.
     *
     * @param {string} message - Human-readable progress message
     * @param {number} [step] - Current step number (for auto-calculation) or explicit progress (0-100)
     * @param {any} [detail] - Optional metadata
     * @throws {TypeError} If message is not a string
     * @throws {RangeError} If step/progress is outside valid range
     * @example
     * // With totalSteps (automatic calculation)
     * tracker.update('Processing item', 3); // Progress calculated from step
     *
     * @example
     * // Without totalSteps (explicit progress)
     * tracker.update('Processing...', 45); // 45% progress
     */
    update(message: string, step?: number, detail?: unknown): void {
        if (typeof message !== 'string') {
            throw new TypeError('ProgressTracker.update: message must be a string');
        }

        let progress: number | undefined;

        if (step !== undefined) {
            if (typeof step !== 'number' || isNaN(step)) {
                throw new TypeError('ProgressTracker.update: step must be a number');
            }

            if (this.#totalSteps !== undefined) {
                // Automatic progress calculation based on steps
                if (step < 0 || step > this.#totalSteps) {
                    throw new RangeError(
                        `ProgressTracker.update: step must be between 0 and ${this.#totalSteps}`
                    );
                }
                this.#currentStep = step;
                // Calculate percentage (avoid division by zero)
                progress = this.#totalSteps > 0 ? Math.round((step / this.#totalSteps) * 100) : 0;
            } else {
                // Direct progress percentage
                if (step < 0 || step > 100) {
                    throw new RangeError(
                        'ProgressTracker.update: progress must be between 0 and 100'
                    );
                }
                progress = step;
            }
        }

        const event = new ProgressEvent({
            source: this.#source,
            type: ProgressEventType.UPDATE,
            message,
            progress,
            detail,
        });

        ProgressEventBus.emit(event);
    }

    /**
     * Emit a COMPLETE event to indicate successful completion.
     *
     * This marks the operation as finished and should be called once at the end.
     *
     * @param {string} message - Human-readable completion message
     * @param {any} [detail] - Optional metadata
     * @throws {TypeError} If message is not a string
     * @example
     * tracker.complete('Workspace initialization complete');
     */
    complete(message: string, detail?: unknown): void {
        if (typeof message !== 'string') {
            throw new TypeError('ProgressTracker.complete: message must be a string');
        }

        this.#finished = true;

        const event = new ProgressEvent({
            source: this.#source,
            type: ProgressEventType.COMPLETE,
            message,
            progress: 100,
            detail,
        });

        ProgressEventBus.emit(event);
    }

    /**
     * Emit an ERROR event to indicate operation failure.
     *
     * This marks the operation as finished (with error) and should be called
     * when an unrecoverable error occurs.
     *
     * @param {string} message - Human-readable error message
     * @param {Error|any} [error] - Optional error object or additional details
     * @throws {TypeError} If message is not a string
     * @example
     * try {
     *   // ... operation
     * } catch (err) {
     *   tracker.error('Failed to load configuration', err);
     * }
     */
    error(message: string, error?: unknown): void {
        if (typeof message !== 'string') {
            throw new TypeError('ProgressTracker.error: message must be a string');
        }

        this.#finished = true;

        const detail = error !== undefined ? { error } : undefined;

        const event = new ProgressEvent({
            source: this.#source,
            type: ProgressEventType.ERROR,
            message,
            detail,
        });

        ProgressEventBus.emit(event);
    }

    /**
     * Get the source identifier for this tracker.
     * @type {string}
     * @readonly
     */
    get source(): string {
        return this.#source;
    }

    /**
     * Get the total number of steps (if configured).
     * @type {number|undefined}
     * @readonly
     */
    get totalSteps(): number | undefined {
        return this.#totalSteps;
    }

    /**
     * Get the current step number.
     * @type {number}
     * @readonly
     */
    get currentStep(): number {
        return this.#currentStep;
    }

    /**
     * Check if the tracker has been started.
     * @type {boolean}
     * @readonly
     */
    get isStarted(): boolean {
        return this.#started;
    }

    /**
     * Check if the tracker has finished (completed or errored).
     * @type {boolean}
     * @readonly
     */
    get isFinished(): boolean {
        return this.#finished;
    }
}
