/**
 * WebSerial connection implementation using browser Web Serial API.
 * Extends SerialConnectionBase to provide USB serial communication with devices.
 *
 * Browser Support:
 * - Chrome/Chromium 89+ ✅
 * - Edge 89+ ✅
 * - Firefox ❌
 * - Safari ❌
 *
 * @extends SerialConnectionBase
 *
 * @example
 * // Check browser support
 * if (!WebSerialConnection.isAvailable()) {
 *     alert('Web Serial API not supported. Use Chrome or Edge.');
 * }
 *
 * // Create connection
 * const connection = new WebSerialConnection({ logger: console.log });
 *
 * // Subscribe to events
 * connection.addEventListener('connected', (e) => {
 *     logger.info('Connected', e.detail.connectionInfo);
 * });
 *
 * connection.addEventListener('data', (e) => {
 *     const decoder = new TextDecoder();
 *     const text = decoder.decode(e.detail.data);
 *     logger.info('Received', text);
 * });
 *
 * // Connect (user selects port)
 * await connection.connect({ baudRate: 115200 });
 *
 * // Send data
 * await connection.send('print("hello")\r\n');
 *
 * // Disconnect
 * await connection.disconnect();
 */
import { ConnectCancelledError, SerialConnectionBase } from './serial-connection-base.js';

type SerialParity = 'none' | 'even' | 'odd';
type SerialFlowControl = 'none' | 'hardware';

interface WebSerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
}

interface WebSerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
}

interface SerialOpenOptions {
    baudRate: number;
    dataBits: 7 | 8;
    stopBits: 1 | 2;
    parity: SerialParity;
    flowControl: SerialFlowControl;
    bufferSize: number;
}

interface ConnectOptions {
    baudRate?: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: SerialParity;
    flowControl?: SerialFlowControl;
    bufferSize?: number;
    filters?: WebSerialPortFilter[];
}

interface WebSerialPort {
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    open(options: SerialOpenOptions): Promise<void>;
    close(): Promise<void>;
    getInfo(): WebSerialPortInfo;
}

interface WebSerialApi {
    getPorts(): Promise<WebSerialPort[]>;
    requestPort(options?: { filters?: WebSerialPortFilter[] }): Promise<WebSerialPort>;
    addEventListener(type: 'disconnect', listener: (event: Event) => void): void;
}

interface NavigatorWithSerial extends Navigator {
    serial: WebSerialApi;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

/**
 * Ceiling for `port.open()`, matching `WebSocketConnection`'s readiness timeout.
 *
 * Some drivers never settle `open()` on a port the host cannot actually reach; the
 * timeout turns that hang into a `connect()` rejection the user can act on.
 */
const SERIAL_OPEN_TIMEOUT_MS = 15000;

/**
 * One in-flight `connect()` attempt.
 *
 * `connect()` keeps at most one of these: a second call while one is pending joins
 * the existing `promise`. `cancelConnect()` flips `cancelled` and rejects the caller
 * immediately, while `_runConnect()` checks `cancelled` after each unbounded await so
 * a late port from the user's picker is released instead of used.
 */
interface WebSerialConnectAttempt {
    /** Whether `cancelConnect()` tore this attempt down. */
    cancelled: boolean;
    /** Rejects the cancellation promise `connect()` races against. */
    reject: (error: Error) => void;
    /** The promise `connect()` returns and a joining caller awaits. */
    promise: Promise<void>;
}

export class WebSerialConnection extends SerialConnectionBase {
    private _port: WebSerialPort | null;
    private _reader: ReadableStreamDefaultReader<Uint8Array> | null;
    private _writer: WritableStreamDefaultWriter<Uint8Array> | null;
    private _readLoopAbortController: AbortController | null;
    private _defaultFilters: WebSerialPortFilter[];
    private _options: SerialOpenOptions | null;
    private _connectAttempt: WebSerialConnectAttempt | null;

    constructor(
        options: {
            logger?: (...args: unknown[]) => void;
            filters?: WebSerialPortFilter[];
        } = {}
    ) {
        super(options);
        this._port = null;
        this._reader = null;
        this._writer = null;
        this._readLoopAbortController = null;
        this._defaultFilters = options.filters || [
            { usbVendorId: 0x10c4 },
            { usbVendorId: 0x1a86 },
            { usbVendorId: 0x0403 },
            { usbVendorId: 0x067b },
            { usbVendorId: 0x2341 },
        ];
        this._options = null;
        this._connectAttempt = null;
    }

