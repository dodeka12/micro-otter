// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * WebSocket serial bridge connection.
 *
 * Connects to the local serial bridge (`serial_bridge.py`) and pipes raw bytes,
 * mirroring `WebSerialConnection`'s role in `DeviceConnection`. The bridge is a
 * dumb byte pipe: the MicroPython raw-REPL protocol stays in `DeviceConnection`.
 *
 * Wire protocol (see `docs/dev/device-communication/websocket-serial-bridge.md`):
 * - WebSocket binary frames carry raw serial bytes in both directions.
 * - A single text JSON frame is sent server -> client on connect:
 *   `{"type":"ready"}` or `{"type":"error","message":"..."}`.
 */

import { ConnectCancelledError, SerialConnectionBase } from './serial-connection-base.js';

interface WebSocketConnectOptions {
    url?: string;
    host?: string;
    port?: number;
    device?: string;
    baudRate?: number;
}

const CONNECT_READY_TIMEOUT_MS = 15000;

/**
 * One in-flight `connect()` attempt.
 *
 * `connect()` keeps at most one of these: a second call while one is pending joins
 * the existing `promise` instead of opening a second socket. `cancelConnect()` clears
 * `cancelled` first so the socket's late `close`/`ready` frames are ignored.
 */
interface WebSocketConnectAttempt {
    /** Socket this attempt opened. */
    socket: WebSocket;
    /** Whether the attempt already settled (resolved or rejected). */
    settled: boolean;
    /** Whether `cancelConnect()` tore this attempt down. */
    cancelled: boolean;
    /** Settling resolve/reject of the connect promise. */
    resolve: () => void;
    reject: (error: Error) => void;
    /** Readiness timeout timer. */
    timer: ReturnType<typeof setTimeout>;
    /** The promise `connect()` returns and a joining caller awaits. */
    promise: Promise<void>;
}

export class WebSocketConnection extends SerialConnectionBase {
    private _socket: WebSocket | null;
    private _connectAttempt: WebSocketConnectAttempt | null;

    constructor(options: { logger?: (...args: unknown[]) => void; url?: string } = {}) {
        super(options);
        this._socket = null;
        this._connectAttempt = null;
    }

    static isAvailable(): boolean {
        return typeof WebSocket !== 'undefined';
    }

