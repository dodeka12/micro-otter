// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Shared execution settings for node graphs.
 *
 * A graph is either executed once on device startup (`startup`), repeatedly in
 * a loop (`continuous`) with a configurable interval, once per hardware
 * interrupt (`irq`) on a named interrupt channel, once per signal event
 * (`event`), or emitted as a callable Python function (`function`). The
 * interval is a cadence period: it is the time between the start of consecutive
 * loop iterations, not a delay added after the loop body. An interval of `0`
 * means "yield once per iteration without waiting". An `irq` graph ignores the
 * cadence interval entirely: it waits on its named interrupt channel and runs
 * the loop body once per interrupt. A `function` graph is never scheduled at
 * all: the transpiler emits it as an `async def` that other graphs call, and its
 * inputs/outputs are declared in the graph settings.
 * Independently of that, a graph can be `enabled` or disabled: a disabled graph
 * is kept in the collection but excluded from transpilation.
 * The settings are edited from more than one surface (the collection settings
 * view and the graph panel toolbar), so the valid values and the normalization
 * rules live here instead of being duplicated per view.
 *
 * @module data/graph-execution-settings
 */

/** Execution strategy of a graph. */
export type ExecutionType = 'startup' | 'continuous' | 'irq' | 'event' | 'function';

/** All execution types in display order (`function` is last in every dropdown). */
export const GRAPH_EXECUTION_TYPES: readonly ExecutionType[] = ['startup', 'continuous', 'irq', 'event', 'function'];

/** Fallback used when a value is missing or unknown. */
export const DEFAULT_EXECUTION_TYPE: ExecutionType = 'continuous';

/**
 * Fallback for graphs that do not carry an explicit `enabled` flag.
 *
 * Legacy collections were stored before the flag existed, so a missing key must
 * keep the graph transpiling exactly as it did before the flag was introduced.
 */
export const DEFAULT_GRAPH_ENABLED = true;

/**
 * Smallest allowed interval between loop iterations, in milliseconds.
 *
 * `0` makes the loop yield once per iteration instead of waiting.
 */
export const MIN_SLEEP_MS = 0;

/** Fallback for missing or unusable input, and the default graph interval. */
export const DEFAULT_SLEEP_MS = 500;

/** Largest allowed interval between loop iterations, in milliseconds. */
export const MAX_SLEEP_MS = 60000;

/**
 * Normalize an arbitrary value to a known execution type.
 *
 * Accepts case-insensitive and whitespace-padded strings; everything else
 * (missing values, numbers, objects) falls back to {@link DEFAULT_EXECUTION_TYPE}.
 *
 * @param value - Raw value from storage, DOM or user input.
 * @returns A valid execution type.
 */
export function normalizeExecutionType(value: unknown): ExecutionType {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if ((GRAPH_EXECUTION_TYPES as readonly string[]).includes(normalized)) {
            return normalized as ExecutionType;
        }
    }
    return DEFAULT_EXECUTION_TYPE;
}

/**
 * Fallback and "no name" value for a graph's interrupt trigger name.
 *
 * An `irq` graph without a trigger name is invalid; the graph rules and the
 * transpiler report it. The model stores the empty string and leaves the
 * diagnostics to them.
 */
export const DEFAULT_TRIGGER_NAME = '';

/**
 * Normalize a graph's interrupt trigger name.
 *
 * Trims surrounding whitespace and preserves the remaining characters exactly:
 * names are case-sensitive, and inner spaces are kept. Anything that is not a
 * string, or that trims to empty, yields {@link DEFAULT_TRIGGER_NAME}.
 *
 * Uniqueness is not enforced here: the IRQ graph rules and the transpiler own
 * duplicate and dangling-name diagnostics, so the model never rejects a value.
 *
 * @param value - Raw value from storage, DOM or user input.
 * @returns The trimmed trigger name, or `''` when the value is unusable.
 */
export function normalizeTriggerName(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    return DEFAULT_TRIGGER_NAME;
}

/**
 * Normalize an arbitrary value to the graph's `enabled` flag.
 *
 * Only the literal boolean `false` and its string form (case-insensitive and
 * whitespace padded) disable a graph. Every other value — a missing key from a
 * legacy collection, `null`, numbers, objects — falls back to
 * {@link DEFAULT_GRAPH_ENABLED}, so a graph is transpiled unless it was
 * explicitly switched off.
 *
 * @param value - Raw value from storage, DOM or user input.
 * @returns True when the graph takes part in transpilation.
 */
