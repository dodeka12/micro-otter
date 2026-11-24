// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Device Connection Manager
 *
 * Manages serial connections and implements MicroPython communication protocols
 * for file transfer and runtime control. This is a non-UI class that coordinates
 * between connection providers and application logic.
 *
 * Architecture:
 * - Accepts multiple connection providers (WebSerial, WebSocket, etc.)
 * - Implements MicroPython REPL protocol communication
 * - Parses incoming data for message type markers [type]
 * - Emits parsed messages via EventTarget interface
 * - Reports progress for long-running operations
 *
 * @example
 * const webserial = new WebSerialConnection();
 * const deviceConnection = new DeviceConnection({
 *     providers: {
 *         webserial: {
 *             name: 'Web Serial',
 *             description: 'Direct USB serial connection',
 *             instance: webserial
 *         }
 *     },
 *     defaultProvider: 'webserial'
 * });
 *
 * deviceConnection.addEventListener('message', (event) => {
 *     logger.info(event.detail.type, event.detail.message);
 * });
 *
 * await deviceConnection.connect();
 * await deviceConnection.sendFile('/main.py', pythonCode);
 * await deviceConnection.softReset();
 */

import { ProgressTracker } from '../core/progress-events.js';
import { DeviceState } from '../data/device-state.js';
import type { FirmwareConstituentVersions } from '../data/device-state.js';
import type {
    BootstrapSetupStatusSummary,
    DeviceInfoPayload,
    EmbeddedInventory,
    EmbeddedPackagesSummary,
} from '../data/device-state.js';
import { DeviceTargetInfo } from '../data/device-target.js';
import { isCompleteActiveTargetPayload } from '../data/target-payload.js';
import {
    ConnectCancelledError,
    SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES,
} from './serial-connection-base.js';

export { ConnectCancelledError, isConnectCancelled } from './serial-connection-base.js';

type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
type ConnectionStateValue = (typeof ConnectionState)[keyof typeof ConnectionState];
type SerialConnectionEventType = keyof typeof SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES;
type TypedSerialEventType = Extract<SerialConnectionEventType, keyof SerialEventDetailByType>;

interface LoggerLike {
    log: (message: string, data?: unknown) => void;
}

interface LanguageChangeDetail {
    locale?: string;
    language?: string;
    previousLocale?: string;
    previousLanguage?: string;
}

interface I18nServiceLike extends EventTarget {
    currentLocale?: string;
    getCurrentLanguage?: () => string;
    mergeTranslations: (language: string, translations: Record<string, unknown>) => void;
}

interface SerialConnectionLike extends EventTarget {
    connect: (options?: Record<string, unknown>) => Promise<void>;
    disconnect: () => Promise<void>;
    send: (data: string | Uint8Array) => Promise<void>;
    isConnected: () => boolean;
    /** Cancel an in-flight `connect()`; optional on structural fakes. */
    cancelConnect?: () => void;
}

/**
 * One in-flight `connect()` attempt, owned by `DeviceConnection`.
 *
 * A second `connect()` while one is pending joins the existing `promise` instead of
 * opening a second transport. `cancelConnect()` flips `cancelled`, rejects the caller
 * immediately and releases the transport, while `_runConnect()` checks `cancelled`
 * after each await so a cancelled attempt never installs `_activeConnection` or
 * latches `ERROR`.
 */
interface DeviceConnectAttempt {
    /** Whether `cancelConnect()` tore this attempt down. */
    cancelled: boolean;
    /** Transport this attempt drives. */
    connection: SerialConnectionLike;
    /** Rejects the cancellation promise `connect()` races against. */
    reject: (error: Error) => void;
    /** The promise `connect()` returns and a joining caller awaits. */
    promise: Promise<void>;
}

interface SerialPayloadBase {
    payloadTypeId?: string;
    [key: string]: unknown;
}

interface SerialDataEventDetail extends SerialPayloadBase {
    data: Uint8Array;
    text?: string;
}

/** Stdout and stderr captured from one raw-REPL response frame. */
interface RawCommandFrame {
    /** Bytes printed before the first `0x04` marker. */
    stdout: Uint8Array<ArrayBufferLike>;
    /** Bytes between the two `0x04` markers, usually a traceback. */
    stderr: Uint8Array<ArrayBufferLike>;
}

interface SerialStateEventDetail extends SerialPayloadBase {
    state?: string;
    newState?: string;
}

interface SerialErrorEventDetail extends SerialPayloadBase {
    error: Error;
}

interface SerialEventDetailByType {
    data: SerialDataEventDetail;
    statechange: SerialStateEventDetail;
    error: SerialErrorEventDetail;
}

export interface ConnectionProvider {
    name: string;
    description: string;
    instance: SerialConnectionLike;
}

export interface DeviceConnectionOptions {
    providers?: Record<string, ConnectionProvider>;
    defaultProvider?: string | null;
    logger?: LoggerLike;
    receiveTimeout?: number;
    commandTimeout?: number;
    i18nService?: I18nServiceLike | null;
}

interface RuntimeInfo {
    id: string;
    name: string;
    version: string;
    description: string;
    targetId: string | null;
    customView: string | null;
}

interface CollectionInfo {
    name: string;
    version: string | null;
    targetId: string | null;
    hasFullDefinition: boolean;
}

interface DeviceInfoData {
    microPythonVersion: string | null;
    runtime: RuntimeInfo | null;
    firmwareFullVersion: string | null;
    runtimeFirmwareVersion: string | null;
    firmwareConstituentVersions: FirmwareConstituentVersions | null;
    allowedWebTargetIds: string[] | null;
    buildBaseTargetId: string | null;
    runtimeDeploymentMode: 'embedded' | 'dynamic' | 'unknown';
    runtimeEmbedded: boolean;
    embeddedRuntimeIdentity: {
        id: string | null;
        name: string | null;
        version: string | null;
        description: string | null;
    } | null;
    embeddedPackagesSummary: EmbeddedPackagesSummary | null;
    embeddedInventory: EmbeddedInventory | null;
    bootstrapSetupReady: boolean | null;
    bootstrapSetupStatus: BootstrapSetupStatusSummary | null;
    target: unknown;
    collection: CollectionInfo | null;
    customView: { path: string; data: Record<string, unknown> } | null;
    customViewError: string | null;
}

type DeviceInitializationVerdict =
    | 'ready'
    | 'ready-for-runtime-install'
    | 'needs-onboarding'
    | 'unknown';

interface DeviceInitializationStatusDetail {
    connectionState: ConnectionStateValue;
    runtimeDeploymentMode: 'embedded' | 'dynamic' | 'unknown';
    runtimePresent: boolean;
    specificTargetPresent: boolean;
    initializationVerdict: DeviceInitializationVerdict;
    onboardingActionable: boolean;
    reason?: string;
}

interface DeviceOnboardingResultDetail {
    confirmed: boolean;
    selectedTargetId?: string | null;
    userDescription?: string;
    error?: string | null;
}

interface EmbeddedOnboardingSelectionRequest {
    runtimeIdentity: {
        id: string | null;
        name: string | null;
        version: string | null;
    };
    targetConstraints: {
        compileBoard: string | null;
        allowedTargetIds: string[] | null;
    };
}

interface EmbeddedOnboardingSelectionResult {
    confirmed: boolean;
    selectedTargetId?: string | null;
    userDescription?: string;
    error?: string | null;
}

interface EmbeddedOnboardingAdapter {
    requestSelection: (
        request: EmbeddedOnboardingSelectionRequest
    ) => Promise<EmbeddedOnboardingSelectionResult>;
    uploadTargetConfiguration: (payload: {
        runtimeId: string;
        targetId: string;
        userDescription: string;
    }) => Promise<void>;
    showError?: (payload: { title: string; message: string; details?: string }) => Promise<void>;
}

interface DeviceFileEntry {
    name: string;
    type: 'file' | 'dir' | 'unknown';
    size: number;
}

interface SoftResetOptions {
    startRunning?: boolean;
}

interface ExecutionEventContext {
    source?: string;
    cause?: string;
    error?: string;
    functionName?: string;
    runtimeImpact?: CustomViewRuntimeImpact;
    transitionStep?: CustomViewTransitionStep;
}

type CustomViewRuntimeImpact = 'none' | 'stop' | 'restart';
type CustomViewTransitionStep = 'pre-stop' | 'function-execution' | 'post-restart';

interface CustomViewActionOptions {
    runtimeImpact?: CustomViewRuntimeImpact;
}

interface CustomViewRefreshActionOptions {
    runtimeImpact: CustomViewRuntimeImpact;
    source?: string;
}

interface RuntimeCommandOptions {
    intent: string;
    command: string;
    runtimeImpact?: CustomViewRuntimeImpact;
    source?: string;
}

interface RuntimeRefreshOptions {
    intent: string;
    command: string;
    runtimeImpact: CustomViewRuntimeImpact;
    source?: string;
}

interface ParsedRuntimeImpactDirective {
    runtimeImpact: CustomViewRuntimeImpact | null;
    isValidDirective: boolean;
}

const CUSTOM_VIEW_RUNTIME_IMPACTS: readonly CustomViewRuntimeImpact[] = ['none', 'stop', 'restart'];

const EXECUTION_EVENT_SOURCE_DEFAULT = 'device-connection';
const EXECUTION_EVENT_SOURCE_RUNTIME_COMMAND = 'runtime-command';
const EXECUTION_EVENT_SOURCE_RUNTIME_REFRESH = 'runtime-refresh';

/**
 * Canonical log prefixes the device may put in front of a log line.
 *
 * Runtime code and node packages tag every line as `[<level>] <source>: <message>`.
 * Only these tags are turned into a typed console message; every other line (a
 * REPL tool's `[diag]`, a MicroPython traceback frame, vendored third-party
 * output) is emitted as `raw`. The console filter dropdown offers exactly these
 * tags plus `raw`.
 *
 * @see docs/dev/device-communication/log-prefix-conventions.md
 * @type {readonly string[]}
 */
export const LOG_PREFIXES = Object.freeze([
    'user', // Output produced by the collection itself (Print node, user code)
    'system', // Device session and runtime-shell lifecycle
    'error', // A line of work failed
    'warning', // Degraded but still running
    'info', // Normal progress of a running subsystem
    'success', // An operation completed
    'data', // Value and payload dumps, high-volume traces
    'otter', // Micro-Otter structured JSON events
]);

/** Alternation of the canonical prefixes, shared by the message pattern parts. */
const LOG_PREFIX_PATTERN = LOG_PREFIXES.join('|');

/**
 * Matches one complete tagged message. A message is complete when followed by a
 * newline, the next tag, or the end of the buffer; that keeps a message split
 * across serial chunks from being emitted truncated.
 */
const TAGGED_MESSAGE_PATTERN =
    `\\[(${LOG_PREFIX_PATTERN})\\]\\s*(.+?)` +
    `(?=(?:\\r?\\n)|(?:\\[(?:${LOG_PREFIX_PATTERN})\\])|$)`;

/**
 * Message types for parsed device output
 * @enum {string}
 */
export const MessageType = Object.freeze({
    USER: 'user', // User code output
    SYSTEM: 'system', // System messages
    ERROR: 'error', // Error messages
    WARNING: 'warning', // Warning messages
    INFO: 'info', // Informational messages
    SUCCESS: 'success', // Operation completed
    DATA: 'data', // Value and payload dumps
    OTTER: 'otter', // Structured runtime logs from [otter]
    RAW: 'raw', // Unparsed raw output
});

/**
 * Connection states
 * @enum {string}
 */
export const ConnectionState = Object.freeze({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error',
});

/** Byte value of the `>` raw REPL prompt. */
const RAW_PROMPT_BYTE = 0x3e;

/** Byte value of the `0x04` marker that ends the stdout and stderr sections. */
const RAW_EOF_BYTE = 0x04;

/** Two-byte ack (`OK`, no line ending) the device prints before executing. */
const RAW_ACK_BYTES = new Uint8Array([0x4f, 0x4b]);

/** Maximum command slice handed to a single `send()` call. */
const RAW_COMMAND_CHUNK_SIZE = 256;

/** Settle time after the leading Ctrl-C before the response frame is read. */
const RAW_INTERRUPT_SETTLE_MS = 50;

/** Time spent discarding stray output before a command is written. */
const RAW_FRAME_FLUSH_MS = 20;

/** Number of bytes included in a raw protocol error preview. */
const RAW_PREVIEW_LIMIT = 32;

/** Banner the device prints when it enters raw REPL, including its prompt. */
const RAW_REPL_BANNER_BYTES = new TextEncoder().encode('raw REPL; CTRL-B to exit\r\n>');

/** Quiet window that ends the raw-REPL entry idle wait. */
const RAW_REPL_IDLE_QUIET_MS = 30;

/** Upper bound for the raw-REPL entry idle wait. */
const RAW_REPL_IDLE_MAX_MS = 1000;

/** Poll interval of the raw-REPL entry idle wait. */
const RAW_REPL_IDLE_POLL_MS = 5;

/** Entry attempts made before raw REPL entry is reported as failed. */
const RAW_REPL_ENTRY_ATTEMPTS = 3;

/** Pause between two raw REPL entry attempts. */
const RAW_REPL_ENTRY_RETRY_DELAY_MS = 120;

/** Per-attempt timeout while waiting for the raw REPL banner. */
const RAW_REPL_ENTRY_ATTEMPT_TIMEOUT_MS = 2000;

/**
 * Render up to `RAW_PREVIEW_LIMIT` bytes as hex for diagnostics.
 * @param {Uint8Array} bytes - Bytes received from the device.
 * @returns {string} Space separated hex pairs, suffixed with `...` when truncated.
 */
function formatRawPreview(bytes: Uint8Array): string {
    if (bytes.length === 0) {
        return '<empty>';
    }
    const preview = Array.from(bytes.subarray(0, RAW_PREVIEW_LIMIT), (byte) =>
        byte.toString(16).padStart(2, '0')
    ).join(' ');
    return bytes.length > RAW_PREVIEW_LIMIT ? `${preview} ...` : preview;
}

/**
 * Raw-REPL protocol violation reported by the device.
 *
 * Thrown when the device answers a command with something other than the
 * two-byte `OK` ack. The offending bytes are kept so callers can log or display
 * what actually arrived instead of re-deriving it from a decoded string.
 */
export class DeviceProtocolError extends Error {
    /** Bytes that violated the protocol, unmodified and untruncated. */
    readonly raw: Uint8Array;

    /**
     * @param {string} message - Human readable description of the violation.
     * @param {Uint8Array} raw - Bytes received from the device.
     */
    constructor(message: string, raw: Uint8Array) {
        super(`${message} (received: ${formatRawPreview(raw)})`);
        this.name = 'DeviceProtocolError';
        this.raw = raw;
    }
}

function getSerialEventDetailWithPayloadCheck<K extends TypedSerialEventType>(
    event: CustomEvent<SerialEventDetailByType[K]>,
    expectedEventType: K,
    context: string
): SerialEventDetailByType[K] {
    const expectedPayloadTypeId = SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES[expectedEventType];
    const detail = (event?.detail || {}) as SerialEventDetailByType[K];
    const actualPayloadTypeId = detail?.payloadTypeId;

    if (actualPayloadTypeId === undefined) {
        return detail;
    }

    if (actualPayloadTypeId !== expectedPayloadTypeId) {
        throw new TypeError(
            `${context}: expected payloadTypeId '${expectedPayloadTypeId}' but received '${actualPayloadTypeId}'`
        );
    }

    return detail;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function toErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}

function asSerialCustomEvent<K extends TypedSerialEventType>(
    event: Event,
    context: string
): CustomEvent<SerialEventDetailByType[K]> {
    if (!(event instanceof CustomEvent)) {
        throw new TypeError(`${context}: expected CustomEvent`);
    }
    return event as CustomEvent<SerialEventDetailByType[K]>;
}

/**
 * Concatenate two byte arrays.
 * @param {Uint8Array} a - First array.
 * @param {Uint8Array} b - Second array.
 * @returns {Uint8Array} Combined array.
 */
