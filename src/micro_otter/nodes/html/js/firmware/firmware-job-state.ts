// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Pure reducer for `WS /firmware` frames.
 *
 * This is the only place a frame is decoded into UI state. The view never parses
 * frames or calls `JSON.parse` on socket data; it feeds the raw object here and
 * renders the result. Frames follow
 * ``docs/dev/firmware-compile/firmware-build-websocket-protocol.md``.
 */

/** The jobs one connection may run. */
export type FirmwareJobKind =
    | 'compile'
    | 'deploy'
    | 'scan'
    | 'list'
    | 'delete'
    | 'import'
    | 'export'
    | 'addon-install'
    | 'addon-uninstall';

/** UI phase of one job. */
export type FirmwareJobPhase =
    | 'idle'
    | 'connecting'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'timeout'
    | 'disconnected';

/** One streamed output line. */
export interface FirmwareLogLine {
    stream: 'stdout' | 'stderr';
    text: string;
    /**
     * True when the tool reprinted this line in place. The next redraw on the same
     * stream then replaces this entry instead of adding a line, which is how a
     * progress bar keeps a single line in the log.
     */
    redraw?: boolean;
}

/** The structured error the server reported in an `error` frame. */
export interface FirmwareJobError {
    code: string;
    message: string;
    hint: string | null;
    details: Record<string, unknown> | null;
}

/** Terminal frame payload, kept verbatim for the view to render. */
export interface FirmwareJobResult {
    status: 'succeeded' | 'failed' | 'cancelled' | 'timeout';
    payload: Record<string, unknown> | null;
    cleanup: Record<string, unknown> | null;
}

/** The complete job state the view renders. */
export interface FirmwareJobState {
    phase: FirmwareJobPhase;
    job: FirmwareJobKind | null;
    stage: string | null;
    message: string | null;
    log: FirmwareLogLine[];
    result: FirmwareJobResult | null;
    error: FirmwareJobError | null;
    busy: boolean;
}

/**
 * Maximum number of retained log lines. The drop-oldest rule keeps the panel
 * bounded; the view shows a badge when lines were trimmed.
 */
export const FIRMWARE_LOG_LIMIT = 2000;

/** Every `error.code` the endpoint can emit, plus the client-only codes. */
export const FIRMWARE_ERROR_CODES: readonly string[] = [
    'invalid-frame',
    'unknown-frame-type',
    'job-busy',
    'compile-disabled',
    'deploy-disabled',
    'runtime-not-found',
    'board-unknown',
    'target-unknown',
    'build-timeout',
    'internal-error',
    'unknown-package-id',
    'package-not-staged',
    'firmware-image-unavailable',
    'firmware-image-invalid',
    'firmware-not-found',
    'firmware-path-invalid',
    'firmware-package-invalid',
    'firmware-package-identity-mismatch',
    'firmware-package-checksum-mismatch',
    'firmware-package-too-large',
    'firmware-import-exists',
    'firmware-import-denied',
    'firmware-import-invalid',
    'firmware-export-exists',
    'board-not-flashable',
    'runtime-manifest-invalid',
    'flash-backend',
    'flash-error',
    'flash-firmware-image-not-found',
    'flash-tool-missing',
    'flash-monitor-not-supported',
    'flash-command',
    'flash-backend-unavailable',
    'flash-unsupported-chip',
    'flash-no-available-backend',
    'flash-unknown-backend',
    'capabilities-unavailable',
    'socket-error',
    'disconnected',
    'addon-already-installed',
    'addon-archive-invalid',
    'addon-archive-no-manifest',
    'addon-archive-not-found',
    'addon-archive-symlink',
    'addon-archive-too-large',
    'addon-archive-too-many-entries',
    'addon-archive-unpacked-too-large',
    'addon-archive-unsafe-path',
    'addon-id-conflicts-builtin',
    'addon-id-invalid',
    'addon-id-mismatch',
    'addon-manifest-forbidden-asset',
    'addon-manifest-invalid',
    'addon-manifest-missing-asset',
    'addon-manifest-missing-version',
    'addon-module-root-invalid',
    'addon-not-installed',
    'addon-variant-capabilities-missing',
    'addon-variant-hardware-missing',
    'addon-variant-manifest-invalid',
    'addon-variant-precedence-duplicate',
    'archive-path-invalid',
    'archive-too-large',
    'archive-url-invalid',
    'archive-url-blocked',
    'archive-url-redirect',
    'archive-url-unreachable',
    'archive-url-too-large',
    'fs-not-allowed',
    'fs-path-invalid',
    'fs-not-found',
    'fs-not-a-directory',
    'fs-permission-denied',
    'fs-too-many-entries',
    'fs-not-writable',
    'fs-destination-not-absolute',
];

/**
 * Return the initial idle state.
 */
export function initialFirmwareJobState(): FirmwareJobState {
    return {
        phase: 'idle',
        job: null,
        stage: null,
        message: null,
        log: [],
        result: null,
        error: null,
        busy: false,
    };
}

/**
 * Return the state entered when the view starts a job: connecting, busy, and a
 * reset log.
 */
export function startJobState(job: FirmwareJobKind): FirmwareJobState {
    return {
        phase: 'connecting',
        job,
        stage: null,
        message: null,
        log: [],
        result: null,
        error: null,
        busy: true,
    };
}