export function normalizeGraphEnabled(value: unknown): boolean {
    if (value === false) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase() !== 'false';
    }
    return DEFAULT_GRAPH_ENABLED;
}

/**
 * Normalize an interval into the supported range.
 *
 * Only numbers and non-blank numeric strings are accepted. Blank strings,
 * whitespace-only strings, `null`, `undefined`, booleans, arrays, objects,
 * `NaN` and infinities fall back to {@link DEFAULT_SLEEP_MS} — never to
 * {@link MIN_SLEEP_MS}. Finite values are floored and clamped into
 * `MIN_SLEEP_MS … MAX_SLEEP_MS`; `0` is a valid result.
 *
 * @param value - Raw value (number or numeric string).
 * @returns A whole number of milliseconds inside the supported range.
 */
export function clampSleepDuration(value: unknown): number {
    const numeric =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value.trim())
              : Number.NaN;
    if (!Number.isFinite(numeric)) {
        return DEFAULT_SLEEP_MS;
    }
    return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, Math.floor(numeric)));
}

/** Trigger mode of an event-triggered graph. */
export type SignalTriggerMode = 'any' | 'all';

/** All signal trigger modes, `any` first. */
export const SIGNAL_TRIGGER_MODES: readonly SignalTriggerMode[] = ['any', 'all'];

/** Fallback and default for a graph's signal trigger mode. */
export const DEFAULT_SIGNAL_MODE: SignalTriggerMode = 'any';

/**
 * Fallback for graphs that do not carry an explicit `runOnStart` flag.
 *
 * Legacy collections were stored before the flag existed, so a missing key must
 * keep the graph running once at startup exactly as before.
 */
export const DEFAULT_RUN_ON_START = true;

/** Largest number of signals one event graph may watch. */
export const MAX_SIGNAL_COUNT = 32;

/** Largest signal name length (also used by the `signal-post` capability check). */
export const MAX_SIGNAL_NAME_LENGTH = 64;

/**
 * Normalize a graph's watched signal names.
 *
 * Only arrays are accepted (anything else becomes `[]`). Each entry is
 * stringified and trimmed, blank entries are dropped, each entry is sliced to
 * {@link MAX_SIGNAL_NAME_LENGTH}, duplicates are removed case-sensitively
 * preserving first occurrence, and the result is truncated to
 * {@link MAX_SIGNAL_COUNT}. Never throws.
 *
 * @param value - Raw value from storage or user input.
 * @returns A normalized list of signal names.
 */
export function normalizeSignalNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const names: string[] = [];
    const seen = new Set<string>();
    value.forEach((entry) => {
        const name = String(entry ?? '').trim();
        if (!name) {
            return;
        }
        const sliced = name.slice(0, MAX_SIGNAL_NAME_LENGTH);
        if (seen.has(sliced)) {
            return;
        }
        seen.add(sliced);
        names.push(sliced);
    });
    return names.slice(0, MAX_SIGNAL_COUNT);
}

/**
 * Normalize a graph's signal trigger mode.
 *
 * Only the trimmed/lower-cased string `'all'` selects `'all'`; every other
 * value falls back to {@link DEFAULT_SIGNAL_MODE}. Never throws.
 *
 * @param value - Raw value from storage or user input.
 * @returns A valid signal trigger mode.
 */
export function normalizeSignalMode(value: unknown): SignalTriggerMode {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'all') {
        return 'all';
    }
    return DEFAULT_SIGNAL_MODE;
}

/**
 * Normalize a graph's run-on-start flag.
 *
 * Only the literal boolean `false` and its string form disable it; every other
 * value falls back to {@link DEFAULT_RUN_ON_START}, so a missing key keeps a
 * legacy graph running once at startup.
 *
 * @param value - Raw value from storage, DOM or user input.
 * @returns True when the graph runs once at startup.
 */
export function normalizeRunOnStart(value: unknown): boolean {
    if (value === false) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim().toLowerCase() !== 'false';
    }
    return DEFAULT_RUN_ON_START;
}