    async connect(options: WebSocketConnectOptions = {}): Promise<void> {
        if (!WebSocketConnection.isAvailable()) {
            const error = new Error('WebSocket not supported in this environment');
            this._emitError(error, 'connect');
            throw error;
        }

        if (this.isConnected()) {
            this._log('Already connected, ignoring connect request');
            return;
        }

        // A second connect while one is pending joins the existing attempt instead of
        // opening a second socket (which would orphan the first attempt's promise).
        if (this._connectAttempt) {
            this._log('Connect already in progress, joining the existing attempt');
            return this._connectAttempt.promise;
        }

        this._setState('connecting');
        this._emitConnecting(options);

        const url = this._buildUrl(options);

        const attempt: WebSocketConnectAttempt = {
            socket: null as unknown as WebSocket,
            settled: false,
            cancelled: false,
            resolve: () => {},
            reject: () => {},
            timer: null as unknown as ReturnType<typeof setTimeout>,
            promise: null as unknown as Promise<void>,
        };

        const promise = new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(url);
            socket.binaryType = 'arraybuffer';
            this._socket = socket;
            attempt.socket = socket;
            let opened = false;

            const settle = (fn: () => void) => {
                if (attempt.settled) {
                    return;
                }
                attempt.settled = true;
                clearTimeout(attempt.timer);
                if (this._connectAttempt === attempt) {
                    this._connectAttempt = null;
                }
                fn();
            };

            attempt.resolve = () => settle(resolve);
            attempt.reject = (error: Error) => settle(() => reject(error));

            attempt.timer = setTimeout(() => {
                const error = new Error(
                    'Timed out waiting for the serial bridge to become ready'
                );
                this._emitError(error, 'connect');
                attempt.reject(error);
            }, CONNECT_READY_TIMEOUT_MS);

            socket.addEventListener('open', () => {
                opened = true;
                this._log('WebSocket opened; waiting for serial bridge ready', url);
            });

            socket.addEventListener('message', (event: MessageEvent) => {
                this._onMessage(event);
            });

            socket.addEventListener('error', () => {
                this._log('WebSocket error', url);
            });

            socket.addEventListener('close', (event: CloseEvent) => {
                const wasOpened = opened;
                this._socket = null;

                // `cancelConnect()` owns the teardown for a cancelled attempt; the
                // close frame it produces must not double-report a failure.
                if (attempt.cancelled) {
                    return;
                }

                if (!wasOpened) {
                    const error = new Error(
                        `WebSocket connection failed (${event.code ?? 'no code'})`
                    );
                    this._emitError(error, 'connect');
                    attempt.reject(error);
                    return;
                }

                if (!attempt.settled) {
                    const error = new Error(
                        'Serial bridge closed before the serial port was ready'
                    );
                    this._emitError(error, 'connect');
                    attempt.reject(error);
                    return;
                }

                if (this.getState() !== 'disconnected' && this.getState() !== 'disconnecting') {
                    this._setState('disconnected');
                    this._emitDisconnected('device-disconnect');
                }
            });
        });

        attempt.promise = promise;
        this._connectAttempt = attempt;
        return promise;
    }

    /**
     * Cancel an in-flight `connect()` attempt.
     *
     * Clears the attempt (and the socket reference) before closing the socket so the
     * resulting `close`/`ready` frames are ignored, then settles the pending promise
     * with `ConnectCancelledError` and reports the transport as `disconnected`. A no-op
     * when no attempt is in flight.
     */
    cancelConnect(): void {
        const attempt = this._connectAttempt;
        if (!attempt) {
            return;
        }

        attempt.cancelled = true;
        this._connectAttempt = null;
        this._socket = null;
        clearTimeout(attempt.timer);
        attempt.reject(new ConnectCancelledError());

        if (
            attempt.socket.readyState === WebSocket.CONNECTING ||
            attempt.socket.readyState === WebSocket.OPEN
        ) {
            attempt.socket.close();
        }

        this._setState('disconnected');
    }

    async disconnect(): Promise<void> {
        // A disconnect while the handshake is still running must settle that promise
        // too; cancelConnect() releases the socket and rejects it.
        if (this._connectAttempt) {
            this.cancelConnect();
        }

        const socket = this._socket;
        if (!socket) {
            this._log('Not connected, ignoring disconnect request');
            return;
        }

        this._setState('disconnecting');
        this._emitDisconnecting();

        this._socket = null;
        socket.close();

        this._setState('disconnected');
        this._emitDisconnected('user');

        this._log('Disconnected');
    }

    async send(data: string | Uint8Array): Promise<void> {
        const socket = this._socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error('Cannot send: not connected');
        }

        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this._log(`Sending ${bytes.length} bytes`);
        socket.send(bytes);
    }

    private _buildUrl(options: WebSocketConnectOptions): string {
        if (options.url) {
            return options.url;
        }

        const device = options.device ?? '/dev/ttyACM0';
        const baudRate = options.baudRate ?? 115200;
        const query = `port=${encodeURIComponent(device)}&baud=${baudRate}`;

        if (options.host) {
            const port = options.port ?? 8000;
            return `ws://${options.host}:${port}/serial?${query}`;
        }

        // Same-origin, but force IPv4 loopback: `localhost` can resolve to `::1` while the
        // server binds `0.0.0.0`, which breaks WebSocket upgrades (HTTP falls back, WS doesn't).
        if (typeof window !== 'undefined' && window.location) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host =
                window.location.hostname === 'localhost'
                    ? '127.0.0.1'
                    : window.location.hostname;
            const port = window.location.port ? `:${window.location.port}` : '';
            return `${protocol}//${host}${port}/serial?${query}`;
        }

        // Fallback (non-browser environments): relative to the app origin.
        return `/serial?${query}`;
    }

    private _onMessage(event: MessageEvent): void {
        const { data } = event;

        if (typeof data === 'string') {
            this._handleTextFrame(data);
            return;
        }

        if (data instanceof ArrayBuffer) {
            this._emitDataReceived(new Uint8Array(data));
            return;
        }

        if (ArrayBuffer.isView(data)) {
            this._emitDataReceived(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
    }

    private _handleTextFrame(text: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            this._log('Ignoring non-JSON text frame', text);
            return;
        }

        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const type = (parsed as { type?: unknown }).type;
        const message = (parsed as { message?: unknown }).message;

        if (type === 'error') {
            const error = new Error(
                typeof message === 'string' ? message : 'Serial bridge error'
            );
            this._emitError(error, 'bridge');
            this._connectAttempt?.reject(error);
            return;
        }

        if (type === 'ready') {
            this._log('ready', typeof message === 'string' ? message : '');
            if (this._connectAttempt) {
                this._setState('connected');
                this._emitConnected(null);
                this._connectAttempt.resolve();
            }
            return;
        }

        if (type === 'status') {
            const statusMessage = typeof message === 'string' ? message : 'Connecting...';
            this._log('status', statusMessage);
        }
    }
}
