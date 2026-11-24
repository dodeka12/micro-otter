import { AppPayload } from '../core/app-event.js';

export type SerialConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'disconnecting'
    | 'error';

export type SerialConnectionInfo = object;

export type SerialConnectionLogger = (
    prefix: string,
    message: string,
    data?: unknown
) => void;

export interface SerialConnectionConstructorOptions {
    logger?: SerialConnectionLogger | null;
}

export interface SerialConnectionEventFieldsByName {
    connecting: { options: object };
    connected: { connectionInfo: SerialConnectionInfo | null };
    disconnecting: Record<string, never>;
    disconnected: { reason: string };
    statechange: {
        previousState: SerialConnectionState;
        newState: SerialConnectionState;
        state: SerialConnectionState;
    };
    data: { data: string | Uint8Array; timestamp: number };
    error: {
        error: Error;
        context: string;
        state: SerialConnectionState;
    };
}

export type SerialConnectionEventName = keyof SerialConnectionEventFieldsByName;

/**
 * Error a cancelled `connect()` attempt settles with.
 *
 * The `cancelConnect()` hook rejects the transport's pending `connect()` promise with
 * this error, and `DeviceConnection` / `DeviceConnectionMonitor` use
 * `isConnectCancelled()` to tell a user cancellation apart from a real failure so the
 * badge never latches `error` for it.
 */
export class ConnectCancelledError extends Error {
    constructor(message = 'Connection attempt cancelled') {
        super(message);
        this.name = 'ConnectCancelledError';
    }
}

/**
 * Whether *error* is a cancelled connect attempt.
 *
 * Works across module reloads and structural doubles by checking the `name` rather
 * than `instanceof`, so a same-named error from a different copy of this module still
 * matches.
 * @param error Value to inspect.
 * @returns True when the value represents a cancelled connect.
 */
export function isConnectCancelled(error: unknown): boolean {
    return error instanceof ConnectCancelledError || error instanceof Error && error.name === 'ConnectCancelledError';
}

export const SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES = Object.freeze({
    connecting: 'SerialConnectionBase.Connecting.v1',
    connected: 'SerialConnectionBase.Connected.v1',
    disconnecting: 'SerialConnectionBase.Disconnecting.v1',
    disconnected: 'SerialConnectionBase.Disconnected.v1',
    statechange: 'SerialConnectionBase.StateChanged.v1',
    data: 'SerialConnectionBase.DataReceived.v1',
    error: 'SerialConnectionBase.ErrorOccurred.v1',
} as const);

class SerialConnectionEventPayload extends AppPayload {
    [key: string]: unknown;

    constructor(payloadTypeId: string, fields: object = {}) {
        super(payloadTypeId);
        if (fields && typeof fields === 'object') {
            Object.assign(this, fields);
        }
    }
}

export class SerialConnectionBase extends EventTarget {
    protected _state: SerialConnectionState;
    protected _logger: SerialConnectionLogger | null;
    protected _connectionInfo: SerialConnectionInfo | null;

    constructor(options: SerialConnectionConstructorOptions = {}) {
        super();

        if (new.target === SerialConnectionBase) {
            throw new TypeError(
                'Cannot construct abstract class SerialConnectionBase directly'
            );
        }

        this._state = 'disconnected';
        this._logger = options.logger ?? null;
        this._connectionInfo = null;
    }

    async connect(_options: object = {}): Promise<void> {
        throw new Error(`Method connect() must be implemented by ${this.constructor.name}`);
    }

    async disconnect(): Promise<void> {
        throw new Error(`Method disconnect() must be implemented by ${this.constructor.name}`);
    }

    /**
     * Cancel an in-flight `connect()` attempt.
     *
     * The base implementation is a no-op for transports that cannot be interrupted.
     * A transport that awaits an unbounded operation during `connect()` (for example
     * `navigator.serial.requestPort()` or a WebSocket handshake) must override it to:
     *
     * - release the transport (close the socket/port and clear any pending timers);
     * - settle the pending `connect()` promise with `ConnectCancelledError`;
     * - never emit an `error` event (an error event latches `DeviceConnection` into
     *   its `error` state), and never throw.
     */
    cancelConnect(): void {}

    async send(_data: string | Uint8Array): Promise<void> {
        throw new Error(`Method send() must be implemented by ${this.constructor.name}`);
    }

    isConnected(): boolean {
        return this._state === 'connected';
    }

    getState(): SerialConnectionState {
        return this._state;
    }

    getConnectionInfo(): SerialConnectionInfo | null {
        return this._connectionInfo;
    }

    protected _setState(newState: SerialConnectionState): void {
        const previousState = this._state;
        this._state = newState;

        this._log(`State changed: ${previousState} → ${newState}`);

        this._dispatchSerialEvent('statechange', {
            previousState,
            newState,
            state: newState,
        });
    }

    protected _emitConnecting(options: object = {}): void {
        this._dispatchSerialEvent('connecting', { options });
    }

    protected _emitConnected(connectionInfo: SerialConnectionInfo | null = null): void {
        this._dispatchSerialEvent('connected', { connectionInfo });
    }

    protected _emitDisconnecting(): void {
        this._dispatchSerialEvent('disconnecting', {});
    }

    protected _emitDisconnected(reason: string): void {
        this._dispatchSerialEvent('disconnected', { reason });
    }

    protected _log(message: string, data: unknown = null): void {
        if (this._logger && typeof this._logger === 'function') {
            const prefix = `[${this.constructor.name}]`;
            if (data !== null) {
                this._logger(prefix, message, data);
            } else {
                this._logger(prefix, message);
            }
        }
    }

    protected _emitDataReceived(data: string | Uint8Array): void {
        this._dispatchSerialEvent('data', {
            data,
            timestamp: Date.now(),
        });
    }

    protected _emitError(error: Error, context = 'unknown'): void {
        this._log(`Error in ${context}:`, error);

        this._dispatchSerialEvent('error', {
            error,
            context,
            state: this._state,
        });

        if (this._state !== 'disconnected') {
            this._setState('error');
        }
    }

    protected _dispatchSerialEvent<K extends SerialConnectionEventName>(
        eventName: K,
        fields: SerialConnectionEventFieldsByName[K]
    ): void;
    protected _dispatchSerialEvent(
        eventName: string,
        fields: object = {}
    ): void {
        const payloadTypeId =
            SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES[
                eventName as keyof typeof SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES
            ];
        if (!payloadTypeId) {
            throw new TypeError(
                `SerialConnectionBase._dispatchSerialEvent: unsupported event '${eventName}'`
            );
        }

        this.dispatchEvent(
            new CustomEvent(eventName, {
                detail: new SerialConnectionEventPayload(payloadTypeId, fields),
            })
        );
    }
}