    static isAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    async connect(options: ConnectOptions = {}): Promise<void> {
        if (!WebSerialConnection.isAvailable()) {
            const error = new Error('Web Serial API not supported in this browser');
            this._emitError(error, 'connect');
            throw error;
        }

        if (this.isConnected()) {
            this._log('Already connected, ignoring connect request');
            return;
        }

        // A second connect while one is pending joins the existing attempt instead of
        // opening the user's port picker twice (which would orphan the first promise).
        if (this._connectAttempt) {
            this._log('Connect already in progress, joining the existing attempt');
            return this._connectAttempt.promise;
        }

        const attempt: WebSerialConnectAttempt = {
            cancelled: false,
            reject: () => {},
            promise: null as unknown as Promise<void>,
        };

        const cancelled = new Promise<never>((_, reject) => {
            attempt.reject = reject;
        });

        const run = this._runConnect(options, attempt);
        const promise = Promise.race([run, cancelled]).finally(() => {
            if (this._connectAttempt === attempt) {
                this._connectAttempt = null;
            }
        });
        attempt.promise = promise;
        this._connectAttempt = attempt;
        return promise;
    }

    /**
     * Perform one connect attempt, stopping at the first cancelled checkpoint.
     *
     * `cancelConnect()` rejects the race in `connect()` immediately, but this routine
     * keeps running until the next await resolves; each checkpoint prevents a late
     * `requestPort()`/`open()` result from turning into a live connection after the
     * user cancelled.
     * @param options Connect options.
     * @param attempt Attempt record carrying the cancellation flag.
     * @private
     */
    private async _runConnect(
        options: ConnectOptions,
        attempt: WebSerialConnectAttempt
    ): Promise<void> {
        this._setState('connecting');
        this._emitConnecting(options);

        try {
            const config: SerialOpenOptions = {
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none',
                bufferSize: 4096,
                ...options,
            };

            this._options = config;

            try {
                const serialNavigator = navigator as NavigatorWithSerial;
                const cachedPorts = await serialNavigator.serial.getPorts();
                this._log(`Found ${cachedPorts.length} cached ports, closing all`);
                for (const port of cachedPorts) {
                    try {
                        await port.close();
                        this._log('Closed cached port');
                    } catch (e: unknown) {
                        this._log('Could not close cached port (might already be closed)', e);
                    }
                }
                if (cachedPorts.length > 0) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 100));
                }
            } catch (error: unknown) {
                this._log('Error checking/closing cached ports (ignoring)', error);
            }

            this._log('Requesting serial port from user');
            const filters = options.filters || this._defaultFilters;
            const port = await this._requestPort(filters);

            if (attempt.cancelled) {
                // Cancel arrived while the picker was open; release the late port.
                try {
                    await port.close();
                } catch (error: unknown) {
                    this._log('Failed to close a port chosen after cancel', error);
                }
                throw new ConnectCancelledError();
            }

            this._port = port;
            this._log('Port state after request:', {
                hasReadable: !!this._port.readable,
                hasWritable: !!this._port.writable,
                portInfo: this._port.getInfo(),
            });

            this._log('Opening port', config);
            await this._openPort(config);

            if (attempt.cancelled) {
                throw new ConnectCancelledError();
            }

            this._log('Starting read loop');
            this._startReadLoop();

            const portInfo = this._port.getInfo();
            this._connectionInfo = {
                type: 'webserial',
                usbVendorId: portInfo.usbVendorId,
                usbProductId: portInfo.usbProductId,
                ...config,
            };

            this._setState('connected');
            this._emitConnected(this._connectionInfo);