function concatBytes(
    a: Uint8Array<ArrayBufferLike>,
    b: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBufferLike> {
    const result = new Uint8Array(a.length + b.length) as Uint8Array<ArrayBufferLike>;
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

/**
 * Compare two byte arrays element by element.
 * @param {Uint8Array} a - First array.
 * @param {Uint8Array} b - Second array.
 * @returns {boolean} True when both arrays have the same length and content.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
}

/**
 * Byte-accurate reader for the raw-REPL response frame.
 *
 * Every arriving `data` chunk is appended to an internal buffer before pending
 * waits are evaluated, so a frame that is split across chunks, or that arrives
 * while the caller is still awaiting an earlier stage, is read exactly once.
 * Matching is byte based on purpose: decoding to text first would mis-handle a
 * multi-byte UTF-8 sequence or a payload byte that resembles a marker.
 */
class RawByteReader {
    /** Transport whose `data` events feed the buffer. */
    private _transport: SerialConnectionLike;
    /** Context label used in payload-type errors. */
    private _context: string;
    /** Bytes received but not consumed yet. */
    private _buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    /** Resolvers to re-evaluate whenever new bytes arrive. */
    private _waiters: Array<() => void> = [];
    /** Bound data handler, kept stable so it can be removed exactly once. */
    private _onData: (event: Event) => void;
    /** Whether `start()` has installed the data listener. */
    private _started = false;

    /**
     * @param {SerialConnectionLike} transport - Transport to read from.
     * @param {string} context - Label used in payload-type errors.
     */
    constructor(transport: SerialConnectionLike, context: string) {
        this._transport = transport;
        this._context = context;
        this._onData = (event: Event) => this._handleData(event);
    }

    /**
     * Subscribe to the transport's `data` events.
     * @returns {void}
     */
    start(): void {
        if (this._started) {
            return;
        }
        this._transport.addEventListener('data', this._onData);
        this._started = true;
    }

    /**
     * Unsubscribe and drop buffered bytes.
     * @returns {void}
     */
    stop(): void {
        if (this._started) {
            this._transport.removeEventListener('data', this._onData);
            this._started = false;
        }
        this._buffer = new Uint8Array(0);
        this._waiters = [];
    }

    /**
     * Drop every buffered byte without touching the subscription.
     * @returns {void}
     */
    discard(): void {
        this._buffer = new Uint8Array(0);
    }

    /**
     * Wait until exactly `count` bytes are buffered, then consume them.
     * @param {number} count - Required byte count.
     * @param {number} timeoutMs - Maximum wait in milliseconds.
     * @returns {Promise<Uint8Array>} The consumed bytes.
     */
    readExact(count: number, timeoutMs: number): Promise<Uint8Array<ArrayBufferLike>> {
        return this._await(
            () => (this._buffer.length >= count ? this._consume(count, 0) : null),
            timeoutMs,
            `${count}-byte raw REPL ack`
        );
    }

    /**
     * Wait for `terminator`, consume it and return the bytes before it.
     * @param {number} terminator - Byte value to stop at.
     * @param {number} timeoutMs - Maximum wait in milliseconds.
     * @returns {Promise<Uint8Array>} Bytes preceding the terminator.
     */
    readUntil(terminator: number, timeoutMs: number): Promise<Uint8Array<ArrayBufferLike>> {
        return this._await(
            () => {
                const index = this._buffer.indexOf(terminator);
                return index < 0 ? null : this._consume(index, 1);
            },
            timeoutMs,
            terminator === RAW_PROMPT_BYTE ? 'raw REPL prompt' : 'raw REPL section end marker'
        );
    }

    /**
     * Wait for a byte sequence, consume it and return the bytes before it.
     * @param {Uint8Array} sequence - Byte sequence to wait for.
     * @param {number} timeoutMs - Maximum wait in milliseconds.
     * @returns {Promise<Uint8Array>} Bytes preceding the sequence.
     */
    readUntilSequence(
        sequence: Uint8Array,
        timeoutMs: number
    ): Promise<Uint8Array<ArrayBufferLike>> {
        return this._await(
            () => {
                const index = this._indexOfSequence(sequence);
                return index < 0 ? null : this._consume(index, sequence.length);
            },
            timeoutMs,
            'raw REPL banner'
        );
    }

    /**
     * Find the first occurrence of `sequence` in the buffer.
     * @param {Uint8Array} sequence - Byte sequence to search for.
     * @returns {number} Index of the sequence, or -1 when absent.
     */
    private _indexOfSequence(sequence: Uint8Array): number {
        if (sequence.length === 0) {
            return 0;
        }

        const lastStart = this._buffer.length - sequence.length;
        for (let start = 0; start <= lastStart; start += 1) {
            let matched = true;
            for (let offset = 0; offset < sequence.length; offset += 1) {
                if (this._buffer[start + offset] !== sequence[offset]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return start;
            }
        }
        return -1;
    }

    /**
     * Append an arriving chunk and re-evaluate pending waits.
     * @param {Event} event - Serial `data` event.
     * @returns {void}
     */
    private _handleData(event: Event): void {
        const detail = getSerialEventDetailWithPayloadCheck(
            asSerialCustomEvent<'data'>(event, this._context),
            'data',
            this._context
        );
        this._buffer = concatBytes(this._buffer, detail.data);
        for (const waiter of [...this._waiters]) {
            waiter();
        }
    }

    /**
     * Consume `length` bytes plus `skip` separator bytes.
     * @param {number} length - Bytes to return.
     * @param {number} skip - Bytes to drop after the returned slice.
     * @returns {Uint8Array} The consumed slice.
     */
    private _consume(length: number, skip: number): Uint8Array<ArrayBufferLike> {
        const consumed = this._buffer.slice(0, length);
        this._buffer = this._buffer.slice(length + skip);
        return consumed;
    }

    /**
     * Resolve once `tryConsume` yields a value, retrying on every chunk.
     * @param {() => Uint8Array|null} tryConsume - Consumes when the pattern is present.
     * @param {number} timeoutMs - Maximum wait in milliseconds.
     * @param {string} what - Awaited bytes, used in the timeout message.
     * @returns {Promise<Uint8Array>} The consumed bytes.
     */
    private _await(
        tryConsume: () => Uint8Array<ArrayBufferLike> | null,
        timeoutMs: number,
        what: string
    ): Promise<Uint8Array<ArrayBufferLike>> {
        return new Promise<Uint8Array<ArrayBufferLike>>((resolve, reject) => {
            const state: { settled: boolean; timer?: ReturnType<typeof setTimeout> } = {
                settled: false,
            };

            /**
             * Consume the buffer if the awaited pattern is complete.
             * @returns {void}
             */
            const attempt = () => {
                if (state.settled) {
                    return;
                }
                const consumed = tryConsume();
                if (!consumed) {
                    return;
                }
                state.settled = true;
                if (state.timer !== undefined) {
                    clearTimeout(state.timer);
                }
                this._waiters = this._waiters.filter((waiter) => waiter !== attempt);
                resolve(consumed);
            };

            state.timer = setTimeout(() => {
                if (state.settled) {
                    return;
                }
                state.settled = true;
                this._waiters = this._waiters.filter((waiter) => waiter !== attempt);
                reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`));
            }, timeoutMs);

            this._waiters.push(attempt);
            attempt();
        });
    }
}

/**
 * DeviceConnection manages serial connections and MicroPython protocol communication
 * @extends EventTarget
 *
 * @fires DeviceConnection#message - Parsed message from device
 * @fires DeviceConnection#statechange - Connection state changed
 * @fires DeviceConnection#error - Error occurred
 * @fires DeviceConnection#raw - Raw data received (for debugging)
 */
export class DeviceConnection extends EventTarget {
    private _providers: Record<string, ConnectionProvider>;
    private _activeProviderKey: string | null;
    private _activeConnection: SerialConnectionLike | null;
    private _connectAttempt: DeviceConnectAttempt | null;
    private _logger: LoggerLike;
    private _receiveTimeout: number;
    private _commandTimeout: number;
    private _i18nService: I18nServiceLike | null;
    private _state: ConnectionStateValue;
    private _receiveBuffer: string;
    private _messageParser: unknown;
    private _isExecuting: boolean;
    private _isRawRepl: boolean;
    private _rawReplTransitionPromise: Promise<void> | null;
    private _deviceInfo: DeviceInfoData | null;
    private _languageChangeListener: EventListener | null;
    private _embeddedOnboardingAdapter: EmbeddedOnboardingAdapter | null;
    /**
     * Why the stored target configuration could not be adopted on the last device-info load.
     *
     * `missing` means the active-target file (or `/device.json`'s `targetConfigPath`) is absent,
     * which is the normal state of a fresh device. `incomplete` means the file exists but fails
     * `isCompleteActiveTargetPayload` — the legacy five-key bootstrap skeleton. `null` means the
     * stored target was adopted (or there was nothing to judge).
     */
    private _targetPayloadIssue: 'missing' | 'incomplete' | null;
    /**
     * Parsed active-target payload that failed the completeness gate on the last load.
     *
     * Kept for prefill only, so the repair dialog can offer the previously stored target id; it is
     * never adopted as `info.target`.
     */
    private _rejectedTargetPayload: Record<string, unknown> | null;
    /**
     * `targetUserDescription` last read from `/device.json`.
     *
     * `/device.json` survives every target write (`DEVICE_JSON_PRESERVED_FIELDS`), so this value
     * outlives a rejected target payload and can prefill the repair dialog.
     */
    private _targetUserDescription: string;

    /**
     * Create a DeviceConnection instance
     * @param {DeviceConnectionOptions} options - Configuration options
     */
    constructor(options: DeviceConnectionOptions = {}) {
        super();

        const {
            providers = {},
            defaultProvider = null,
            logger = console,
            receiveTimeout = 5000,
            commandTimeout = 10000,
            i18nService = null,
        } = options;

        this._providers = providers;
        this._activeProviderKey = defaultProvider;
        this._activeConnection = null;
        this._connectAttempt = null;
        this._logger = logger;
        this._receiveTimeout = receiveTimeout;
        this._commandTimeout = commandTimeout;
        this._i18nService = i18nService;

        this._state = ConnectionState.DISCONNECTED;
        this._receiveBuffer = '';
        this._messageParser = null;
        this._isExecuting = false;
        this._isRawRepl = false;
        this._rawReplTransitionPromise = null;

        // Custom view support (Phase 5 v2)
        this._deviceInfo = null;
        this._languageChangeListener = null;
        this._embeddedOnboardingAdapter = null;

        // Stored target verdict and prefill hints (see the member docstrings)
        this._targetPayloadIssue = null;
        this._rejectedTargetPayload = null;
        this._targetUserDescription = '';

        // Bind event handlers
        this._onConnectionData = this._onConnectionData.bind(this);
        this._onConnectionStateChange = this._onConnectionStateChange.bind(this);
        this._onConnectionError = this._onConnectionError.bind(this);
    }

    setEmbeddedOnboardingAdapter(adapter: EmbeddedOnboardingAdapter | null): void {
        this._embeddedOnboardingAdapter = adapter;
    }

    /**
     * Get available connection providers
     * @returns {Object.<string, ConnectionProvider>} Provider map
     */
    getProviders(): Record<string, ConnectionProvider> {
        return { ...this._providers };
    }

    /**
     * Get active provider key
     * @returns {string|null} Active provider key or null if none selected
     */
    getActiveProviderKey(): string | null {
        return this._activeProviderKey;
    }

    /**
     * Set active provider
     * @param {string} providerKey - Provider key to activate
     * @throws {Error} If provider not found or already connected
     */
    setActiveProvider(providerKey: string): void {
        if (this._state === ConnectionState.CONNECTED) {
            throw new Error('Cannot change provider while connected');
        }

        if (!this._providers[providerKey]) {
            throw new Error(`Provider not found: ${providerKey}`);
        }

        this._activeProviderKey = providerKey;
    }

    /**
     * Get current connection state
     * @returns {ConnectionState} Current state
     */
    getState(): ConnectionStateValue {
        return this._state;
    }

    /**
     * Get custom view renderer instance
     *
     * @deprecated Renderer instances are owned by CustomRuntimeView.
     * @returns {null} Always null.
     */
    getCustomViewRenderer(): null {
        return null;
    }

    /**
     * Get custom view data from device info
     *
     * @returns {Object|null} Custom view definition or null if no custom view loaded
     */
    getCustomViewData(): Record<string, unknown> | null {
        return this._deviceInfo?.customView?.data || null;
    }

    /**
     * Get loaded device info
     *
     * @returns {Object|null} Device info object or null if not loaded
     */
    getDeviceInfoData(): DeviceInfoData | null {
        return this._deviceInfo || null;
    }

    /**
     * Return the target ids the connected board's firmware can onboard, or null
     * when the firmware did not record any (an empty list means "no filter").
     * @returns {string[] | null} Allowed onboarding target ids, or null.
     */
    getAllowedWebTargetIds(): string[] | null {
        return this._deviceInfo?.allowedWebTargetIds ?? null;
    }

    /**
     * Return the terminal build base id the flashed image records, or null when
     * the image predates the field.
     * @returns {string | null} The build base target id, or null.
     */
    getBuildBaseTargetId(): string | null {
        return this._deviceInfo?.buildBaseTargetId ?? null;
    }

    /**
     * Return why the target configuration stored on the device could not be adopted.
     *
     * `missing` covers a device without a stored target (or without `/device.json`'s
     * `targetConfigPath`), `incomplete` covers a file that fails `isCompleteActiveTargetPayload`
     * (the legacy five-key skeleton), and `null` means the stored target was adopted or a read
     * error other than "file absent" left the verdict undecided.
     * @returns {'missing' | 'incomplete' | null} The issue of the last load, or null.
     */
    getTargetPayloadIssue(): 'missing' | 'incomplete' | null {
        return this._targetPayloadIssue;
    }

    /**
     * Return the target id of the rejected payload, for prefilling the repair dialog.
     *
     * @returns {string | null} The stored `targetId` when it is a non-empty string, else null.
     */
    getConfiguredTargetIdHint(): string | null {
        const targetId = this._rejectedTargetPayload?.targetId;
        return typeof targetId === 'string' && targetId.trim() !== '' ? targetId : null;
    }

    /**
     * Return the user description last read from `/device.json`.
     *
     * Unlike the active-target payload, `/device.json` is preserved across target writes, so this
     * description survives a rejected payload and can prefill the repair dialog.
     * @returns {string} The stored user description, `''` when none was recorded.
     */
    getTargetUserDescription(): string {
        return this._targetUserDescription;
    }

    /**
     * Check if connected to a device
     * @returns {boolean} True if connected
     */
    isConnected(): boolean {
        return (
            this._state === ConnectionState.CONNECTED &&
            Boolean(this._activeConnection?.isConnected())
        );
    }

    /**
     * Check if runtime is currently executing user code (play mode).
     * @returns {boolean} True when device is in play mode
     */
    isExecutionRunning(): boolean {
        return this._isExecuting === true;
    }

    /**
     * Check if currently in raw REPL mode
     * @returns {boolean} True if in raw REPL mode
     */
    isRawRepl(): boolean {
        return this._isRawRepl;
    }

    /**
     * Connect to device using active provider
     * @returns {Promise<void>}
     * @throws {Error} If no provider selected or connection fails
     */
    async connect(options: Record<string, unknown> = {}): Promise<void> {
        if (this._state === ConnectionState.CONNECTED) {
            return;
        }

        if (!this._activeProviderKey) {
            throw new Error('No provider selected');
        }

        const provider = this._providers[this._activeProviderKey];
        if (!provider) {
            throw new Error(`Provider not found: ${this._activeProviderKey}`);
        }

        // A second connect while one is pending joins the existing attempt instead of
        // opening a second transport (which would orphan the first attempt's promise).
        if (this._connectAttempt) {
            this._log('connect-already-in-progress', { provider: this._activeProviderKey });
            return this._connectAttempt.promise;
        }

        const attempt: DeviceConnectAttempt = {
            cancelled: false,
            connection: provider.instance,
            reject: () => {},
            promise: null as unknown as Promise<void>,
        };

        const cancelled = new Promise<never>((_, reject) => {
            attempt.reject = reject;
        });

        const run = this._runConnect(provider, options, attempt);
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
     * Drive one connect attempt from the active provider through raw-REPL entry.
     *
     * Runs inside the race `connect()` sets up; each `attempt.cancelled` checkpoint
     * stops a cancelled attempt before it installs `_activeConnection` or latches
     * `ERROR`, so a user cancellation can never fight a later attempt.
     * @param provider Provider driving the transport.
     * @param options Provider-specific connect options.
     * @param attempt Attempt record carrying the cancellation flag.
     * @private
     */
    private async _runConnect(
        provider: ConnectionProvider,
        options: Record<string, unknown>,
        attempt: DeviceConnectAttempt
    ): Promise<void> {
        this._setState(ConnectionState.CONNECTING);

        const connection = provider.instance;

        try {
            // Subscribe to connection events
            connection.addEventListener('data', this._onConnectionData);
            connection.addEventListener('statechange', this._onConnectionStateChange);
            connection.addEventListener('error', this._onConnectionError);

            await connection.connect(options);

            if (attempt.cancelled) {
                throw new ConnectCancelledError();
            }

            this._activeConnection = connection;

            this._setState(ConnectionState.CONNECTED);

            // Enter raw REPL mode for reliable communication
            await this._enterRawRepl();

            if (attempt.cancelled) {
                throw new ConnectCancelledError();
            }
        } catch (error: any) {
            if (attempt.cancelled) {
                // `cancelConnect()` already released the transport, removed the
                // listeners and settled on `DISCONNECTED`; a cancellation is not a
                // failure to report.
                throw error;
            }

            this._log('connection-failed', {
                error: toErrorMessage(error),
                stack: toErrorStack(error),
            });

            // Provider connect can fail before _activeConnection is set; remove listeners manually.
            if (connection && typeof connection.removeEventListener === 'function') {
                connection.removeEventListener('data', this._onConnectionData);
                connection.removeEventListener('statechange', this._onConnectionStateChange);
                connection.removeEventListener('error', this._onConnectionError);
            }

            this._setState(ConnectionState.ERROR);
            this._cleanup();

            // Close the transport so providers release resources (e.g. the
            // WebSocket bridge releases the serial port) even when raw-REPL
            // setup fails after the socket/port was opened.
            if (connection && typeof connection.disconnect === 'function') {
                try {
                    await connection.disconnect();
                } catch (disconnectError) {
                    this._log('disconnect-after-connect-failure-failed', {
                        error: toErrorMessage(disconnectError),
                    });
                }
            }

            this._setState(ConnectionState.DISCONNECTED);
            throw error;
        }
    }

    /**
     * Cancel the in-flight connect attempt, if any.
     *
     * Rejects the pending `connect()` with `ConnectCancelledError` immediately, then
     * releases the transport (its `cancelConnect()` hook, followed by a best-effort
     * `disconnect()`) and settles the connection back to `DISCONNECTED`. Never emits an
     * `error` event, so a cancellation never latches the badge into `Failed`.
     * @returns `true` when an attempt was cancelled, `false` when nothing was in flight.
     */
    cancelConnect(): boolean {
        const attempt = this._connectAttempt;
        if (!attempt) {
            return false;
        }

        attempt.cancelled = true;
        this._connectAttempt = null;
        attempt.reject(new ConnectCancelledError());

        const connection = attempt.connection;
        if (connection && typeof connection.removeEventListener === 'function') {
            connection.removeEventListener('data', this._onConnectionData);
            connection.removeEventListener('statechange', this._onConnectionStateChange);
            connection.removeEventListener('error', this._onConnectionError);
        }

        try {
            connection.cancelConnect?.();
        } catch (cancelError) {
            this._log('cancel-connect-error', { error: toErrorMessage(cancelError) });
        }

        void Promise.resolve(connection.disconnect()).catch((disconnectError) => {
            this._log('cancel-disconnect-error', { error: toErrorMessage(disconnectError) });
        });

        this._log('connect-cancelled', { provider: this._activeProviderKey });
        this._cleanup();
        this._setState(ConnectionState.DISCONNECTED);
        return true;
    }

    /**
     * Disconnect from device
     * @returns {Promise<void>}
     */
    async disconnect(): Promise<void> {
        if (this._state === ConnectionState.DISCONNECTED) {
            return;
        }

        // A disconnect while a connect is in flight is a cancel: the attempt owns the
        // transport and cancelConnect() already settles on `DISCONNECTED`.
        if (this._connectAttempt) {
            this.cancelConnect();
            return;
        }

        try {
            if (this._activeConnection) {
                await this._leaveRawReplBestEffort(this._activeConnection);
                await this._activeConnection.disconnect();
            }
        } catch (error: any) {
            this._log('disconnect-error', { error: error.message });
        } finally {
            this._cleanup();
            this._setState(ConnectionState.DISCONNECTED);
            this._log('disconnected');
        }
    }

    /**
     * Return the board to the friendly REPL before the port closes.
     *
     * A board left in raw REPL keeps the runtime interrupted and stays unusable
     * until it is reset by hand, so teardown sends Ctrl-B and never throws.
     *
     * @private
     * @param {SerialConnectionLike} transport - Transport that is about to close
     * @returns {Promise<void>}
     */
    private async _leaveRawReplBestEffort(transport: SerialConnectionLike): Promise<void> {
        if (!this._isRawRepl) {
            return;
        }

        try {
            await transport.send('\x02');
        } catch (error: unknown) {
            this._log('disconnect-exit-raw-repl-failed', {
                error: toErrorMessage(error),
            });
        }
    }

    /**
     * Send file to device using chunked base64 transfer
     * @param {string} path - Destination path on device
     * @param {string|Uint8Array} content - File content
     * @returns {Promise<void>}
     * @throws {Error} If not connected or transfer fails
     */
    async sendFile(path: string, content: string | Uint8Array): Promise<void> {
        this._ensureConnected();

        let tracker = new ProgressTracker(`file-send-${path}`);

        try {
            // Convert string to bytes if needed
            const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;

            // Convert to base64
            const base64 = this._arrayToBase64(data);
            const escapedPath = this._escapePythonString(path);

            // Chunk size: 4096 bytes of base64 per chunk (same as mpremote ROM filesystem)
            // Larger chunks = faster transfers with less overhead
            //
            // Notes on chunk size selection:
            // - mpremote uses 256 bytes with repr(bytes) for regular files
            // - mpremote uses 4096 bytes with base64 for ROM filesystem
            // - v1 used 800 bytes with base64 (proven stable)
            // - Base64 encoding is ~33% overhead vs repr(bytes) which is 400%+ overhead
            // - 4096 bytes of base64 ≈ 3072 bytes of raw data per chunk
            // - Total command size per chunk: ~4200 bytes (tested stable on ESP32)
            const chunkSize = 4096;
            const totalChunks = Math.max(1, Math.ceil(base64.length / chunkSize));

            // Create tracker with total chunks for automatic progress calculation
            tracker = new ProgressTracker(`file-send-${path}`, totalChunks);
            tracker.start(`Sending ${path}...`);

            // Timeout per chunk (not for entire file)
            const chunkTimeout = 10000; // 10 seconds per chunk

            // Create parent directories and truncate/create the file
            // Note: MicroPython's os module doesn't have makedirs(), so we create dirs manually
            // Step 1: Define helper function
            const helperCommand = `
def _mkdirs(path):
    if not path or path == '/':
        return
    parts = path.split('/')
    current = ''
    for part in parts:
        if not part:
            continue
        current = current + '/' + part if current else part
        try:
            os.mkdir(current)
        except:
            pass
`;
            await this._executeRawCommandWithTimeout(helperCommand, chunkTimeout);

            // Step 2: Create directories and file
            const createCommand = `import ubinascii; import os; _path = "${escapedPath}"; _parts = _path.rsplit("/", 1); _parent = _parts[0] if len(_parts) > 1 else None; _mkdirs(_parent) if _parent else None; f = open(_path, "wb"); f.close()`;
            await this._executeRawCommandWithTimeout(createCommand, chunkTimeout);

            // Send base64 data in chunks
            for (let offset = 0; offset < base64.length; offset += chunkSize) {
                const chunk = base64.slice(offset, offset + chunkSize);
                const escapedChunk = this._escapePythonString(chunk);

                const chunkCommand = `
import ubinascii
_data = ubinascii.a2b_base64("${escapedChunk}")
with open("${escapedPath}", "ab") as _f:
    _f.write(_data)
`;
                await this._executeRawCommandWithTimeout(chunkCommand, chunkTimeout);

                // Update progress tracker
                const chunkIndex = Math.floor(offset / chunkSize) + 1;
                tracker.update(`Sending ${path} (chunk ${chunkIndex}/${totalChunks})`, chunkIndex, {
                    totalChunks,
                });

                // Emit progress event for external listeners
                this.dispatchEvent(
                    new CustomEvent('file-progress', {
                        detail: {
                            path,
                            chunkIndex,
                            totalChunks,
                            progress: Math.min(1, chunkIndex / totalChunks),
                        },
                    })
                );
            }

            tracker.complete(`Successfully sent ${path}`);
        } catch (error: any) {
            tracker.error(`Failed to send ${path}`, error);
            throw error;
        }
    }

    /**
     * Write a text file to the device.
     * Optimized for JSON, Python, and other text files.
     * Uses simple write() approach without base64 encoding.
     * @param {string} path - Destination path on device
     * @param {string} content - Text content to write
     * @returns {Promise<void>}
     * @throws {Error} If not connected or write fails
     */
    async writeTextFile(path: string, content: string): Promise<void> {
        this._ensureConnected();

        try {
            // Escape content for Python string literal (handle quotes and backslashes)
            const escapedContent = content
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');

            const escapedPath = this._escapePythonString(path);

            const command = `
try:
    with open('${escapedPath}', 'w') as f:
        f.write('${escapedContent}')
    print('OK')
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }
        } catch (error: any) {
            this._log('text-file-write-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Receive file from device
     * @param {string} path - Source path on device
     * @returns {Promise<Uint8Array>} File content
     * @throws {Error} If not connected or transfer fails
     */
    async receiveFile(path: string): Promise<Uint8Array> {
        this._ensureConnected();

        const tracker = new ProgressTracker(`file-receive-${path}`);
        tracker.start(`Receiving ${path}...`);

        try {
            const command = this._buildFileReadCommand(path);
            const result = await this._executeRawCommand(command);

            tracker.complete(`Successfully received ${path}`);

            return result;
        } catch (error: any) {
            tracker.error(`Failed to receive ${path}`, error);
            throw error;
        }
    }

    /**
     * Read a text file from the device.
     * Optimized for JSON, Python, and other text files.
     * Uses text mode ('r') to avoid binary encoding issues.
     * @param {string} path - Device file path
     * @returns {Promise<string>} File content as string
     * @throws {Error} If not connected or file not found
     */
    async readTextFile(path: string): Promise<string> {
        this._ensureConnected();

        try {
            const command = `
try:
    with open('${path}', 'r') as f:
        print(f.read())
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            return output.trim();
        } catch (error: any) {
            this._log('text-file-read-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Delete a file or directory from the device.
     * For directories, they must be empty.
     * @param {string} path - Path to delete
     * @returns {Promise<void>}
     * @throws {Error} If not connected or deletion fails
     */
    async deleteFile(path: string): Promise<void> {
        this._ensureConnected();

        try {
            const escapedPath = this._escapePythonString(path);
            const command = `
import os
try:
    # Try to remove as file first
    try:
        os.remove("${escapedPath}")
        print('OK')
    except OSError:
        # If that fails, try as directory
        os.rmdir("${escapedPath}")
        print('OK')
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }
        } catch (error: any) {
            this._log('file-delete-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Delete a folder and its contents from the device.
     * @param {string} path - Folder path to delete
     * @returns {Promise<void>}
     * @throws {Error} If not connected or deletion fails
     */
    async deleteFolderRecursive(path: string): Promise<void> {
        this._ensureConnected();

        try {
            const escapedPath = this._escapePythonString(path);
            const command = `
import os
def rmtree(path):
    try:
        for entry in os.listdir(path):
            full_path = path + '/' + entry
            stat = os.stat(full_path)
            if stat[0] & 0x4000:  # Directory
                rmtree(full_path)
            else:
                os.remove(full_path)
        os.rmdir(path)
    except Exception as e:
        pass

try:
    rmtree("${escapedPath}")
    print('OK')
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }
        } catch (error: any) {
            this._log('folder-delete-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Remove a folder from the device and report how many entries were removed.
     *
     * Unlike `deleteFolderRecursive()` this variant counts on the device and returns the number,
     * so a caller can tell "the folder was there and is gone" from "there was nothing to remove".
     * Used by the deploy to decide whether a package folder removal counts as a device change.
     * @param {string} path - Folder path to remove
     * @param {Object} [options] - Removal options
     * @param {boolean} [options.recursive=true] - Remove the tree; `false` removes the folder only if it is empty
     * @returns {Promise<number>} Number of removed entries including the folder itself (0 if nothing existed or the folder is not empty)
     * @throws {Error} If not connected or the device script fails
     */
    async removeFolder(path: string, options: { recursive?: boolean } = {}): Promise<number> {
        this._ensureConnected();

        const { recursive = true } = options;

        try {
            const escapedPath = this._escapePythonString(path);
            const recursiveFlag = recursive ? 'True' : 'False';
            const command = `
import os

def _otter_remove(path, recursive):
    removed = 0
    try:
        if recursive:
            for entry in os.listdir(path):
                full_path = path + '/' + entry
                try:
                    if os.stat(full_path)[0] & 0x4000:  # Directory
                        removed += _otter_remove(full_path, True)
                    else:
                        os.remove(full_path)
                        removed += 1
                except Exception:
                    pass
        os.rmdir(path)
        removed += 1
    except Exception:
        pass
    return removed

try:
    print('REMOVED:', _otter_remove("${escapedPath}", ${recursiveFlag}))
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            const match = output.match(/REMOVED:\s*(\d+)/);
            if (!match) {
                throw new Error(`Unexpected removeFolder output: ${output.trim()}`);
            }

            const removedCount = Number(match[1]);
            this._log('folder-remove-complete', { path, recursive, removedCount });
            return removedCount;
        } catch (error: any) {
            this._log('folder-delete-failed', { path, recursive, error: error.message });
            throw error;
        }
    }

    /**
     * Delete all files and folders from the device root.
     * Some system files may be protected and will be skipped.
     * @returns {Promise<string>} Result output from device
     * @throws {Error} If not connected or deletion fails
     */
    async deleteFileSystem(): Promise<string> {
        this._ensureConnected();

        try {
            const command = `
import os

def rmtree(path):
    try:
        for entry in os.listdir(path):
            full_path = path + '/' + entry if path != '/' else '/' + entry
            try:
                stat = os.stat(full_path)
                if stat[0] & 0x4000:  # Directory
                    rmtree(full_path)
                else:
                    os.remove(full_path)
            except Exception:
                pass  # Skip protected files
        if path != '/':
            try:
                os.rmdir(path)
            except Exception:
                pass  # Can't delete root
    except Exception:
        pass

try:
    for entry in os.listdir('/'):
        full_path = '/' + entry
        try:
            stat = os.stat(full_path)
            if stat[0] & 0x4000:  # Directory
                rmtree(full_path)
            else:
                os.remove(full_path)
        except Exception:
            pass  # Skip protected files
    print('Filesystem cleared')
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            return output.trim();
        } catch (error: any) {
            this._log('filesystem-delete-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Ensure a directory exists on the device, creating parent directories as needed.
     * Similar to `mkdir -p` on Unix systems.
     * @param {string} dirPath - Directory path to create
     * @returns {Promise<void>}
     * @throws {Error} If not connected or creation fails
     */
    async ensureDirectory(dirPath: string): Promise<void> {
        this._ensureConnected();

        try {
            const escapedPath = this._escapePythonString(dirPath);
            const command = `
import os
def _mkdirs(path):
    if not path or path == '/':
        return
    parts = path.split('/')
    current = ''
    for part in parts:
        if not part:
            continue
        current = current + '/' + part if current else part
        try:
            os.mkdir(current)
        except:
            pass
_mkdirs("${escapedPath}")
print('OK')
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }
        } catch (error: any) {
            this._log('directory-create-failed', { dirPath, error: error.message });
            throw error;
        }
    }

    /**
     * List files in a directory (non-recursive).
     * @param {string} path - Directory path (default: '/')
     * @returns {Promise<Array<{name: string, type: 'file'|'dir', size: number}>>}
     * @throws {Error} If not connected or listing fails
     */
    async listFiles(path = '/'): Promise<DeviceFileEntry[]> {
        this._ensureConnected();

        try {
            const escapedPath = this._escapePythonString(path);
            const command = `
import os
import json
try:
    items = []
    for name in os.listdir("${escapedPath}"):
        full_path = "${escapedPath}/" + name if "${escapedPath}" != "/" else "/" + name
        try:
            stat = os.stat(full_path)
            # Check if directory by trying to list it
            try:
                os.listdir(full_path)
                items.append({"name": name, "type": "dir", "size": 0})
            except:
                items.append({"name": name, "type": "file", "size": stat[6]})
        except:
            items.append({"name": name, "type": "unknown", "size": 0})
    print(json.dumps(items))
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            const files = JSON.parse(output.trim());
            return files;
        } catch (error: any) {
            this._log('file-list-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Calculate SHA256 hash of a file on the device.
     * @param {string} path - Device file path
     * @returns {Promise<string>} SHA256 hash as hexadecimal string
     * @throws {Error} If not connected or calculation fails
     */
    async calculateHash(path: string): Promise<string> {
        this._ensureConnected();

        try {
            const escapedPath = this._escapePythonString(path);
            const command = `
import hashlib
import ubinascii
try:
    sha256 = hashlib.sha256()
    with open("${escapedPath}", "rb") as f:
        while True:
            chunk = f.read(1024)
            if not chunk:
                break
            sha256.update(chunk)
    print(ubinascii.hexlify(sha256.digest()).decode())
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            const hash = output.trim();
            return hash;
        } catch (error: any) {
            this._log('hash-calculation-failed', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Query basic device information from MicroPython.
     * @returns {Promise<Object>} Device info payload
     * @throws {Error} If not connected or query fails
     */
    async getDeviceInfo(): Promise<Record<string, unknown>> {
        this._ensureConnected();

        try {
            const command = `
import sys
import os
import gc
import esp
try:
    import json
    info = {
        "platform": sys.platform,
        "version": sys.version,
        "implementation": sys.implementation[0],
        "flash_size": esp.flash_size(),
        "chip_id": esp.flash_id() if hasattr(esp, 'flash_id') else None,
        "free_memory": gc.mem_free(),
        "allocated_memory": gc.mem_alloc(),
        "filesystem_stats": os.statvfs("/")
    }
    print(json.dumps(info))
except Exception as e:
    print('ERROR:', str(e))
            `.trim();

            const output = await this.executeCode(command);

            if (output.startsWith('ERROR:')) {
                throw new Error(output.substring(7).trim());
            }

            const info = JSON.parse(output.trim());
            return info;
        } catch (error: any) {
            this._log('device-info-query-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Load device info including runtime manifest and custom view metadata.
     * This is the main entry point for Phase 5 v2 custom runtime views.
     *
     * Returns a DeviceState instance encapsulating all device information including
     * connection status, runtime details, target capabilities, and collection metadata.
     *
     * @returns {Promise<DeviceState>} DeviceState instance with complete device information
     * @throws {Error} If not connected or loading fails
     */
    async loadDeviceInfo(): Promise<DeviceState> {
        return this._loadDeviceInfoInternal({ onboardingRetryAttempted: false });
    }

    async _loadDeviceInfoInternal(options: {
        onboardingRetryAttempted: boolean;
    }): Promise<DeviceState> {
        this._ensureConnected();

        // Each load re-decides the target verdict, so a previous rejection (or its prefill hints)
        // must not leak into this pass.
        this._targetPayloadIssue = null;
        this._rejectedTargetPayload = null;
        this._targetUserDescription = '';

        const tracker = new ProgressTracker('device-info-load');
        tracker.start('Loading device information...');
        this.dispatchEvent(
            new CustomEvent('device-info-loading', {
                detail: {
                    loading: true,
                    progress: 0,
                    message: 'Loading device information...',
                },
            })
        );

        const info: DeviceInfoData = {
            microPythonVersion: null,
            runtime: null,
            firmwareFullVersion: null,
            runtimeFirmwareVersion: null,
            firmwareConstituentVersions: null,
            allowedWebTargetIds: null,
            buildBaseTargetId: null,
            runtimeDeploymentMode: 'unknown',
            runtimeEmbedded: false,
            embeddedRuntimeIdentity: null,
            embeddedPackagesSummary: null,
            embeddedInventory: null,
            bootstrapSetupReady: null,
            bootstrapSetupStatus: null,
            target: null,
            collection: null,
            customView: null,
            customViewError: null,
        };

        try {
            // Get MicroPython version
            tracker.update('Reading MicroPython version...', 10);
            const versionCommand = 'import sys; print(sys.version)';
            const versionOutput = await this.executeCode(versionCommand);
            info.microPythonVersion = versionOutput.trim();

            this._log(
                'load-device-info-version-read',
                `micropythonVersion=${info.microPythonVersion || 'unknown'}`
            );

            // A device that has just reset or reconnected can return an empty
            // response to the embedded-metadata probe. Retry a few times before
            // giving up, so a transient read does not downgrade an embedded runtime
            // to "unknown" (which would make deploy re-upload all bundled modules).
            let embeddedProbe = null;
            const maxProbeAttempts = 3;
            for (let attempt = 0; attempt < maxProbeAttempts && !embeddedProbe; attempt++) {
                embeddedProbe = await this._readEmbeddedMetadataBundleFromDevice();
                if (!embeddedProbe && attempt < maxProbeAttempts - 1) {
                    await this._delay(250 * (attempt + 1));
                }
            }
            info.runtimeDeploymentMode = embeddedProbe?.runtimeMode || 'unknown';
            info.runtimeEmbedded = info.runtimeDeploymentMode === 'embedded';
            info.embeddedRuntimeIdentity = embeddedProbe
                ? {
                      id: embeddedProbe.runtimeId,
                      name: embeddedProbe.runtimeName,
                      version: embeddedProbe.runtimeVersion,
                      description: embeddedProbe.runtimeDescription,
                  }
                : null;
            info.embeddedPackagesSummary = embeddedProbe?.embeddedPackagesSummary || null;
            info.embeddedInventory = embeddedProbe?.embeddedInventory || null;
            info.allowedWebTargetIds = embeddedProbe?.allowedWebTargetIds ?? null;
            info.buildBaseTargetId = embeddedProbe?.buildBaseTargetId ?? null;

            if (info.runtimeEmbedded) {
                info.bootstrapSetupStatus = await this._readBootstrapSetupStatusFromDevice();
                info.bootstrapSetupReady = info.bootstrapSetupStatus?.ready ?? null;
            }

            // Load runtime manifest
            tracker.update('Loading runtime manifest...', 25);
            try {
                const manifestPath = '/manifest.json';
                const manifestData = await this.readTextFile(manifestPath);
                const manifestText = this._normalizeJsonText(manifestData);
                const manifest = JSON.parse(manifestText);

                const manifestTarget = manifest.target;
                const manifestTargetId =
                    typeof manifest.targetId === 'string'
                        ? manifest.targetId
                        : typeof manifestTarget === 'string'
                          ? manifestTarget
                          : manifestTarget && typeof manifestTarget === 'object'
                            ? ((manifestTarget as Record<string, unknown>).id as string) || null
                            : null;

                info.runtime = {
                    id: manifest.id || 'unknown',
                    name: manifest.name || 'Unknown Runtime',
                    version: manifest.version || 'unknown',
                    description: manifest.description || '',
                    targetId: manifestTargetId,
                    customView: manifest.customView || null,
                };

                this._log(
                    'load-device-info-runtime-source',
                    `source=manifest; runtimeId=${info.runtime.id || 'unknown'}; runtimeVersion=${info.runtime.version || 'unknown'}; manifestPath=/manifest.json`
                );
            } catch (error: any) {
                this._log(
                    'runtime-manifest-read-failed',
                    `error=${error?.message || 'unknown'}; usingDefaults=true`
                );
                this._log(
                    'load-device-info-runtime-source',
                    `source=manifest; status=missing-or-invalid; error=${error?.message || 'unknown'}`
                );
            }

            // Load target info (optional)
            info.target = null;

            // Collect device-specific metadata from /device.json
            const deviceSpecificData = {
                userDescription: null,
                configPath: null,
                uploadedAt: null,
            };
            let targetIdOverride = info.runtime?.targetId || null;

            try {
                tracker.update('Reading device target metadata...', 40);
                const deviceInfoJson = await this.readTextFile('/device.json');
                const deviceInfoText = this._normalizeJsonText(deviceInfoJson);
                const deviceInfo = JSON.parse(deviceInfoText);

                if (!info.runtime && typeof deviceInfo.runtime === 'string') {
                    info.runtime = {
                        id: deviceInfo.runtime,
                        name: deviceInfo.runtime,
                        version: deviceInfo.version || 'unknown',
                        description: '',
                        targetId: deviceInfo.targetId || null,
                        customView: null,
                    };

                    this._log(
                        'load-device-info-runtime-source',
                        `source=device.json-fallback; runtimeId=${info.runtime.id || 'unknown'}; runtimeVersion=${info.runtime.version || 'unknown'}; path=/device.json`
                    );
                }

                targetIdOverride = deviceInfo.targetId || targetIdOverride;
                deviceSpecificData.userDescription = deviceInfo.targetUserDescription || null;
                deviceSpecificData.configPath = deviceInfo.targetConfigPath || null;
                deviceSpecificData.uploadedAt = deviceInfo.targetUploadedAt || null;

                info.firmwareFullVersion =
                    (typeof deviceInfo.firmwareFullVersion === 'string'
                        ? deviceInfo.firmwareFullVersion
                        : null) ||
                    (typeof deviceInfo.firmwareVersion === 'string'
                        ? deviceInfo.firmwareVersion
                        : null);
                info.runtimeFirmwareVersion =
                    typeof deviceInfo.runtimeFirmwareVersion === 'string'
                        ? deviceInfo.runtimeFirmwareVersion
                        : null;
                info.firmwareConstituentVersions =
                    deviceInfo.constituentVersions &&
                    typeof deviceInfo.constituentVersions === 'object' &&
                    !Array.isArray(deviceInfo.constituentVersions)
                        ? (deviceInfo.constituentVersions as FirmwareConstituentVersions)
                        : null;
            } catch (error: any) {
                this._log(
                    'device-info-read-failed',
                    `error=${error?.message || 'unknown'}; usingDefaults=true`
                );
                this._log(
                    'load-device-info-device-json-missing',
                    `status=missing-or-invalid; error=${error?.message || 'unknown'}`
                );
            }

            // Keep the user description even when the active-target payload is rejected: it comes
            // from /device.json, which every target write preserves.
            this._targetUserDescription =
                typeof deviceSpecificData.userDescription === 'string'
                    ? deviceSpecificData.userDescription
                    : '';

            // Fallback: fetch firmware version from workspace catalog when device.json
            // does not carry these fields (standard for embedded firmware devices).
            if (!info.firmwareFullVersion) {
                const catalogRuntimeId =
                    info.embeddedRuntimeIdentity?.id || info.runtime?.id || null;
                if (catalogRuntimeId) {
                    try {
                        const catalogResponse = await fetch(
                            '/device/firmware/latest_versions.json'
                        );
                        if (catalogResponse.ok) {
                            const catalog = await catalogResponse.json();
                            const targets = catalog?.targets;
                            if (targets && typeof targets === 'object') {
                                for (const entry of Object.values(targets)) {
                                    const e = entry as Record<string, unknown>;
                                    if (e.runtimeId !== catalogRuntimeId) {
                                        continue;
                                    }
                                    const channels = e.channels;
                                    let channelEntry: Record<string, unknown> | null = null;
                                    if (channels && typeof channels === 'object') {
                                        const c = channels as Record<string, unknown>;
                                        channelEntry =
                                            (c.release as Record<string, unknown>) ??
                                            (c.dev as Record<string, unknown>) ??
                                            null;
                                    }
                                    info.firmwareFullVersion =
                                        typeof channelEntry?.fullVersion === 'string'
                                            ? (channelEntry.fullVersion as string)
                                            : typeof e.fullVersion === 'string'
                                              ? (e.fullVersion as string)
                                              : null;
                                    info.runtimeFirmwareVersion =
                                        typeof channelEntry?.version === 'string'
                                            ? (channelEntry.version as string)
                                            : typeof e.runtimeFirmwareVersion === 'string'
                                              ? (e.runtimeFirmwareVersion as string)
                                              : null;
                                    break;
                                }
                            }
                        }
                    } catch (error: any) {
                        this._log(
                            'firmware-catalog-fetch-failed',
                            `error=${error?.message || 'unknown'}`
                        );
                    }
                }
            }

            this._log(
                'load-device-info-runtime-summary',
                `runtimeDetected=${Boolean(info.runtime)}; runtimeId=${info.runtime?.id || 'none'}; runtimeVersion=${info.runtime?.version || 'none'}; targetIdOverride=${targetIdOverride || 'none'}`
            );

            // Load target capabilities when available
            if (deviceSpecificData.configPath || targetIdOverride) {
                tracker.update('Loading target capabilities...', 55);
                const targetPath =
                    deviceSpecificData.configPath || '/device/targets/active_target.json';
                try {
                    const targetJson = await this.readTextFile(targetPath);
                    const targetText = this._normalizeJsonText(targetJson);
                    const targetPayload = JSON.parse(targetText) as Record<string, unknown>;
                    if (isCompleteActiveTargetPayload(targetPayload)) {
                        const targetInfo = new DeviceTargetInfo(targetPayload) as any;
                        // Populate instance-specific data
                        targetInfo.instanceData = deviceSpecificData;
                        info.target = targetInfo;
                    } else {
                        // The legacy five-key bootstrap skeleton carries no pin information; adopting
                        // it silently made the `irq` capability disappear. Keep it as a prefill hint
                        // only and let the initialization verdict ask the user to repair the target.
                        this._targetPayloadIssue = 'incomplete';
                        this._rejectedTargetPayload = targetPayload;
                        this._log('load-target-capabilities-incomplete', {
                            path: targetPath,
                            keys: Object.keys(targetPayload),
                        });
                    }
                } catch (error: any) {
                    const message = String(error?.message || '');
                    if (/ENOENT|No such file|not found/i.test(message)) {
                        // A device without a stored target is a normal state (not a read failure).
                        this._targetPayloadIssue = 'missing';
                        this._log('load-target-config-missing', {
                            path: targetPath,
                            reason: message,
                        });
                    } else {
                        this._log('load-target-capabilities-failed', 'error', {
                            error: error.message,
                            stack: error.stack,
                        });
                    }
                }
            }

            // Load deployed collection info (optional)
            tracker.update('Checking deployed collection...', 70);
            try {
                const collectionJson = await this.readTextFile('/collection/node_graph_cln.json');
                const collectionText = this._normalizeJsonText(collectionJson);
                const metadata = JSON.parse(collectionText);
                info.collection = {
                    name: metadata.collectionName || metadata.name || 'Unknown',
                    version: metadata.collectionVersion || metadata.version || null,
                    targetId: metadata.targetId || null,
                    hasFullDefinition: metadata.hasFullDefinition || false,
                };
            } catch (error: any) {
                this._log(
                    'check-deployed-collection-not-found',
                    `error=${error?.message || 'unknown'}`
                );
            }

            // Check for custom view reference
            if (info.runtime?.customView) {
                tracker.update('Loading custom runtime view...', 82);
                try {
                    // Load custom view definition (device OR host fallback)
                    const customViewData = await this._fetchCustomView(
                        info.runtime.id,
                        info.runtime.customView
                    );

                    // Load custom view locales for current language
                    tracker.update('Loading runtime view locales...', 92);
                    await this._loadCustomViewLocales(info.runtime.id);

                    info.customView = {
                        path: info.runtime.customView,
                        data: customViewData,
                    };
                } catch (error: any) {
                    this._log('custom-view-load-failed', { error: error.message });
                    info.customViewError = error.message;
                    this.dispatchEvent(
                        new CustomEvent('device-info-load-error', {
                            detail: {
                                error: error.message,
                                reason: 'custom-view',
                            },
                        })
                    );
                }
            }

            this._deviceInfo = info;

            // Create DeviceState instance from loaded info
            const deviceInfoPayload: DeviceInfoPayload = {
                microPythonVersion: info.microPythonVersion || undefined,
                runtime: info.runtime
                    ? {
                          id: info.runtime.id,
                          name: info.runtime.name,
                          version: info.runtime.version,
                          description: info.runtime.description,
                          customView: info.runtime.customView || undefined,
                      }
                    : undefined,
                firmware:
                    info.firmwareFullVersion ||
                    info.runtimeFirmwareVersion ||
                    info.firmwareConstituentVersions ||
                    info.allowedWebTargetIds
                        ? {
                              fullVersion: info.firmwareFullVersion || undefined,
                              runtimeFirmwareVersion: info.runtimeFirmwareVersion || undefined,
                              constituentVersions: info.firmwareConstituentVersions || undefined,
                              allowedWebTargetIds: info.allowedWebTargetIds || undefined,
                              buildBaseTargetId: info.buildBaseTargetId || undefined,
                          }
                        : undefined,
                target: (info.target as DeviceInfoPayload['target']) || undefined,
                collection: info.collection
                    ? {
                          name: info.collection.name,
                          version: info.collection.version || undefined,
                          hasFullDefinition: info.collection.hasFullDefinition,
                      }
                    : undefined,
                runtimeDeploymentMode:
                    info.runtimeDeploymentMode === 'embedded' ||
                    info.runtimeDeploymentMode === 'dynamic' ||
                    info.runtimeDeploymentMode === 'unknown'
                        ? info.runtimeDeploymentMode
                        : undefined,
                runtimeEmbedded: info.runtimeEmbedded,
                embeddedPackagesSummary: info.embeddedPackagesSummary,
                embeddedInventory: info.embeddedInventory,
                bootstrapSetupReady: info.bootstrapSetupReady,
                bootstrapSetupStatus: info.bootstrapSetupStatus,
            };
            const deviceState = DeviceState.fromDeviceInfo(deviceInfoPayload);

            const runtimePresent = Boolean(info.runtime);
            const specificTargetPresent = Boolean(
                (info.target as Record<string, unknown> | null)?.id
            );
            const runtimeDeploymentMode =
                embeddedProbe?.runtimeMode === 'embedded'
                    ? 'embedded'
                    : embeddedProbe?.runtimeMode === 'dynamic'
                      ? 'dynamic'
                      : 'unknown';
            const initializationVerdict = this._resolveInitializationVerdict({
                runtimePresent,
                specificTargetPresent,
                runtimeDeploymentMode,
            });
            this._emitDeviceInitializationStatus({
                connectionState: this._state,
                runtimeDeploymentMode,
                runtimePresent,
                specificTargetPresent,
                initializationVerdict,
                onboardingActionable:
                    initializationVerdict === 'needs-onboarding' &&
                    runtimeDeploymentMode === 'embedded',
            });

            const onboardingRequiredNow =
                initializationVerdict === 'needs-onboarding' &&
                runtimeDeploymentMode === 'embedded';
            if (onboardingRequiredNow) {
                if (options.onboardingRetryAttempted) {
                    const errorMessage =
                        'Failed to verify device info after onboarding. The specific target is still missing.';
                    const onboardingErrorPayload = {
                        title: 'Device onboarding failed',
                        message: errorMessage,
                        details:
                            'The device info refresh after onboarding did not include a specific target id.',
                    };
                    if (this._embeddedOnboardingAdapter?.showError) {
                        await this._embeddedOnboardingAdapter.showError(onboardingErrorPayload);
                    }
                    throw new Error(errorMessage);
                }

                const onboardingResult = await this._requestOnboardingForMissingSpecificTarget({
                    runtimeIdentity: {
                        id: info.runtime?.id || embeddedProbe?.runtimeId || null,
                        name: info.runtime?.name || null,
                        version: info.runtime?.version || null,
                    },
                });

                if (!onboardingResult.confirmed) {
                    const errorMessage =
                        onboardingResult.error ||
                        'Device onboarding is required before continuing with this embedded runtime.';
                    throw new Error(errorMessage);
                }

                return await this._loadDeviceInfoInternal({ onboardingRetryAttempted: true });
            }

            tracker.complete('Device information loaded');
            this.dispatchEvent(
                new CustomEvent('device-info-loading', {
                    detail: {
                        loading: false,
                        progress: 100,
                        message: 'Device information loaded',
                    },
                })
            );

            this.dispatchEvent(new CustomEvent('device-info-loaded', { detail: info }));
            return deviceState;
        } catch (error: any) {
            tracker.error('Failed to load device information', { error: error.message });
            this.dispatchEvent(
                new CustomEvent('device-info-loading', {
                    detail: {
                        loading: false,
                        message: `Failed to load device information: ${error.message}`,
                    },
                })
            );
            this._log('device-info-load-error', { error: error.message });
            this._emitDeviceInitializationStatus({
                connectionState: this._state,
                runtimeDeploymentMode: 'unknown',
                runtimePresent: false,
                specificTargetPresent: false,
                initializationVerdict: 'unknown',
                onboardingActionable: false,
                reason: error.message,
            });
            this.dispatchEvent(
                new CustomEvent('device-info-load-error', {
                    detail: { error: error.message },
                })
            );
            throw error;
        }
    }

    async _requestOnboardingForMissingSpecificTarget({
        runtimeIdentity,
    }: {
        runtimeIdentity: { id: string | null; name: string | null; version: string | null };
    }): Promise<DeviceOnboardingResultDetail> {
        if (!this._embeddedOnboardingAdapter) {
            return {
                confirmed: false,
                error: 'Embedded onboarding adapter is not configured.',
            };
        }

        const selection = await this._embeddedOnboardingAdapter.requestSelection({
            runtimeIdentity,
            targetConstraints: {
                compileBoard: null,
                allowedTargetIds: this._deviceInfo?.allowedWebTargetIds ?? null,
            },
        });

        if (!selection?.confirmed) {
            return {
                confirmed: false,
                error:
                    selection?.error ||
                    'Device onboarding is required before continuing with this embedded runtime.',
            };
        }

        const runtimeId =
            typeof runtimeIdentity.id === 'string' && runtimeIdentity.id.trim().length > 0
                ? runtimeIdentity.id
                : null;
        if (!runtimeId) {
            return {
                confirmed: false,
                error: 'Onboarding failed: runtime id is missing.',
            };
        }

        const selectedTargetId =
            typeof selection.selectedTargetId === 'string' &&
            selection.selectedTargetId.trim().length > 0
                ? selection.selectedTargetId
                : null;
        if (!selectedTargetId) {
            return {
                confirmed: false,
                error: 'Onboarding failed: selected target id is missing.',
            };
        }

        await this._embeddedOnboardingAdapter.uploadTargetConfiguration({
            runtimeId,
            targetId: selectedTargetId,
            userDescription: selection.userDescription || '',
        });

        return {
            confirmed: true,
            selectedTargetId,
            userDescription: selection.userDescription || '',
        };
    }

    async _readEmbeddedMetadataBundleFromDevice(): Promise<{
        runtimeMode: 'embedded' | 'dynamic' | 'unknown';
        runtimeId: string | null;
        runtimeName: string | null;
        runtimeVersion: string | null;
        runtimeDescription: string | null;
        allowedWebTargetIds: string[] | null;
        buildBaseTargetId: string | null;
        embeddedPackagesSummary: EmbeddedPackagesSummary | null;
        embeddedInventory: EmbeddedInventory | null;
    } | null> {
        const startMarker = '__OTTER_EMBEDDED_DEBUG_API_START__';
        const endMarker = '__OTTER_EMBEDDED_DEBUG_API_END__';
        const code = `
import json
print('${startMarker}')
try:
    import otter_runtime.embedded_metadata_api as _otter_embedded_metadata_api
    _payload = _otter_embedded_metadata_api.get_embedded_metadata_bundle()
    _runtime = _payload.get('runtime') if isinstance(_payload, dict) else None
    _summary = _payload.get('packagesSummary') if isinstance(_payload, dict) else None
    _inventory = _payload.get('inventory') if isinstance(_payload, dict) else None
    _target = _runtime.get('target') if isinstance(_runtime, dict) else None
    print(json.dumps({
        'ok': True,
        'runtimeMode': _runtime.get('mode') if isinstance(_runtime, dict) else None,
        'runtimeId': _runtime.get('id') if isinstance(_runtime, dict) else None,
        'runtimeName': _runtime.get('name') if isinstance(_runtime, dict) else None,
        'runtimeVersion': _runtime.get('version') if isinstance(_runtime, dict) else None,
        'runtimeDescription': _runtime.get('description') if isinstance(_runtime, dict) else None,
        'allowedWebTargetIds': (
            _target.get('allowedWebTargetIds') if isinstance(_target, dict) else None
        ),
        'buildBaseTargetId': (
            _target.get('buildBaseTargetId') if isinstance(_target, dict) else None
        ),
        'embeddedPackagesSummary': _summary if isinstance(_summary, dict) else None,
        'embeddedInventory': (
            _inventory.get('files') if isinstance(_inventory, dict)
            else (_inventory if isinstance(_inventory, list) else None)
        ),
    }))
except Exception as _otter_embedded_api_error:
    print(json.dumps({'ok': False, 'error': str(_otter_embedded_api_error)}))
print('${endMarker}')
        `.trim();

        try {
            const output = await this.executeCode(code);
            const text = String(output ?? '');
            const start = text.indexOf(startMarker);
            const end = text.indexOf(endMarker);
            if (start === -1 || end === -1 || end <= start) {
                this._log(
                    'embedded-metadata-api-probe-result',
                    `ok=false; reason=missing-markers; outputLength=${text.length}`
                );
                return null;
            }

            const payloadText = text.slice(start + startMarker.length, end).trim();
            if (!payloadText) {
                this._log('embedded-metadata-api-probe-result', 'ok=false; reason=empty-payload');
                return null;
            }

            const payload = JSON.parse(payloadText);
            if (!payload || payload.ok !== true) {
                this._log(
                    'embedded-metadata-api-probe-result',
                    `ok=false; error=${payload?.error || 'unknown'}`
                );
                return null;
            }

            const runtimeMode =
                payload.runtimeMode === 'embedded'
                    ? 'embedded'
                    : payload.runtimeMode === 'dynamic'
                      ? 'dynamic'
                      : 'unknown';
            const runtimeId = typeof payload.runtimeId === 'string' ? payload.runtimeId : null;
            const runtimeName =
                typeof payload.runtimeName === 'string' ? payload.runtimeName : null;
            const runtimeVersion =
                typeof payload.runtimeVersion === 'string' ? payload.runtimeVersion : null;
            const runtimeDescription =
                typeof payload.runtimeDescription === 'string' ? payload.runtimeDescription : null;

            const allowedWebTargetIds = Array.isArray(payload.allowedWebTargetIds)
                ? (payload.allowedWebTargetIds as unknown[])
                      .filter((entry): entry is string => typeof entry === 'string')
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0)
                : null;

            const buildBaseTargetId =
                typeof payload.buildBaseTargetId === 'string' && payload.buildBaseTargetId.trim()
                    ? payload.buildBaseTargetId.trim()
                    : null;

            const summaryPayload = payload.embeddedPackagesSummary;
            const embeddedPackagesSummary =
                summaryPayload && typeof summaryPayload === 'object'
                    ? {
                          totalPackages: Number(
                              (summaryPayload as Record<string, unknown>).totalPackages || 0
                          ),
                          totalFiles: Number(
                              (summaryPayload as Record<string, unknown>).totalFiles || 0
                          ),
                          totalBytes: Number(
                              (summaryPayload as Record<string, unknown>).totalBytes || 0
                          ),
                          packages: Array.isArray(
                              (summaryPayload as Record<string, unknown>).packages
                          )
                              ? ((summaryPayload as Record<string, unknown>).packages as Array<{
                                    name: string;
                                    version?: string | null;
                                    files?: number | null;
                                    bytes?: number | null;
                                }>)
                              : undefined,
                      }
                    : null;

            const inventoryPayload = payload.embeddedInventory;
            const embeddedInventory: EmbeddedInventory | null = Array.isArray(inventoryPayload)
                ? {
                      files: (inventoryPayload as unknown[])
                          .filter(
                              (e): e is Record<string, unknown> =>
                                  e != null && typeof e === 'object'
                          )
                          .map((e) => ({
                              path: typeof e.path === 'string' ? e.path : '',
                              packageId: typeof e.packageId === 'string' ? e.packageId : null,
                              packageVersion:
                                  typeof e.packageVersion === 'string' ? e.packageVersion : null,
                              fileKind: typeof e.fileKind === 'string' ? e.fileKind : '',
                              source: typeof e.source === 'string' ? e.source : '',
                          })),
                  }
                : null;

            this._log(
                'embedded-metadata-api-probe-result',
                `ok=true; runtimeMode=${payload.runtimeMode || 'none'}; runtimeId=${payload.runtimeId || 'none'}; runtimeVersion=${payload.runtimeVersion || 'none'}`
            );
            return {
                runtimeMode,
                runtimeId,
                runtimeName,
                runtimeVersion,
                runtimeDescription,
                allowedWebTargetIds,
                buildBaseTargetId,
                embeddedPackagesSummary,
                embeddedInventory,
            };
        } catch (error: any) {
            this._log(
                'embedded-metadata-api-probe-result',
                `ok=false; reason=execute-error; error=${error?.message || String(error)}`
            );
            return null;
        }
    }

    async _readBootstrapSetupStatusFromDevice(): Promise<BootstrapSetupStatusSummary | null> {
        const startMarker = '__OTTER_BOOTSTRAP_STATUS_START__';
        const endMarker = '__OTTER_BOOTSTRAP_STATUS_END__';
        const code = `
import json
print('${startMarker}')
try:
    import otter_runtime.embedded_metadata_api as _otter_embedded_metadata_api
    _payload = _otter_embedded_metadata_api.get_bootstrap_setup_status()
    print(json.dumps({'ok': True, 'payload': _payload}))
except Exception as _otter_bootstrap_status_error:
    print(json.dumps({'ok': False, 'error': str(_otter_bootstrap_status_error)}))
print('${endMarker}')
        `.trim();

        try {
            const output = await this.executeCode(code);
            const text = String(output ?? '');
            const start = text.indexOf(startMarker);
            const end = text.indexOf(endMarker);
            if (start === -1 || end === -1 || end <= start) {
                return null;
            }

            const payloadText = text.slice(start + startMarker.length, end).trim();
            if (!payloadText) {
                return null;
            }

            const envelope = JSON.parse(payloadText) as {
                ok?: boolean;
                payload?: unknown;
            };
            if (!envelope || envelope.ok !== true || !envelope.payload) {
                return null;
            }

            const payload = envelope.payload as Record<string, unknown>;
            const schemaVersion = Number(payload.schemaVersion);
            const ready = Boolean(payload.ready);
            const files = Array.isArray(payload.files)
                ? payload.files.map((entry) => {
                      const item = (entry || {}) as Record<string, unknown>;
                      return {
                          path: String(item.path || ''),
                          exists: Boolean(item.exists),
                          valid: Boolean(item.valid),
                          reason:
                              typeof item.reason === 'string' && item.reason.length > 0
                                  ? item.reason
                                  : null,
                      };
                  })
                : [];
            const missingOrInvalid = Array.isArray(payload.missingOrInvalid)
                ? payload.missingOrInvalid.map((entry) => {
                      const item = (entry || {}) as Record<string, unknown>;
                      return {
                          path: String(item.path || ''),
                          reason: String(item.reason || ''),
                      };
                  })
                : [];
            const errors = Array.isArray(payload.errors)
                ? payload.errors.map((entry) => {
                      const item = (entry || {}) as Record<string, unknown>;
                      return {
                          category: String(item.category || 'unknown'),
                          message: String(item.message || ''),
                          path:
                              typeof item.path === 'string' && item.path.length > 0
                                  ? item.path
                                  : null,
                      };
                  })
                : [];

            if (!Number.isFinite(schemaVersion)) {
                return null;
            }

            return {
                schemaVersion,
                ready,
                files,
                missingOrInvalid,
                errors,
            };
        } catch {
            return null;
        }
    }

    _resolveInitializationVerdict({
        runtimePresent,
        specificTargetPresent,
        runtimeDeploymentMode,
    }: {
        runtimePresent: boolean;
        specificTargetPresent: boolean;
        runtimeDeploymentMode: 'embedded' | 'dynamic' | 'unknown';
    }): DeviceInitializationVerdict {
        if (!runtimePresent) {
            return 'ready-for-runtime-install';
        }

        if (specificTargetPresent) {
            return 'ready';
        }

        if (runtimeDeploymentMode === 'embedded') {
            return 'needs-onboarding';
        }

        if (runtimeDeploymentMode === 'dynamic') {
            return 'ready-for-runtime-install';
        }

        return 'ready';
    }

    _emitDeviceInitializationStatus(detail: DeviceInitializationStatusDetail): void {
        this.dispatchEvent(
            new CustomEvent('device-initialization-status', {
                detail,
            })
        );
    }

    /**
     * Normalize JSON text read from device (handles Python bytes literals).
     *
     * @param {string} text - Raw text content
     * @returns {string} Normalized JSON string
     * @private
     */
    _normalizeJsonText(text: string): string {
        if (typeof text !== 'string') {
            return '';
        }

        const trimmed = text.trim();
        const startsWithSingle = trimmed.startsWith("b'") && trimmed.endsWith("'");
        const startsWithDouble = trimmed.startsWith('b"') && trimmed.endsWith('"');

        if (startsWithSingle || startsWithDouble) {
            const content = trimmed.slice(2, -1);
            return content
                .replace(/\\r/g, '\r')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
        }

        return trimmed;
    }

    /**
     * Fetch custom view JSON from device or host
     *
     * Priority: Try device first, fallback to host if not available
     *
     * @param {string} runtimeId - Runtime identifier (e.g., 'general')
     * @param {string} filename - Custom view filename (e.g., 'custom_view.json')
     * @returns {Promise<Object>} Custom view definition
     * @private
     */
    async _fetchCustomView(runtimeId: string, filename: string): Promise<Record<string, unknown>> {
        // 1. Try to fetch from device
        try {
            const devicePath = `/${filename}`;
            const deviceData = await this.readTextFile(devicePath);
            return JSON.parse(this._normalizeJsonText(deviceData));
        } catch (error: any) {
            this._log('custom-view-not-on-device', {
                runtimeId,
                filename,
                error: error.message,
            });
        }

        // 2. Fallback: fetch from host filesystem
        try {
            const hostPath = `/device/runtime/${runtimeId}/${filename}`;
            const response = await fetch(hostPath);
            if (response.ok) {
                return await response.json();
            }
        } catch (error: any) {
            this._log('custom-view-host-fetch-failed', {
                runtimeId,
                filename,
                error: error.message,
            });
        }

        const errorMsg = `Custom view not found on device or host: ${filename}`;
        throw new Error(errorMsg);
    }

    /**
     * Load custom view locale files and merge with I18nService
     *
     * @param {string} runtimeId - Runtime identifier
     * @returns {Promise<void>}
     * @private
     */
    async _loadCustomViewLocales(runtimeId: string): Promise<void> {
        if (!this._i18nService) {
            return;
        }

        const currentLang =
            this._i18nService.getCurrentLanguage?.() || this._i18nService.currentLocale || 'en';
        const localeFilename = `locales/${currentLang}.json`;

        try {
            // 1. Try device first
            let localeData;
            try {
                const devicePath = `/${localeFilename}`;
                const deviceLocale = await this.readTextFile(devicePath);
                localeData = JSON.parse(this._normalizeJsonText(deviceLocale));
            } catch {
                // 2. Fallback to host
                const hostPath = `/device/runtime/${runtimeId}/${localeFilename}`;
                const response = await fetch(hostPath);
                if (response.ok) {
                    localeData = await response.json();
                } else {
                    throw new Error(`Locale file not found: ${localeFilename}`);
                }
            }

            // Merge locale data into I18nService
            const normalizedLocaleData = this._normalizeCustomViewLocalePayload(
                localeData,
                currentLang
            );
            this._i18nService.mergeTranslations(currentLang, normalizedLocaleData);

            // Subscribe to language changes to reload locales
            if (!this._languageChangeListener) {
                this._languageChangeListener = (event: Event) => {
                    const detail = (event as CustomEvent<LanguageChangeDetail>)?.detail || {};
                    const newLang = detail.locale || detail.language || null;
                    const previousLang = detail.previousLocale || detail.previousLanguage || null;

                    if (!newLang || newLang === previousLang) {
                        return;
                    }

                    void this._loadCustomViewLocales(runtimeId);
                };
                this._i18nService.addEventListener('languagechange', this._languageChangeListener);
            }
        } catch (error: any) {
            this._log('locale-load-failed', {
                localeFilename,
                error: error.message,
            });
            // Non-fatal: custom view can still work with fallback keys
        }
    }

    /**
     * Normalize custom view locale payloads to a plain translation map.
     *
     * Accepts these common shapes:
     * - Direct translation map: { generalRuntime: {...}, customView: {...} }
     * - Wrapped map: { translations: {...} } or { messages: {...} }
     * - Language bucket: { de: {...} } or { locales: { de: {...} } }
     *
     * @param {object} localeData - Parsed locale payload
     * @param {string} language - Active language code
     * @returns {object} Translation map compatible with I18nService.mergeTranslations
     * @private
     */
    _normalizeCustomViewLocalePayload(
        localeData: Record<string, unknown>,
        language: string
    ): Record<string, unknown> {
        if (!localeData || typeof localeData !== 'object' || Array.isArray(localeData)) {
            return {};
        }

        if (localeData.translations && typeof localeData.translations === 'object') {
            return asRecord(localeData.translations);
        }

        if (localeData.messages && typeof localeData.messages === 'object') {
            return asRecord(localeData.messages);
        }

        if (localeData.locales && typeof localeData.locales === 'object') {
            const locales = asRecord(localeData.locales);
            const localeBucket = locales[language] || locales.en;
            if (localeBucket && typeof localeBucket === 'object') {
                return asRecord(localeBucket);
            }
        }

        if (localeData[language] && typeof localeData[language] === 'object') {
            return asRecord(localeData[language]);
        }

        return asRecord(localeData);
    }

    /**
     * Execute Python code on device
     * Automatically re-enters raw REPL mode if previously exited (e.g., after deployment)
     * @param {string} code - Python code to execute
     * @returns {Promise<string>} Output from execution
     * @throws {Error} If not connected or execution fails
     */
    async executeCode(code: string): Promise<string> {
        this._ensureConnected();

        try {
            // Re-enter raw REPL if we've exited (idempotent - safe to call when already in raw REPL)
            await this._ensureRawReplReady();

            const result = await this._executeRawCommand(code);
            const output = new TextDecoder().decode(result);
            return output;
        } catch (error: unknown) {
            this._log('code-execution-failed', {
                error: toErrorMessage(error),
                codeLength: code.length,
                codePreview: code.substring(0, 100),
            });
            throw error;
        }
    }

    /**
     * Execute Python code on device and keep stdout and stderr apart.
     *
     * Helper functions inside the runtime report failures by printing `ERROR: ...`
     * on stdout, while uncaught exceptions and tracebacks arrive on stderr. Both
     * are needed to tell a failed command from a successful one with empty output.
     *
     * @param {string} code - Python code to execute
     * @returns {Promise<{stdout: string, stderr: string}>} Decoded output streams
     * @throws {Error} If not connected or execution fails
     */
    async executeCodeDetailed(code: string): Promise<{ stdout: string; stderr: string }> {
        this._ensureConnected();

        try {
            await this._ensureRawReplReady();

            const frame = await this._executeRawCommandDetailed(code, this._commandTimeout);
            return {
                stdout: new TextDecoder().decode(frame.stdout),
                stderr: new TextDecoder().decode(frame.stderr),
            };
        } catch (error: unknown) {
            this._log('code-execution-failed', {
                error: toErrorMessage(error),
                codeLength: code.length,
                codePreview: code.substring(0, 100),
            });
            throw error;
        }
    }

    /**
     * Enter raw REPL when the connection is not in it already.
     * @private
     * @returns {Promise<void>}
     */
    private async _ensureRawReplReady(): Promise<void> {
        if (!this.isRawRepl()) {
            await this._enterRawRepl();
        }
    }

    /**
     * Execute a custom-view function through a dedicated connection boundary.
     *
     * Step 2 scope: accepts runtime-impact metadata and routes execution via the
     * standard command path. Transition semantics for impacts are handled in
     * later steps.
     *
     * @param {string} functionName - Device helper function name
     * @param {unknown[]} parameters - Positional function arguments
     * @param {CustomViewActionOptions} options - Custom action metadata
     * @returns {Promise<string>} Raw function output
     */
    async executeCustomViewAction(
        functionName: string,
        parameters: unknown[] = [],
        options: CustomViewActionOptions = {}
    ): Promise<string> {
        if (!functionName || typeof functionName !== 'string') {
            throw new Error('Custom view function name is required');
        }

        const normalizedParameters = Array.isArray(parameters) ? parameters : [];
        const hasExplicitRuntimeImpact =
            Object.prototype.hasOwnProperty.call(options, 'runtimeImpact') &&
            options.runtimeImpact !== undefined;
        const explicitRuntimeImpact = options.runtimeImpact || 'none';
        if (!CUSTOM_VIEW_RUNTIME_IMPACTS.includes(explicitRuntimeImpact)) {
            throw new Error(
                `Unsupported custom view runtimeImpact: ${String(explicitRuntimeImpact)}`
            );
        }

        const command = this._buildCustomViewActionCommand(functionName, normalizedParameters);

        this._log('custom-view-action', {
            functionName,
            runtimeImpact: explicitRuntimeImpact,
            parameterCount: normalizedParameters.length,
        });

        if (explicitRuntimeImpact !== 'none') {
            return this._executeCustomViewActionWithRuntimeImpact(
                functionName,
                command,
                explicitRuntimeImpact
            );
        }

        const result = await this.executeCode(command);
        const parsedDirective = this._parseCustomViewRuntimeImpactDirective(result);

        if (!parsedDirective.isValidDirective) {
            this._log('custom-view-action-invalid-runtime-impact-directive-ignored', {
                functionName,
                runtimeImpact: result,
            });
            return result;
        }

        const directiveRuntimeImpact = parsedDirective.runtimeImpact;
        const shouldApplyDirective =
            (directiveRuntimeImpact === 'stop' || directiveRuntimeImpact === 'restart') &&
            (!hasExplicitRuntimeImpact || explicitRuntimeImpact === 'none');

        if (shouldApplyDirective) {
            await this._applyCustomViewRuntimeImpactTransition(
                functionName,
                directiveRuntimeImpact
            );
        }

        return result;
    }

    /**
     * Execute a custom-view refresh/read helper through the dedicated refresh API.
     *
     * @param {string} functionName - Device helper function name
     * @param {unknown[]} parameters - Positional function arguments
     * @param {CustomViewRefreshActionOptions} options - Refresh action metadata
     * @returns {Promise<string>} Raw function output
     */
    async executeCustomViewRefreshAction(
        functionName: string,
        parameters: unknown[] = [],
        options: CustomViewRefreshActionOptions
    ): Promise<string> {
        if (!functionName || typeof functionName !== 'string') {
            throw new Error('Custom view refresh function name is required');
        }
        if (!options || typeof options !== 'object') {
            throw new Error('Custom view refresh options are required');
        }
        if (!Object.prototype.hasOwnProperty.call(options, 'runtimeImpact')) {
            throw new Error('Custom view refresh runtimeImpact must be declared explicitly');
        }

        const normalizedParameters = Array.isArray(parameters) ? parameters : [];
        const command = this._buildCustomViewActionCommand(functionName, normalizedParameters);

        return this.executeRuntimeRefresh({
            intent: functionName,
            command,
            runtimeImpact: options.runtimeImpact,
            source: options.source || 'custom-view-action',
        });
    }

    /**
     * Execute a generic runtime command/script with explicit execution intent.
     *
     * Unlike executeCode(), this API carries intent + impact metadata so
     * callers can use canonical transition/event semantics for non-helper paths.
     *
     * @param {RuntimeCommandOptions} options - Runtime command options
     * @returns {Promise<string>} Raw command output
     */
    async executeRuntimeCommand(options: RuntimeCommandOptions): Promise<string> {
        if (!options || typeof options !== 'object') {
            throw new Error('Runtime command options are required');
        }

        const intent = typeof options.intent === 'string' ? options.intent.trim() : '';
        const command = typeof options.command === 'string' ? options.command.trim() : '';
        if (!intent) {
            throw new Error('Runtime command intent is required');
        }
        if (!command) {
            throw new Error('Runtime command script is required');
        }

        const runtimeImpact = options.runtimeImpact || 'none';
        if (!CUSTOM_VIEW_RUNTIME_IMPACTS.includes(runtimeImpact)) {
            throw new Error(`Unsupported runtime command runtimeImpact: ${String(runtimeImpact)}`);
        }

        const source = options.source || EXECUTION_EVENT_SOURCE_RUNTIME_COMMAND;
        this._log('runtime-command', {
            intent,
            source,
            runtimeImpact,
            commandLength: command.length,
        });

        if (runtimeImpact === 'none') {
            return this.executeCode(command);
        }

        return this._executeRuntimeCommandWithRuntimeImpact(intent, command, runtimeImpact, source);
    }

    /**
     * Execute a refresh/read runtime command with explicit impact metadata.
     *
     * @param {RuntimeRefreshOptions} options - Runtime refresh options
     * @returns {Promise<string>} Raw command output
     */
    async executeRuntimeRefresh(options: RuntimeRefreshOptions): Promise<string> {
        if (!options || typeof options !== 'object') {
            throw new Error('Runtime refresh options are required');
        }

        if (!Object.prototype.hasOwnProperty.call(options, 'runtimeImpact')) {
            throw new Error('Runtime refresh runtimeImpact must be declared explicitly');
        }

        return this.executeRuntimeCommand({
            ...options,
            source: options.source || EXECUTION_EVENT_SOURCE_RUNTIME_REFRESH,
        });
    }

    async _executeCustomViewActionWithRuntimeImpact(
        functionName: string,
        command: string,
        runtimeImpact: Exclude<CustomViewRuntimeImpact, 'none'>
    ): Promise<string> {
        const handleTransitionFailure = async (
            transitionStep: CustomViewTransitionStep,
            error: unknown,
            emitFailureEvent = true
        ): Promise<never> => {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this._isExecuting = false;

            if (this._state === ConnectionState.CONNECTED) {
                try {
                    await this._enterRawRepl();
                } catch {
                    // Keep flags deterministic even when REPL recovery fails.
                    this._isRawRepl = false;
                }
            } else {
                this._isRawRepl = false;
            }

            if (emitFailureEvent) {
                this._emitExecutionStopped({
                    source: 'custom-view-action',
                    cause: `custom-view-runtime-impact-${runtimeImpact}-${transitionStep}-error`,
                    error: errorMessage,
                    functionName,
                    runtimeImpact,
                    transitionStep,
                });
            }

            this._log('custom-view-action-transition-failed', {
                functionName,
                runtimeImpact,
                transitionStep,
                error: errorMessage,
            });

            throw error;
        };

        if (runtimeImpact === 'stop') {
            try {
                await this.stopExecution({
                    source: 'custom-view-action',
                    cause: 'custom-view-runtime-impact-stop',
                });
            } catch (error: any) {
                return handleTransitionFailure('pre-stop', error);
            }

            try {
                return await this.executeCode(command);
            } catch (error: any) {
                return handleTransitionFailure('function-execution', error);
            }
        }

        try {
            await this.stopExecution({
                source: 'custom-view-action',
                cause: 'custom-view-runtime-impact-restart-stop',
            });
        } catch (error: any) {
            return handleTransitionFailure('pre-stop', error);
        }

        let result = '';
        try {
            result = await this.executeCode(command);
        } catch (error: any) {
            return handleTransitionFailure('function-execution', error);
        }

        try {
            await this.startMain({
                source: 'custom-view-action',
                cause: 'custom-view-runtime-impact-restart-start',
                functionName,
                runtimeImpact,
                transitionStep: 'post-restart',
            });
        } catch (error: any) {
            return handleTransitionFailure('post-restart', error, false);
        }

        return result;
    }

    async _executeRuntimeCommandWithRuntimeImpact(
        intent: string,
        command: string,
        runtimeImpact: Exclude<CustomViewRuntimeImpact, 'none'>,
        source: string
    ): Promise<string> {
        const handleTransitionFailure = async (
            transitionStep: CustomViewTransitionStep,
            error: unknown,
            emitFailureEvent = true
        ): Promise<never> => {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this._isExecuting = false;

            if (this._state === ConnectionState.CONNECTED) {
                try {
                    await this._enterRawRepl();
                } catch {
                    this._isRawRepl = false;
                }
            } else {
                this._isRawRepl = false;
            }

            if (emitFailureEvent) {
                this._emitExecutionStopped({
                    source,
                    cause: `runtime-command-impact-${runtimeImpact}-${transitionStep}-error`,
                    error: errorMessage,
                    functionName: intent,
                    runtimeImpact,
                    transitionStep,
                });
            }

            this._log('runtime-command-transition-failed', {
                intent,
                source,
                runtimeImpact,
                transitionStep,
                error: errorMessage,
            });

            throw error;
        };

        if (runtimeImpact === 'stop') {
            try {
                await this.stopExecution({
                    source,
                    cause: 'runtime-command-impact-stop',
                    functionName: intent,
                    runtimeImpact,
                });
            } catch (error: any) {
                return handleTransitionFailure('pre-stop', error);
            }

            try {
                return await this.executeCode(command);
            } catch (error: any) {
                return handleTransitionFailure('function-execution', error);
            }
        }

        try {
            await this.stopExecution({
                source,
                cause: 'runtime-command-impact-restart-stop',
                functionName: intent,
                runtimeImpact,
            });
        } catch (error: any) {
            return handleTransitionFailure('pre-stop', error);
        }

        let result = '';
        try {
            result = await this.executeCode(command);
        } catch (error: any) {
            return handleTransitionFailure('function-execution', error);
        }

        try {
            await this.startMain({
                source,
                cause: 'runtime-command-impact-restart-start',
                functionName: intent,
                runtimeImpact,
                transitionStep: 'post-restart',
            });
        } catch (error: any) {
            return handleTransitionFailure('post-restart', error, false);
        }

        return result;
    }

    async _applyCustomViewRuntimeImpactTransition(
        functionName: string,
        runtimeImpact: Exclude<CustomViewRuntimeImpact, 'none'>
    ): Promise<void> {
        if (runtimeImpact === 'stop') {
            await this.stopExecution({
                source: 'custom-view-action',
                cause: 'custom-view-runtime-impact-stop',
                functionName,
                runtimeImpact,
                transitionStep: 'post-restart',
            });
            return;
        }

        await this.stopExecution({
            source: 'custom-view-action',
            cause: 'custom-view-runtime-impact-restart-stop',
            functionName,
            runtimeImpact,
            transitionStep: 'post-restart',
        });

        await this.startMain({
            source: 'custom-view-action',
            cause: 'custom-view-runtime-impact-restart-start',
            functionName,
            runtimeImpact,
            transitionStep: 'post-restart',
        });
    }

    _parseCustomViewRuntimeImpactDirective(output: string): ParsedRuntimeImpactDirective {
        if (!output || typeof output !== 'string') {
            return { runtimeImpact: null, isValidDirective: true };
        }

        const trimmed = output.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            return { runtimeImpact: null, isValidDirective: true };
        }

        try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            if (!Object.prototype.hasOwnProperty.call(parsed, 'runtimeImpact')) {
                return { runtimeImpact: null, isValidDirective: true };
            }

            const runtimeImpact = parsed.runtimeImpact;
            if (runtimeImpact === undefined || runtimeImpact === null || runtimeImpact === '') {
                return { runtimeImpact: null, isValidDirective: true };
            }

            if (
                runtimeImpact === 'none' ||
                runtimeImpact === 'stop' ||
                runtimeImpact === 'restart'
            ) {
                return {
                    runtimeImpact,
                    isValidDirective: true,
                };
            }

            return {
                runtimeImpact: null,
                isValidDirective: false,
            };
        } catch {
            return { runtimeImpact: null, isValidDirective: true };
        }
    }

    _buildCustomViewActionCommand(functionName: string, parameters: unknown[]): string {
        const argString = parameters.map((value) => this._pythonLiteral(value)).join(', ');
        return `import otter_runtime.custom_settings as custom_settings; print(custom_settings.${functionName}(${argString}))`;
    }

    _pythonLiteral(value: unknown): string {
        if (value === null || value === undefined) {
            return 'None';
        }

        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }

        if (typeof value === 'number') {
            return String(value);
        }

        if (typeof value === 'string') {
            // JSON string escaping is also a valid Python double-quoted literal and
            // handles quotes, backslashes, and control characters correctly.
            return JSON.stringify(value);
        }

        if (Array.isArray(value)) {
            return `[${value.map((item) => this._pythonLiteral(item)).join(', ')}]`;
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>)
                .map(([key, val]) => `${this._pythonLiteral(key)}: ${this._pythonLiteral(val)}`)
                .join(', ');
            return `{${entries}}`;
        }

        throw new Error(`Cannot convert value to Python literal: ${String(value)}`);
    }

    /**
     * Send Ctrl+C to interrupt any running code.
     * @returns {Promise<void>}
     * @throws {Error} If not connected
     */
    async sendControlC(): Promise<void> {
        this._ensureConnected();
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        try {
            await connection.send('\x03');
            await this._delay(100);
            this._log('control-c-sent');
        } catch (error: any) {
            this._log('control-c-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * List all files recursively on the device with tree-style ASCII art.
     * @param {string} startPath - Starting directory path (default: "/")
     * @returns {Promise<string>} Tree representation of files
     */
    async listFilesRecursive(startPath = '/'): Promise<string> {
        const command = `
import os

def list_tree(path="/", prefix="", is_last=True):
    try:
        items = sorted(os.listdir(path))
    except:
        print(prefix + "[ERROR reading directory]")
        return
    
    for i, item in enumerate(items):
        is_last_item = (i == len(items) - 1)
        current = path + "/" + item if path != "/" else "/" + item
        
        # Simple ASCII art: +-- for last item, |-- for middle items
        connector = "+-- " if is_last_item else "|-- "
        print(prefix + connector + item)
        
        # Check if it's a directory
        try:
            os.listdir(current)
            # It's a directory, recurse
            extension = "    " if is_last_item else "|   "
            list_tree(current, prefix + extension, is_last_item)
        except:
            # It's a file or inaccessible
            pass

print("\\n=== File Tree ===")
print("${startPath}")
list_tree("${startPath}")
print("=== End Tree ===")
`;

        const result = await this.executeCode(command);
        return result;
    }

    /**
     * Wait for REPL prompt (>>>).
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<string>} Response text
     * @throws {Error} If timeout or not connected
     */
    async waitForPrompt(timeout = 2000): Promise<string> {
        this._ensureConnected();
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timeout waiting for REPL prompt'));
            }, timeout);

            let buffer = '';
            const onData = (event: Event) => {
                const detail = getSerialEventDetailWithPayloadCheck(
                    asSerialCustomEvent<'data'>(event, 'DeviceConnection.waitForPrompt'),
                    'data',
                    'DeviceConnection.waitForPrompt'
                );
                buffer += detail.text || '';
                if (buffer.includes('>>>')) {
                    clearTimeout(timer);
                    connection.removeEventListener('data', onData);
                    resolve(buffer);
                }
            };

            connection.addEventListener('data', onData);
        });
    }

    /**
     * Soft reset device (Ctrl+D in REPL)
     * @returns {Promise<void>}
     * @throws {Error} If not connected
     */
    async softReset(options: SoftResetOptions = {}): Promise<void> {
        this._ensureConnected();
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        try {
            const { startRunning = false } = options;

            if (startRunning) {
                if (this.isRawRepl() && typeof this.exitRawRepl === 'function') {
                    this._emitMessage(
                        MessageType.SYSTEM,
                        'Preparing soft reset startup: exiting raw REPL'
                    );
                    await this.exitRawRepl();
                }

                this._emitMessage(MessageType.SYSTEM, 'Sending device soft reset (Ctrl+D)');
                await connection.send('\x04');
                this._isExecuting = true;
                this._isRawRepl = false;
                this._emitMessage(MessageType.SYSTEM, 'Device soft reset; runtime starting');
                return;
            }

            this._emitMessage(
                MessageType.SYSTEM,
                'Preparing soft reset: switching to controlled REPL mode'
            );

            if (!this.isRawRepl()) {
                await this._enterRawRepl();
            }

            this._emitMessage(MessageType.SYSTEM, 'Sending device soft reset (Ctrl+D)');
            await connection.send('\x04');
            this._isExecuting = false;
            this._isRawRepl = false;

            await this._delay(150);
            await this._enterRawRepl();

            this._emitMessage(MessageType.SYSTEM, 'Device soft reset; REPL control restored');
        } catch (error: any) {
            this._emitMessage(
                MessageType.ERROR,
                `Device soft reset failed: ${error?.message || 'unknown error'}`
            );
            this._log('soft-reset-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Hard reset device (machine.reset())
     * @returns {Promise<void>}
     * @throws {Error} If not connected or reset fails
     */
    async hardReset(): Promise<void> {
        this._ensureConnected();
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        try {
            const wasRawRepl = this.isRawRepl();
            const resetCommand = wasRawRepl
                ? 'import machine; machine.reset()\x04'
                : 'import machine; machine.reset()\r\n';

            this._emitMessage(MessageType.SYSTEM, 'Sending device hard reset command');
            await connection.send(resetCommand);
            this._isExecuting = false;
            // The reset ends the session, so teardown must not send Ctrl-B as well.
            this._isRawRepl = false;
            await this._delay(150);

            await this.disconnect();
            this._emitMessage(MessageType.SYSTEM, 'Device hard reset; disconnected');
        } catch (error: any) {
            this._log('hard-reset-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Stop currently executing code by sending Ctrl+C interrupt
     * @returns {Promise<void>}
     * @throws {Error} If not connected
     * @fires DeviceConnection#execution-stopped
     */
    async stopExecution(eventContext: ExecutionEventContext = {}): Promise<void> {
        this._ensureConnected();
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        try {
            this._emitMessage(MessageType.SYSTEM, 'Stopping execution (Ctrl+C)');
            await connection.send('\x03'); // Ctrl+C

            // Wait briefly for KeyboardInterrupt to be processed
            await this._delay(100);

            // Ensure runtime is halted and control is back in raw REPL.
            this._isExecuting = false;
            this._isRawRepl = false;
            await this._enterRawRepl();

            this._emitExecutionStopped({
                source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
                cause: eventContext.cause || 'toolbar-stop',
                error: eventContext.error,
            });

            this._emitMessage(MessageType.SYSTEM, 'Execution stopped');
        } catch (error: any) {
            this._emitMessage(
                MessageType.ERROR,
                `Stop execution failed: ${error?.message || 'unknown error'}`
            );
            this._log('stop-execution-failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Start execution of code on device
     * This is a convenience wrapper that can be used to signal execution start
     * @param {string} code - Python code to execute
     * @returns {Promise<void>}
     * @throws {Error} If not connected or execution fails
     * @fires DeviceConnection#execution-started
     */
    async startExecution(code: string, eventContext: ExecutionEventContext = {}): Promise<void> {
        this._ensureConnected();

        try {
            this._isExecuting = true;
            this._emitExecutionStarted({
                source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
                cause: eventContext.cause || 'start-execution',
                error: eventContext.error,
            });

            this._emitMessage(MessageType.SYSTEM, 'Starting execution');

            // Execute short-lived commands via raw command protocol
            await this.executeCode(code);

            this._isExecuting = false;
        } catch (error: any) {
            this._emitMessage(
                MessageType.ERROR,
                `Start execution failed: ${error?.message || 'unknown error'}`
            );
            this._log('start-execution-failed', { error: error.message });

            this._emitExecutionStopped({
                source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
                cause: `${eventContext.cause || 'start-execution'}-error`,
                error: error.message,
            });

            this._isExecuting = false;

            throw error;
        }
    }

    /**
     * Start (or restart) main runtime execution.
     *
     * This is the explicit Play action path and intentionally starts runtime
     * via soft reset while leaving REPL control to user code.
     * @returns {Promise<void>}
     */
    async startMain(eventContext: ExecutionEventContext = {}): Promise<void> {
        this._ensureConnected();

        try {
            this._isExecuting = true;
            this._emitExecutionStarted({
                source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
                cause: eventContext.cause || 'toolbar-play',
                error: eventContext.error,
            });

            this._emitMessage(MessageType.SYSTEM, 'Starting main runtime');
            await this.softReset({ startRunning: true });
            this._emitMessage(MessageType.SYSTEM, 'Main execution started');
        } catch (error: any) {
            this._emitMessage(
                MessageType.ERROR,
                `Start main failed: ${error?.message || 'unknown error'}`
            );
            this._emitExecutionStopped({
                ...eventContext,
                source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
                cause: `${eventContext.cause || 'toolbar-play'}-error`,
                error: error?.message,
            });
            this._isExecuting = false;
            throw error;
        }
    }

    _emitExecutionStarted(eventContext: ExecutionEventContext = {}): void {
        this.dispatchEvent(
            new CustomEvent('execution-started', {
                detail: this._buildExecutionEventDetail(eventContext),
            })
        );
    }

    _emitExecutionStopped(eventContext: ExecutionEventContext = {}): void {
        this.dispatchEvent(
            new CustomEvent('execution-stopped', {
                detail: this._buildExecutionEventDetail(eventContext),
            })
        );
    }

    _buildExecutionEventDetail(eventContext: ExecutionEventContext = {}): {
        timestamp: number;
        source: string;
        cause: string;
        error?: string;
        functionName?: string;
        runtimeImpact?: CustomViewRuntimeImpact;
        transitionStep?: CustomViewTransitionStep;
    } {
        const detail: {
            timestamp: number;
            source: string;
            cause: string;
            error?: string;
            functionName?: string;
            runtimeImpact?: CustomViewRuntimeImpact;
            transitionStep?: CustomViewTransitionStep;
        } = {
            timestamp: Date.now(),
            source: eventContext.source || EXECUTION_EVENT_SOURCE_DEFAULT,
            cause: eventContext.cause || 'unspecified',
        };

        if (eventContext.error !== undefined) {
            detail.error = eventContext.error;
        }

        if (eventContext.functionName !== undefined) {
            detail.functionName = eventContext.functionName;
        }

        if (eventContext.runtimeImpact !== undefined) {
            detail.runtimeImpact = eventContext.runtimeImpact;
        }

        if (eventContext.transitionStep !== undefined) {
            detail.transitionStep = eventContext.transitionStep;
        }

        return detail;
    }

    /**
     * Enter raw REPL mode (following mpremote protocol)
     *
     * The interrupt, the idle wait and the banner match are all byte based so the
     * entry resolves on exactly the sequence `mpremote` waits for. A failed
     * attempt is retried a bounded number of times; a transport failure aborts at
     * once, because then the port rather than the protocol is the problem.
     *
     * @private
     * @returns {Promise<void>}
     */
    async _enterRawRepl(): Promise<void> {
        if (this.isRawRepl()) {
            return;
        }

        if (this._rawReplTransitionPromise) {
            return this._rawReplTransitionPromise;
        }

        const transport = this._activeConnection;
        if (!transport) {
            throw new Error('No active serial transport for raw REPL entry');
        }

        this._rawReplTransitionPromise = this._performRawReplEntry(transport);
        return this._rawReplTransitionPromise;
    }

    /**
     * Run the bounded raw REPL entry attempts and publish the entered state.
     * @private
     * @param {SerialConnectionLike} transport - Transport to enter raw REPL on
     * @returns {Promise<void>}
     */
    private async _performRawReplEntry(transport: SerialConnectionLike): Promise<void> {
        try {
            for (let attempt = 1; attempt <= RAW_REPL_ENTRY_ATTEMPTS; attempt += 1) {
                const result = await this._attemptRawReplEntry(transport);
                this._log('enter-raw-repl-attempt', { attempt, result });

                if (result === 'entered') {
                    this._receiveBuffer = '';
                    this._isRawRepl = true;

                    this.dispatchEvent(
                        new CustomEvent('raw-repl-entered', {
                            detail: { timestamp: Date.now() },
                        })
                    );
                    return;
                }

                if (attempt < RAW_REPL_ENTRY_ATTEMPTS) {
                    await this._delay(RAW_REPL_ENTRY_RETRY_DELAY_MS);
                }
            }

            throw new Error(
                `Timeout entering raw REPL mode ` +
                    `(raw REPL entry timed out after ${RAW_REPL_ENTRY_ATTEMPTS} attempts)`
            );
        } finally {
            this._rawReplTransitionPromise = null;
        }
    }

    /**
     * Try once to reach the raw REPL prompt.
     *
     * Transport failures propagate: a rejected `send()` means the port is gone,
     * and another attempt would only delay the real error.
     *
     * @private
     * @param {SerialConnectionLike} transport - Transport to enter raw REPL on
     * @returns {Promise<'entered'|'retry'>} Outcome of this attempt
     */
    private async _attemptRawReplEntry(
        transport: SerialConnectionLike
    ): Promise<'entered' | 'retry'> {
        const reader = new RawByteReader(transport, 'DeviceConnection._enterRawRepl');
        reader.start();

        try {
            // 1. CR + Ctrl-C interrupts any running program.
            await transport.send('\r\x03');

            // 2. Let the interrupt finish printing instead of sleeping a fixed
            //    time, then drop whatever it produced.
            await this._waitForLineIdle(transport, {
                quietMs: RAW_REPL_IDLE_QUIET_MS,
                maxMs: RAW_REPL_IDLE_MAX_MS,
            });
            reader.discard();
            this._receiveBuffer = '';

            // 3. CR + Ctrl-A switches the device to raw REPL.
            await transport.send('\r\x01');

            // 4. The banner is only printed once the raw REPL prompt is ready.
            try {
                await reader.readUntilSequence(
                    RAW_REPL_BANNER_BYTES,
                    RAW_REPL_ENTRY_ATTEMPT_TIMEOUT_MS
                );
                return 'entered';
            } catch (bannerError: unknown) {
                this._log('enter-raw-repl-banner-timeout', {
                    error: toErrorMessage(bannerError),
                });
                return 'retry';
            }
        } finally {
            reader.stop();
        }
    }

    /**
     * Resolve once the transport has been silent for `quietMs` or `maxMs` elapsed.
     *
     * `mpremote` flushes whatever the interrupt printed by reading until the port
     * is idle; a fixed sleep either wastes time or truncates a long traceback.
     *
     * @private
     * @param {SerialConnectionLike} transport - Transport to observe
     * @param {{quietMs: number, maxMs: number}} options - Quiet window and overall cap
     * @returns {Promise<void>}
     */
    private async _waitForLineIdle(
        transport: SerialConnectionLike,
        options: { quietMs: number; maxMs: number }
    ): Promise<void> {
        const deadline = Date.now() + options.maxMs;
        let lastDataAt = Date.now();

        /**
         * Remember when the port last produced output.
         * @returns {void}
         */
        const onData = () => {
            lastDataAt = Date.now();
        };

        transport.addEventListener('data', onData);
        try {
            while (Date.now() < deadline && Date.now() - lastDataAt < options.quietMs) {
                await this._delay(RAW_REPL_IDLE_POLL_MS);
            }
        } finally {
            transport.removeEventListener('data', onData);
        }
    }

    /**
     * Exit raw REPL mode and return to friendly REPL
     * Sends Ctrl+B and waits for >>> prompt
     * @returns {Promise<void>}
     * @throws {Error} If not connected or exit fails
     */
    async exitRawRepl(): Promise<void> {
        if (!this.isRawRepl()) {
            return;
        }

        const transport = this._activeConnection;
        if (!transport) {
            this._isRawRepl = false;
            return;
        }

        return new Promise((resolve, reject) => {
            const removeDataListener = () => {
                transport.removeEventListener('data', dataHandler);
            };

            const timeout = setTimeout(() => {
                removeDataListener();
                reject(new Error('Timeout exiting raw REPL mode'));
            }, 5000);

            let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

            const dataHandler = (event: Event) => {
                const detail = getSerialEventDetailWithPayloadCheck(
                    asSerialCustomEvent<'data'>(event, 'DeviceConnection.exitRawRepl'),
                    'data',
                    'DeviceConnection.exitRawRepl'
                );
                const data = detail.data;
                buffer = this._appendBytes(buffer, data);
                const text = new TextDecoder().decode(buffer);

                // Wait for friendly REPL prompt (>>>)
                if (text.includes('>>>')) {
                    clearTimeout(timeout);
                    removeDataListener();
                    this._isRawRepl = false;

                    // Emit raw REPL exited event
                    this.dispatchEvent(
                        new CustomEvent('raw-repl-exited', {
                            detail: { timestamp: Date.now() },
                        })
                    );

                    resolve();
                }
            };

            transport.addEventListener('data', dataHandler);

            // Send Ctrl+B to exit raw REPL
            transport.send('\x02').catch((error) => {
                this._log('exit-raw-repl-send-error', {
                    error: error.message,
                });
                clearTimeout(timeout);
                removeDataListener();
                reject(error);
            });
        });
    }

    /**
     * Execute command in raw REPL mode
     * @private
     * @param {string} command - Python code to execute
     * @returns {Promise<Uint8Array>} Output data
     */
    async _executeRawCommand(command: string): Promise<Uint8Array> {
        return this._executeRawCommandWithTimeout(command, this._commandTimeout);
    }

    /**
     * Execute raw REPL command with custom timeout
     * @private
     * @param {string} command - Python command to execute
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<Uint8Array>} Command output
     */
    async _executeRawCommandWithTimeout(command: string, timeoutMs: number): Promise<Uint8Array> {
        const frame = await this._executeRawCommandDetailed(command, timeoutMs);
        return frame.stdout;
    }

    /**
     * Execute a command in raw REPL mode and keep stdout and stderr apart.
     *
     * The permanent console handler is detached for the duration of the frame so
     * the framed bytes are decoded exactly once, and re-attached in a `finally`
     * block so neither a timeout nor a protocol error can leave the connection
     * without its console listener.
     *
     * @private
     * @param {string} command - Python command to execute
     * @param {number} timeoutMs - Timeout in milliseconds for the whole frame
     * @returns {Promise<RawCommandFrame>} Captured stdout and stderr
     */
    async _executeRawCommandDetailed(command: string, timeoutMs: number): Promise<RawCommandFrame> {
        const connection = this._activeConnection;
        if (!connection) {
            throw new Error('No active connection');
        }

        // Interrupt background output (runtime log lines, a running program) and
        // drop whatever it printed, so it cannot be read as this frame's ack.
        this._log('execute-raw-command-clearing-buffers');
        await connection.send('\x03');
        await this._delay(RAW_INTERRUPT_SETTLE_MS);
        this._receiveBuffer = '';

        connection.removeEventListener('data', this._onConnectionData);

        try {
            const frame = await this._readRawFrame(connection, command, timeoutMs);

            if (frame.stderr.length > 0) {
                this._log('raw-command-stderr', {
                    stderr: new TextDecoder().decode(frame.stderr),
                });
            }

            try {
                this._parseMessages(new TextDecoder().decode(frame.stdout), true);
            } catch (parseError) {
                this._log('execute-raw-command-parse-captured-output-failed', {
                    error: toErrorMessage(parseError),
                });
            }

            return frame;
        } finally {
            connection.addEventListener('data', this._onConnectionData);
        }
    }

    /**
     * Write one command and read its complete response frame.
     *
     * Mirrors `mpremote`'s serial transport: stray output is discarded first, the
     * command is written in small slices with `Ctrl-D`, then the frame is read as
     * `OK` / stdout / `0x04` / stderr / `0x04` / `>`.
     *
     * @private
     * @param {SerialConnectionLike} transport - Transport to write to and read from
     * @param {string} command - Python command to execute
     * @param {number} timeoutMs - Timeout in milliseconds for the whole frame
     * @returns {Promise<RawCommandFrame>} Captured stdout and stderr
     */
    private async _readRawFrame(
        transport: SerialConnectionLike,
        command: string,
        timeoutMs: number
    ): Promise<RawCommandFrame> {
        const reader = new RawByteReader(transport, 'DeviceConnection._readRawFrame');
        const deadline = Date.now() + timeoutMs;

        /**
         * Milliseconds left in the frame budget.
         * @param {string} stage - Stage name used in the error message
         * @returns {number} Remaining milliseconds
         */
        const remaining = (stage: string): number => {
            const left = deadline - Date.now();
            if (left <= 0) {
                throw new Error(`Command timeout while waiting for ${stage}`);
            }
            return left;
        };

        reader.start();
        try {
            // Let output that is still in flight drain, then drop it.
            await this._delay(RAW_FRAME_FLUSH_MS);
            reader.discard();

            await this._writeRawCommand(transport, command);

            const ack = await reader.readExact(RAW_ACK_BYTES.length, remaining('raw REPL ack'));
            if (!bytesEqual(ack, RAW_ACK_BYTES)) {
                throw new DeviceProtocolError('Raw REPL command not acknowledged', ack);
            }

            const stdout = await reader.readUntil(RAW_EOF_BYTE, remaining('raw REPL stdout'));
            const stderr = await reader.readUntil(RAW_EOF_BYTE, remaining('raw REPL stderr'));
            await this._awaitRawPrompt(reader, remaining('raw REPL prompt'));

            return { stdout, stderr };
        } finally {
            reader.stop();
        }
    }

    /**
     * Write a command to the transport, terminated by `Ctrl-D`.
     *
     * The payload is sliced because one `send()` of a large file body can exceed
     * what the bridge and the device accept at once. The transport's own write
     * await paces the slices at the line rate, so no extra delay is needed.
     *
     * @private
     * @param {SerialConnectionLike} transport - Transport to write to
     * @param {string} command - Python command to execute
     * @returns {Promise<void>}
     */
    private async _writeRawCommand(
        transport: SerialConnectionLike,
        command: string
    ): Promise<void> {
        const payload = `${command}\x04`;
        for (let offset = 0; offset < payload.length; offset += RAW_COMMAND_CHUNK_SIZE) {
            await transport.send(payload.slice(offset, offset + RAW_COMMAND_CHUNK_SIZE));
        }
    }

    /**
     * Wait for the `>` that closes a raw REPL frame or an entry sequence.
     * @private
     * @param {RawByteReader} reader - Reader attached to the transport
     * @param {number} timeoutMs - Maximum wait in milliseconds
     * @returns {Promise<void>}
     */
    private async _awaitRawPrompt(reader: RawByteReader, timeoutMs: number): Promise<void> {
        await reader.readUntil(RAW_PROMPT_BYTE, timeoutMs);
    }

    /**
     * Convert Uint8Array to base64 string
     * @private
     * @param {Uint8Array} data - Binary data
     * @returns {string} Base64-encoded string
     */
    _arrayToBase64(data: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000; // 32KB chunks for String.fromCharCode
        for (let offset = 0; offset < data.length; offset += chunkSize) {
            const slice = data.subarray(offset, offset + chunkSize);
            binary += String.fromCharCode(...slice);
        }
        return btoa(binary);
    }

    /**
     * Escape Python string literals
     * @private
     * @param {string} value - String to escape
     * @returns {string} Escaped string
     */
    _escapePythonString(value: string): string {
        if (!value) return '';
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Build file write command
     * @private
     * @param {string} path - Destination path
     * @param {Uint8Array} data - File data
     * @returns {string} Python command
     */
    _buildFileWriteCommand(path: string, data: Uint8Array): string {
        // Convert bytes to Python bytes literal
        const bytesArray = Array.from(data)
            .map((b) => b.toString())
            .join(',');

        return `
with open('${path}', 'wb') as f:
    f.write(bytes([${bytesArray}]))
`;
    }

    /**
     * Build file read command
     * @private
     * @param {string} path - Source path
     * @returns {string} Python command
     */
    _buildFileReadCommand(path: string): string {
        return `
with open('${path}', 'rb') as f:
    print(f.read())
`;
    }

    /**
     * Handle incoming data from connection
     * @private
     * @param {CustomEvent} event - Data event
     */
    _onConnectionData(event: Event): void {
        const detail = getSerialEventDetailWithPayloadCheck(
            asSerialCustomEvent<'data'>(event, 'DeviceConnection._onConnectionData'),
            'data',
            'DeviceConnection._onConnectionData'
        );
        const data = detail.data;
        const text = new TextDecoder().decode(data);

        // Emit raw data for debugging
        this.dispatchEvent(
            new CustomEvent('raw', {
                detail: { data: text },
            })
        );

        // Parse messages
        this._parseMessages(text);
    }

    /**
     * Parse incoming text for message markers
     * @private
     * @param {string} text - Incoming text
     */
    _parseMessages(text: string, flush = false): void {
        this._receiveBuffer += text;

        // Look for complete tagged messages: [type] message
        // A message is considered complete when followed by a newline or the next tag.
        // This avoids emitting truncated messages when serial chunks split mid-line.
        // The tag list comes from LOG_PREFIXES, so it cannot drift from the console filters.
        const messageRegex = new RegExp(TAGGED_MESSAGE_PATTERN, 'gs');
        let match;
        let lastIndex = 0;

        while ((match = messageRegex.exec(this._receiveBuffer)) !== null) {
            const type = match[1];
            const message = match[2].trim();
            const matchEnd = match.index + match[0].length;
            if (!flush && matchEnd === this._receiveBuffer.length) {
                break;
            }
            if (match.index > lastIndex) {
                const rawText = this._receiveBuffer.slice(lastIndex, match.index).trim();
                if (rawText) {
                    this._emitMessage(MessageType.RAW, rawText);
                }
            }
            this._emitMessage(type, message);
            lastIndex = matchEnd;
        }

        // Keep unparsed data in buffer
        if (lastIndex > 0) {
            this._receiveBuffer = this._receiveBuffer.slice(lastIndex);
            if (this._receiveBuffer.startsWith('\r\n')) {
                this._receiveBuffer = this._receiveBuffer.slice(2);
            } else if (this._receiveBuffer.startsWith('\n')) {
                this._receiveBuffer = this._receiveBuffer.slice(1);
            }
        }

        // If no markers found but buffer is large, emit as raw
        if (this._receiveBuffer.length > 1000 && lastIndex === 0) {
            this._emitMessage(MessageType.RAW, this._receiveBuffer);
            this._receiveBuffer = '';
        }

        if (flush && this._receiveBuffer.trim()) {
            this._emitMessage(MessageType.RAW, this._receiveBuffer.trim());
            this._receiveBuffer = '';
        }
    }

    /**
     * Emit parsed message
     * @private
     * @param {string} type - Message type
     * @param {string} message - Message content
     */
    _emitMessage(type: MessageTypeValue | string, message: string): void {
        this.dispatchEvent(
            new CustomEvent('message', {
                detail: {
                    type: type,
                    message: message,
                    timestamp: Date.now(),
                },
            })
        );
    }

    /**
     * Handle connection state change
     * @private
     * @param {CustomEvent} event - State change event
     */
    _onConnectionStateChange(event: Event): void {
        const detail = getSerialEventDetailWithPayloadCheck(
            asSerialCustomEvent<'statechange'>(event, 'DeviceConnection._onConnectionStateChange'),
            'statechange',
            'DeviceConnection._onConnectionStateChange'
        );
        const state = detail.newState ?? detail.state;

        if (state === 'disconnected' && this._state === ConnectionState.CONNECTED) {
            this._cleanup();
            this._setState(ConnectionState.DISCONNECTED);
        }
    }

    /**
     * Handle connection error
     * @private
     * @param {CustomEvent} event - Error event
     */
    _onConnectionError(event: Event): void {
        const detail = getSerialEventDetailWithPayloadCheck(
            asSerialCustomEvent<'error'>(event, 'DeviceConnection._onConnectionError'),
            'error',
            'DeviceConnection._onConnectionError'
        );
        const { error } = detail;
        this._log('connection-error', { error: error.message });

        this.dispatchEvent(
            new CustomEvent('error', {
                detail: { error },
            })
        );
    }

    /**
     * Set connection state
     * @private
     * @param {ConnectionState} state - New state
     */
    _setState(state: ConnectionStateValue): void {
        const previousState = this._state;
        this._state = state;

        this.dispatchEvent(
            new CustomEvent('statechange', {
                detail: {
                    state,
                    previousState,
                },
            })
        );
    }

    /**
     * Ensure connected or throw error
     * @private
     * @throws {Error} If not connected
     */
    _ensureConnected(): void {
        if (!this.isConnected()) {
            throw new Error('Not connected to device');
        }
    }

    /**
     * Clean up connection resources
     * @private
     */
    _cleanup(): void {
        if (this._activeConnection) {
            this._activeConnection.removeEventListener('data', this._onConnectionData);
            this._activeConnection.removeEventListener(
                'statechange',
                this._onConnectionStateChange
            );
            this._activeConnection.removeEventListener('error', this._onConnectionError);
            this._activeConnection = null;
        }

        // Clean up custom view resources
        if (this._languageChangeListener && this._i18nService) {
            this._i18nService.removeEventListener('languagechange', this._languageChangeListener);
            this._languageChangeListener = null;
        }

        this._deviceInfo = null;
        this._receiveBuffer = '';
        this._isExecuting = false;
        this._isRawRepl = false;
        this._rawReplTransitionPromise = null;
    }

    /**
     * Append bytes to array
     * @private
     * @param {Uint8Array} a - First array
     * @param {Uint8Array} b - Second array
     * @returns {Uint8Array} Combined array
     */
    _appendBytes(
        a: Uint8Array<ArrayBufferLike>,
        b: Uint8Array<ArrayBufferLike>
    ): Uint8Array<ArrayBufferLike> {
        return concatBytes(a, b);
    }

    /**
     * Delay helper
     * @private
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Log message
     * @private
     * @param {string} type - Log type
     * @param {Object} [data] - Additional data
     */
    _log(type: string, data: unknown = {}, ..._unused: unknown[]): void {
        if (typeof type === 'string' && type.startsWith('execute-raw-command-')) {
            return;
        }

        if (this._logger && typeof this._logger.log === 'function') {
            this._logger.log(`[DeviceConnection] ${type}`, data);
        }
    }
}
