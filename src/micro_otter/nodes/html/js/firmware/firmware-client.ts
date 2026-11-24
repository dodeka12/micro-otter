// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';
import { buildFsListRequest, parseFsListResult } from './firmware-requests.js';
import type { FsListResult } from './firmware-requests.js';

/**
 * Client for the `WS /firmware` job endpoint.
 *
 * The client owns the transport only: it connects, serialises request frames,
 * and emits decoded server frames. It owns no state machine — the view feeds
 * every frame to `reduceFirmwareFrame`. There is deliberately no auto-reconnect:
 * the server cancels a running job on disconnect, so reconnecting silently would
 * misrepresent a killed job as still running; the next user action reconnects.
 */

const SOCKET_OPEN = 1;

/** How long one `fs.list` answer may take before the pending promise is rejected. */
export const FS_LIST_TIMEOUT_MS = 10_000;

/** Minimal WebSocket surface the client needs, injectable for tests. */
interface FirmwareSocket {
    readyState: number;
    send(data: string): void;
    close(): void;
    addEventListener(type: string, listener: (event: unknown) => void): void;
}

interface ConnectOptions {
    url?: string;
    webSocketFactory?: (url: string) => FirmwareSocket;
}

/**
 * Resolve the `/firmware` WebSocket URL from a location-like object.
 *
 * Copies the loopback rule from `websocket-connection.ts`: a `localhost`
 * hostname becomes `127.0.0.1`, because `localhost` can resolve to `::1` while
 * the server binds IPv4 — HTTP falls back, WebSocket upgrades do not. Any other
 * hostname and the port are preserved. Under Vite the `/firmware` proxy forwards
 * to `ws://127.0.0.1:8000`.
 */
export function resolveFirmwareSocketUrl(target?: {
    protocol?: string;
    hostname?: string;
    port?: string;
}): string {
    const resolved = target ?? (typeof window !== 'undefined' ? window.location : {});
    const protocol = resolved.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = resolved.hostname === 'localhost' ? '127.0.0.1' : resolved.hostname || '';
    const port = resolved.port ? `:${resolved.port}` : '';
    return `${protocol}//${hostname}${port}/firmware`;
}

/**
 * Payload for `socketState` events emitted by FirmwareJobClient.
 */
class FirmwareSocketStatePayload extends AppPayload {
    open: boolean;
    reason: string;

    /**
     * @param {boolean} open - Whether the socket is now open.
     * @param {string} reason - Why the socket state changed.
     */
    constructor(open: boolean, reason: string) {
        super('FirmwareJobClient.SocketState.v1');
        this.open = open;
        this.reason = reason;
    }
}

/**
 * Payload for `frame` events emitted by FirmwareJobClient.
 */
class FirmwareJobFramePayload extends AppPayload {
    frame: Record<string, unknown>;

    /**
     * @param {object} frame - The decoded server frame.
     */
    constructor(frame: Record<string, unknown>) {
        super('FirmwareJobClient.Frame.v1');
        this.frame = frame;
    }
}

/**
 * A typed client for one `WS /firmware` connection (one job at a time).
 */
export class FirmwareJobClient extends AppEventEmitter {
    private _socket: FirmwareSocket | null = null;
    private _pendingListings = new Map<
        string,
        { resolve: (value: FsListResult) => void; reject: (reason: Error) => void; timer: unknown }
    >();

    /**
     * Open the socket, resolving on `open` and rejecting on a failure before
     * `open`. Calling it while already open is a no-op.
     */
    async connect(options: ConnectOptions = {}): Promise<void> {
        if (this._socket && this._socket.readyState === SOCKET_OPEN) {
            return;
        }
        const url = options.url ?? resolveFirmwareSocketUrl();
        const factory =
            options.webSocketFactory ??
            ((socketUrl: string) => new WebSocket(socketUrl) as unknown as FirmwareSocket);
        const socket = factory(url);
        this._socket = socket;

        await new Promise<void>((resolve, reject) => {
            let opened = false;
            socket.addEventListener('open', () => {
                opened = true;
                this._emitSocketState(true, 'open');
                resolve();
            });
            socket.addEventListener('message', (event) => this._handleMessage(event));
            socket.addEventListener('close', () => {
                if (this._socket !== socket) {
                    return;
                }
                this._socket = null;
                this._rejectPendingListings(new Error('firmware socket closed'));
                this._emitSocketState(false, opened ? 'closed' : 'closed-before-open');
                if (!opened) {
                    reject(new Error('firmware socket closed before opening'));
                }
            });
            socket.addEventListener('error', () => {
                if (this._socket !== socket) {
                    return;
                }
                this._rejectPendingListings(new Error('firmware socket is not open'));
                this._emitSocketState(false, 'error');
                if (!opened) {
                    reject(new Error('firmware socket failed to open'));
                }
            });
        });
    }

    /**
     * Close the socket and emit a client-initiated `socketState` change. Closing
     * cancels any running job on the server.
     */
    close(): void {
        const socket = this._socket;
        if (!socket) {
            return;
        }
        this._socket = null;
        this._rejectPendingListings(new Error('firmware socket is not open'));
        this._emitSocketState(false, 'closed-by-client');
        socket.close();
    }

    /**
     * Return whether the socket is open.
     */
    isOpen(): boolean {
        return this._socket !== null && this._socket.readyState === SOCKET_OPEN;
    }

    /**
     * Send a `compile.start` frame. The request is serialised verbatim.
     */
    startCompile(request: Record<string, unknown>): void {
        this._send({ type: 'compile.start', ...request });
    }

    /**
     * Send a `deploy.start` frame. The request is serialised verbatim.
     */
    startDeploy(request: Record<string, unknown>): void {
        this._send({ type: 'deploy.start', ...request });
    }

