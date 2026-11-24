// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

type EventHandler<TData = unknown> = (data: TData) => void;

type ListenerSet = Set<EventHandler>;

/**
 * Simple event emitter base class for custom event handling.
 * Similar to Node.js EventEmitter but browser-compatible.
 * 
 * Provides methods for subscribing, unsubscribing, and emitting events.
 * Each event has a name (string) and can carry arbitrary data.
 * 
 * @class
 * @example
 * class MyClass extends EventEmitter {
 *   doSomething() {
 *     this._emit('something-happened', { data: 'value' });
 *   }
 * }
 * 
 * const instance = new MyClass();
 * instance.on('something-happened', (data) => {
 *   logger.info('Event received', data);
 * });
 */
export class EventEmitter {
    protected _listeners: Map<string, ListenerSet>;

    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param event - Event name
     * @param handler - Callback function
     * @returns Unsubscribe function
     */
    on<TData = unknown>(event: string, handler: EventHandler<TData>): () => void {
        if (typeof handler !== 'function') {
            throw new TypeError('Handler must be a function');
        }

        const bucket: ListenerSet = this._listeners.get(event) || new Set();
        bucket.add(handler as EventHandler);
        this._listeners.set(event, bucket);

        return () => this.off(event, handler);
    }

    /**
     * Subscribe to an event and auto-unsubscribe after first call.
     * @param event - Event name
     * @param handler - Callback function
     * @returns Unsubscribe function
     */
    once<TData = unknown>(event: string, handler: EventHandler<TData>): () => void {
        const wrapped: EventHandler<TData> = (data) => {
            this.off(event, wrapped);
            handler(data);
        };
        return this.on(event, wrapped);
    }

    /**
     * Unsubscribe from an event.
     * @param event - Event name
     * @param handler - Handler to remove
     */
    off<TData = unknown>(event: string, handler: EventHandler<TData>): void {
        const bucket = this._listeners.get(event);
        if (bucket) {
            bucket.delete(handler as EventHandler);
            if (bucket.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event to all subscribers.
     * Errors in listeners are caught and logged to prevent breaking other listeners.
     * @param event - Event name
     * @param data - Event data
     */
    protected _emit<TData = unknown>(event: string, data: TData): void {
        const bucket = this._listeners.get(event);
        if (!bucket) {
            return;
        }

        const snapshot = Array.from(bucket);

        for (const handler of snapshot) {
            try {
                (handler as EventHandler<TData>)(data);
            } catch (error) {
                console.error(`EventEmitter: Listener error for event '${event}':`, error);
            }
        }
    }

    /**
     * Remove all listeners for a specific event or all events.
     * @param event - Event name, or undefined to remove all
     */
    removeAllListeners(event?: string): void {
        if (event === undefined) {
            this._listeners.clear();
        } else {
            this._listeners.delete(event);
        }
    }

    /**
     * Get count of listeners for a specific event.
     * @param event - Event name
     * @returns Number of listeners
     */
    listenerCount(event: string): number {
        const bucket = this._listeners.get(event);
        return bucket ? bucket.size : 0;
    }

    /**
     * Get all event names that have listeners.
     * @returns Array of event names
     */
    eventNames(): string[] {
        return Array.from(this._listeners.keys());
    }
}
