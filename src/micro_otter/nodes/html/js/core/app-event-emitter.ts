import { AppEvent, AppPayload } from './app-event.js';

type AppEventListener<TPayload extends AppPayload = AppPayload> = (
    event: AppEvent<TPayload>
) => void;

type AppListenerSet = Set<AppEventListener>;

/**
 * Shared internal event emitter base for app-domain event contracts.
 *
 * Canonical API:
 * - emit(eventName, payload)
 * - on(eventName, listener)
 * - off(eventName, listener)
 * - once(eventName, listener)
 *
 */
export class AppEventEmitter {
    private readonly _listeners: Map<string, AppListenerSet>;

    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event name.
     *
     * @param eventName
     * @param listener
     * @returns Unsubscribe function.
     */
    on<TPayload extends AppPayload = AppPayload>(
        eventName: string,
        listener: AppEventListener<TPayload>
    ): () => void {
        this.#assertEventName(eventName);
        if (typeof listener !== 'function') {
            throw new TypeError('AppEventEmitter.on requires listener to be a function');
        }

        const bucket: AppListenerSet = this._listeners.get(eventName) || new Set();
        bucket.add(listener as AppEventListener);
        this._listeners.set(eventName, bucket);
        return () => this.off(eventName, listener);
    }

    /**
     * Subscribe to an event and auto-unsubscribe after first invocation.
     *
     * @param eventName
     * @param listener
     * @returns Unsubscribe function.
     */
    once<TPayload extends AppPayload = AppPayload>(
        eventName: string,
        listener: AppEventListener<TPayload>
    ): () => void {
        this.#assertEventName(eventName);
        if (typeof listener !== 'function') {
            throw new TypeError('AppEventEmitter.once requires listener to be a function');
        }

        const wrapped: AppEventListener<TPayload> = (event) => {
            this.off(eventName, wrapped);
            listener(event);
        };
        return this.on(eventName, wrapped);
    }

    /**
     * Unsubscribe a previously registered listener.
     *
     * @param eventName
     * @param listener
     */
    off<TPayload extends AppPayload = AppPayload>(
        eventName: string,
        listener: AppEventListener<TPayload>
    ): void {
        this.#assertEventName(eventName);
        const bucket = this._listeners.get(eventName);
        if (!bucket) {
            return;
        }
        bucket.delete(listener as AppEventListener);
        if (bucket.size === 0) {
            this._listeners.delete(eventName);
        }
    }

    /**
     * Remove all listeners for a specific event or for all events.
     *
     * @param eventName
     */
    removeAllListeners(eventName: string | null = null): void {
        if (eventName === null) {
            this._listeners.clear();
            return;
        }

        this.#assertEventName(eventName);
        this._listeners.delete(eventName);
    }

    /**
     * Emit an event envelope to listeners.
     *
     * @param eventName
     * @param payload
     * @returns Event envelope.
     */
    emit<TPayload extends AppPayload>(eventName: string, payload: TPayload): AppEvent<TPayload> {
        this.#assertEventName(eventName);
        if (!(payload instanceof AppPayload)) {
            throw new TypeError('AppEventEmitter.emit requires payload to be an AppPayload instance');
        }

        const event = new AppEvent(eventName, payload);
        this.#dispatch(eventName, event);
        this.#dispatch('*', event);
        return event;
    }

    #dispatch<TPayload extends AppPayload>(eventName: string, event: AppEvent<TPayload>): void {
        const bucket = this._listeners.get(eventName);
        if (!bucket || bucket.size === 0) {
            return;
        }

        const snapshot = Array.from(bucket);
        for (const listener of snapshot) {
            (listener as AppEventListener<TPayload>)(event);
        }
    }

    #assertEventName(eventName: string): void {
        if (!eventName || typeof eventName !== 'string') {
            throw new TypeError('AppEventEmitter requires eventName to be a non-empty string');
        }
    }
}