            this._log('Connection established', this._connectionInfo);
        } catch (error: unknown) {
            if (attempt.cancelled) {
                // `cancelConnect()` owns the teardown and the final state; a user
                // cancellation is not a failure to report.
                throw error;
            }
            this._log('Connection failed', error);
            await this._cleanup();
            this._emitError(asError(error), 'connect');
            throw error;
        }
    }

    /**
     * Cancel an in-flight `connect()` attempt.
     *
     * Rejects the caller immediately with `ConnectCancelledError`, marks the attempt
     * cancelled so `_runConnect()` releases any port the picker later returns, and
     * best-effort cleans up an already-open port. A no-op when no attempt is in flight.
     */
    cancelConnect(): void {
        const attempt = this._connectAttempt;
        if (!attempt) {
            return;
        }

        attempt.cancelled = true;
        this._connectAttempt = null;
        attempt.reject(new ConnectCancelledError());

        void this._cleanup().catch((error: unknown) => {
            this._log('cancel cleanup failed', error);
        });

        this._setState('disconnected');
    }

    async disconnect(): Promise<void> {
        // A disconnect while the handshake is still running is a cancel: the attempt
        // owns the teardown and cancelConnect() already settles on `disconnected`.
        if (this._connectAttempt) {
            this.cancelConnect();
            return;
        }

        if (!this.isConnected() && !this._port) {
            this._log('Not connected, ignoring disconnect request');
            return;
        }

        try {
            this._setState('disconnecting');
            this._emitDisconnecting();

            this._log('Disconnecting');
            await this._cleanup();

            this._setState('disconnected');
            this._emitDisconnected('user');

            this._log('Disconnected');
        } catch (error: unknown) {
            this._log('Disconnect error', error);
            this._emitError(asError(error), 'disconnect');
            throw error;
        }
    }

    async send(data: string | Uint8Array): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Cannot send: not connected');
        }

        if (!this._writer) {
            throw new Error('Cannot send: writer not available');
        }

        try {
            let bytes: Uint8Array;
            if (typeof data === 'string') {
                const encoder = new TextEncoder();
                bytes = encoder.encode(data);
            } else if (data instanceof Uint8Array) {
                bytes = data;
            } else {
                throw new TypeError('Data must be string or Uint8Array');
            }

            this._log(`Sending ${bytes.length} bytes`);
            await this._writer.write(bytes);
        } catch (error: unknown) {
            this._log('Send error', error);

            if (errorName(error) === 'NetworkError') {
                this._handlePortDisconnect();
            }

            this._emitError(asError(error), 'send');
            throw error;
        }
    }

    private async _requestPort(filters: WebSerialPortFilter[]): Promise<WebSerialPort> {
        try {
            const serialNavigator = navigator as NavigatorWithSerial;
            const port = await serialNavigator.serial.requestPort({ filters });

            serialNavigator.serial.addEventListener('disconnect', (event: Event) => {
                const disconnectTarget = event.target as unknown;
                if (disconnectTarget === port) {
                    this._handlePortDisconnect();
                }
            });

            return port;
        } catch (error: unknown) {
            if (errorName(error) === 'NotFoundError') {
                this._log('User cancelled port selection');
            }
            throw error;
        }
    }

    private async _openPort(config: SerialOpenOptions): Promise<void> {
        if (!this._port) {
            throw new Error('Cannot open port: no port selected');
        }

        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            await Promise.race([
                this._port.open({
                    baudRate: config.baudRate,
                    dataBits: config.dataBits,
                    stopBits: config.stopBits,
                    parity: config.parity,
                    flowControl: config.flowControl,
                    bufferSize: config.bufferSize,
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('Timed out opening the serial port')),
                        SERIAL_OPEN_TIMEOUT_MS
                    );
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }

        if (!this._port.readable || !this._port.writable) {
            throw new Error('Port streams unavailable after open');
        }

        this._reader = this._port.readable.getReader();
        this._writer = this._port.writable.getWriter();
    }

    private _startReadLoop(): void {
        this._readLoopAbortController = new AbortController();
        const signal: AbortSignal = this._readLoopAbortController.signal;

        void (async () => {
            try {
                const decoder = new TextDecoder();

                while (!signal.aborted) {
                    if (!this._reader) {
                        break;
                    }

                    const { value, done }: ReadableStreamReadResult<Uint8Array> =
                        await this._reader.read();

                    if (done) {
                        this._log('Read stream closed');
                        break;
                    }

                    if (signal.aborted || !value) {
                        break;
                    }

                    this._emitDataReceived(value);

                    try {
                        const text = decoder.decode(value, { stream: true });
                        if (text) {
                            this._log(`Received: ${text.length} chars`);
                        }
                    } catch {
                        // Ignore decode errors, emit raw bytes only
                    }
                }
            } catch (error: unknown) {
                if (!signal.aborted) {
                    this._log('Read loop error', error);
                    this._handlePortDisconnect();
                }
            }
        })();
    }

    private async _stopReadLoop(): Promise<void> {
        if (this._readLoopAbortController) {
            this._readLoopAbortController.abort();
            this._readLoopAbortController = null;
        }

        if (this._reader) {
            try {
                await this._reader.cancel();
            } catch (error: unknown) {
                this._log('Reader cancel error', error);
            }

            try {
                this._reader.releaseLock();
            } catch (error: unknown) {
                this._log('Reader release error', error);
            }

            this._reader = null;
        }
    }

    private async _cleanup(): Promise<void> {
        await this._stopReadLoop();

        if (this._writer) {
            try {
                this._writer.releaseLock();
            } catch (error: unknown) {
                this._log('Writer release error', error);
            }
            this._writer = null;
        }

        if (this._port) {
            try {
                await this._port.close();
            } catch (error: unknown) {
                this._log('Port close error', error);
            }
            this._port = null;
        }

        this._connectionInfo = null;
        this._options = null;
    }

    private _handlePortDisconnect(): void {
        if (this.getState() === 'disconnected') {
            return;
        }

        this._log('Port disconnected unexpectedly');

        this._cleanup()
            .then(() => {
                this._setState('disconnected');
                this._emitDisconnected('device-disconnect');
            })
            .catch((error: unknown) => {
                this._log('Cleanup error after disconnect', error);
                this._setState('error');
            });
    }
}