    /**
     * Send a `scan-local` frame.
     */
    scanLocal(request: { runtimeId: string }): void {
        this._send({ type: 'scan-local', ...request });
    }

    /**
     * Send a `firmware.list` frame. It carries no fields.
     */
    listFirmware(): void {
        this._send({ type: 'firmware.list' });
    }

    /**
     * Send a `firmware.delete` frame.
     */
    deleteFirmware(request: { firmwarePath: string }): void {
        this._send({ type: 'firmware.delete', ...request });
    }

    /**
     * Send a `firmware.import` frame naming a server path or URL.
     */
    importFirmware(request: { path?: string; url?: string; force?: boolean }): void {
        this._send({ type: 'firmware.import', ...request });
    }

    /**
     * Send a `firmware.import-binary` frame naming a `.bin` and the platform that flashes it.
     */
    importFirmwareBinary(request: {
        path?: string;
        url?: string;
        targetId: string;
        force?: boolean;
    }): void {
        this._send({ type: 'firmware.import-binary', ...request });
    }

    /**
     * Send a `firmware.export` frame, starting an `export` job.
     */
    exportFirmware(request: { firmwarePath: string; destinationDir: string; force?: boolean }): void {
        this._send({ type: 'firmware.export', ...request });
    }

    /**
     * Send an `addon.install` frame, starting an `addon-install` job.
     */
    installAddon(request: { path?: string; url?: string; force?: boolean }): void {
        this._send({ type: 'addon.install', ...request });
    }

    /**
     * Send an `addon.uninstall` frame, starting an `addon-uninstall` job.
     */
    uninstallAddon(request: { packageIds: string[] }): void {
        this._send({ type: 'addon.uninstall', ...request });
    }

    /**
     * Send a `cancel` frame. The protocol answers nothing when no job runs, so
     * this never resolves or waits.
     */
    cancel(): void {
        this._send({ type: 'cancel' });
    }

    /**
     * Send one `fs.list` frame and resolve with its parsed result.
     *
     * The answer is correlated by `requestId`; `fs.list.error` rejects with an
     * `Error` carrying `code`, `message`, `hint`, and `details` as own properties.
     * A timeout rejects and drops the pending entry.
     */
    listDirectory(
        request: { requestId: string; path?: string; extensions?: string[]; showHidden?: boolean },
        options: { timeoutMs?: number } = {}
    ): Promise<FsListResult> {
        this._send(buildFsListRequest(request));
        return new Promise<FsListResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingListings.delete(request.requestId);
                reject(new Error('fs.list timed out'));
            }, options.timeoutMs ?? FS_LIST_TIMEOUT_MS);
            this._pendingListings.set(request.requestId, { resolve, reject, timer });
        });
    }

    /**
     * Serialise and send one frame, asserting the socket is open.
     */
    private _send(frame: Record<string, unknown>): void {
        const socket = this._requireOpen();
        socket.send(JSON.stringify(frame));
    }

    /**
     * Return the open socket, throwing when it is not open.
     */
    private _requireOpen(): FirmwareSocket {
        if (!this._socket || this._socket.readyState !== SOCKET_OPEN) {
            throw new Error('firmware socket is not open');
        }
        return this._socket;
    }

    /**
     * Decode one message event, routing `fs.list.result` / `fs.list.error` to the
     * pending promise before emitting a `frame` event. Non-object or unparsable
     * frames emit nothing.
     */
    private _handleMessage(event: unknown): void {
        const data = (event as { data?: unknown }).data;
        if (typeof data !== 'string') {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(data);
        } catch {
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return;
        }
        const frame = parsed as Record<string, unknown>;
        if (frame.type === 'fs.list.result') {
            const requestId = typeof frame.requestId === 'string' ? frame.requestId : null;
            const pending = requestId ? this._pendingListings.get(requestId) : undefined;
            if (pending) {
                this._pendingListings.delete(requestId as string);
                clearTimeout(pending.timer as ReturnType<typeof setTimeout>);
                try {
                    pending.resolve(parseFsListResult(frame));
                } catch (error) {
                    pending.reject(error as Error);
                }
                return;
            }
        }
        if (frame.type === 'fs.list.error') {
            const requestId = typeof frame.requestId === 'string' ? frame.requestId : null;
            const pending = requestId ? this._pendingListings.get(requestId) : undefined;
            if (pending) {
                this._pendingListings.delete(requestId as string);
                clearTimeout(pending.timer as ReturnType<typeof setTimeout>);
                const error = new Error(
                    typeof frame.message === 'string' ? frame.message : 'fs.list failed'
                ) as Error & {
                    code?: string;
                    hint?: string | null;
                    details?: Record<string, unknown> | null;
                };
                error.code = typeof frame.code === 'string' ? frame.code : undefined;
                error.hint = typeof frame.hint === 'string' ? frame.hint : null;
                error.details =
                    frame.details && typeof frame.details === 'object'
                        ? (frame.details as Record<string, unknown>)
                        : null;
                pending.reject(error);
                return;
            }
        }
        const payload = new FirmwareJobFramePayload(frame);
        this.emit('frame', payload);
    }

    /**
     * Reject every pending `fs.list` promise with *reason*.
     */
    private _rejectPendingListings(reason: Error): void {
        for (const [requestId, pending] of this._pendingListings) {
            this._pendingListings.delete(requestId);
            clearTimeout(pending.timer as ReturnType<typeof setTimeout>);
            pending.reject(reason);
        }
    }

    /**
     * Emit a `socketState` change.
     */
    private _emitSocketState(open: boolean, reason: string): void {
        const payload = new FirmwareSocketStatePayload(open, reason);
        this.emit('socketState', payload);
    }
}