/**
 * Return the state entered when the socket hangs up mid-job. The server cancels
 * the running job on disconnect, so `busy` clears but the log and error survive.
 */
export function markDisconnected(state: FirmwareJobState): FirmwareJobState {
    return { ...state, phase: 'disconnected', busy: false };
}

/**
 * Reduce one decoded server frame into the next state.
 *
 * Pure: never mutates the input. Unknown, missing-`type`, and non-object frames
 * return the input unchanged so a newer server never breaks the view.
 */
export function reduceFirmwareFrame(
    state: FirmwareJobState,
    frame: unknown
): FirmwareJobState {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        return state;
    }
    const record = frame as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== 'string') {
        return state;
    }

    switch (type) {
        case 'status':
            return reduceStatus(state, record);
        case 'output':
            return reduceOutput(state, record);
        case 'result':
            return reduceResult(state, record);
        case 'error':
            return reduceError(state, record);
        default:
            return state;
    }
}

/**
 * Reduce a `status` frame into the next state.
 */
function reduceStatus(state: FirmwareJobState, frame: Record<string, unknown>): FirmwareJobState {
    const stateValue = frame.state;
    let phase = state.phase;
    if (stateValue === 'queued') {
        phase = 'queued';
    } else if (stateValue === 'running' || stateValue === 'done') {
        // `done` means the job body finished but the terminal frame has not
        // arrived yet, so the UI keeps showing `running`.
        phase = 'running';
    }
    return {
        ...state,
        phase,
        stage: typeof frame.stage === 'string' ? frame.stage : state.stage,
        message: typeof frame.message === 'string' ? frame.message : state.message,
    };
}

/**
 * The carriage return the process seam keeps in front of a reprinted line.
 *
 * `process_stream.py` publishes a line a tool wrote over an earlier one with this
 * marker in front of the text; it is the frame's `text` prefix, not a second field,
 * so the wire format stays "one line of the tool's own words".
 */
const REDRAW_MARKER = '\r';

/**
 * Append *line* to the log, dropping the oldest lines past the cap.
 */
function pushLogLine(state: FirmwareJobState, line: FirmwareLogLine): FirmwareJobState {
    return { ...state, log: [...state.log, line].slice(-FIRMWARE_LOG_LIMIT) };
}

/**
 * Reduce an `output` frame into the next state.
 *
 * A line that starts with the redraw marker rewrites the line the log already
 * shows, because the tool returned to column 0 and wrote over it — esptool does
 * that for every progress-bar update. Consecutive updates therefore cost one line
 * instead of several hundred, and the bar stays live.
 *
 * Only a line that is itself a reprint is rewritten: the first redraw of a run, or
 * one that arrives after an ordinary line or from the other stream, starts a new
 * line, so a real message is never silently replaced by a later bar.
 */
function reduceOutput(state: FirmwareJobState, frame: Record<string, unknown>): FirmwareJobState {
    const stream: FirmwareLogLine['stream'] = frame.stream === 'stderr' ? 'stderr' : 'stdout';
    const raw = typeof frame.text === 'string' ? frame.text : '';
    if (!raw.startsWith(REDRAW_MARKER)) {
        return pushLogLine(state, { stream, text: raw });
    }
    const text = raw.slice(REDRAW_MARKER.length);
    const last = state.log.length > 0 ? state.log[state.log.length - 1] : null;
    if (last !== null && last.redraw === true && last.stream === stream) {
        return { ...state, log: [...state.log.slice(0, -1), { ...last, text }] };
    }
    return pushLogLine(state, { stream, text, redraw: true });
}

/**
 * Reduce the single terminal `result` frame.
 */
function reduceResult(state: FirmwareJobState, frame: Record<string, unknown>): FirmwareJobState {
    const status = frame.status;
    const phase: FirmwareJobPhase =
        status === 'succeeded' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'timeout'
            ? status
            : 'failed';
    return {
        ...state,
        phase,
        busy: false,
        result: {
            status: phase,
            payload: isRecord(frame.payload) ? frame.payload : null,
            cleanup: isRecord(frame.cleanup) ? frame.cleanup : null,
        },
    };
}

/**
 * Reduce an `error` frame. `job-busy` is transient and must not clear the running
 * job's UI; every other code is terminal.
 */
function reduceError(state: FirmwareJobState, frame: Record<string, unknown>): FirmwareJobState {
    const code = typeof frame.code === 'string' ? frame.code : 'internal-error';
    const error: FirmwareJobError = {
        code,
        message: typeof frame.message === 'string' ? frame.message : code,
        hint: typeof frame.hint === 'string' ? frame.hint : null,
        details: isRecord(frame.details) ? frame.details : null,
    };
    if (code === 'job-busy') {
        return { ...state, error };
    }
    return { ...state, phase: 'failed', busy: false, error };
}

/**
 * Map a known error code to its `firmwareBuild.errors.<code>` locale key, or
 * return `null` for an unknown code (which the view renders verbatim).
 */
export function describeFirmwareError(
    error: FirmwareJobError | null
): { key: string; params: Record<string, unknown> } | null {
    if (!error || !FIRMWARE_ERROR_CODES.includes(error.code)) {
        return null;
    }
    return { key: `firmwareBuild.errors.${error.code}`, params: {} };
}

/**
 * Return whether *value* is a plain object usable as a frame payload.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

