// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Pure SplitView pane-size solver
 * @module views/split-view-sizing
 *
 * DOM-free arithmetic for the SplitView layout. Every function is pure and unit-testable so the
 * space distribution rules (span, equal distribution, fair vs authoritative requests) live in one
 * place instead of being spread across `SplitView` private methods.
 *
 * The solver works in CSS pixels along the split axis. Sizes are always returned as one value per
 * pane and never exceed `available`. SplitView converts the results back to flex-grow ratios with
 * {@link sizesToShares}.
 */

/**
 * Rendered splitter box size along the split axis, in CSS pixels.
 *
 * This is the single source of truth shared with `styles/standard/split-view.css`. The splitter
 * elements use `box-sizing: border-box` and declare exactly these sizes, so the CSS and this
 * constant must be changed together:
 * - `.split-view__splitter` (active): 6px (4px content + 2 × 1px border).
 * - `.split-view__splitter--inactive`: 4px (2px content + 2 × 1px border).
 */
export const SPLIT_VIEW_SPLITTER_THICKNESS = Object.freeze({
    active: 6,
    inactive: 4,
}) as Readonly<{ active: number; inactive: number }>;

/**
 * Static sizing facts about one pane, derived from its current constraints.
 */
export interface SplitViewPaneSpec {
    /** Minimum size along the split axis, in px (>= 0). */
    minSize: number;
    /** Maximum size along the split axis, in px (`Infinity` when unconstrained). */
    maxSize: number;
    /** True when min == max (a collapsed pane keeps its header height). */
    fixed: boolean;
}

/**
 * A request to move one pane to a specific size.
 */
export interface SplitViewSizingRequest {
    /** Index of the pane being moved. */
    index: number;
    /** Requested size along the split axis, in px. */
    size: number;
    /**
     * `authoritative` (maximize/minimize/relative/drag) may squeeze siblings to their minimum and
     * rejects the request when it cannot fit; `fair` (desiredSize hints) is capped at the pane's
     * equal share so it can never starve the other panes.
     */
    mode: 'fair' | 'authoritative';
}

/** Inputs for {@link computePaneSpan}. */
export interface SplitViewSpanInput {
    /** Host content-box extent along the split axis, in px. */
    hostSpan: number;
    /** Flex gap between every pair of adjacent flex items, in px. */
    gap: number;
    /** Per-splitter movability (true = active 6px splitter, false = inactive 4px splitter). */
    splitterMovable: readonly boolean[];
}

/**
 * Clamp a value into `[min, max]`, treating `Infinity` maxima as unconstrained.
 * @param {number} value Value to clamp.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound (`Infinity` allowed).
 * @returns {number} The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
    if (max < min) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

/**
 * Compute the span available to the panes along the split axis, after subtracting splitter boxes
 * and inter-item gaps. The result is clamped at `0`.
 * @param {SplitViewSpanInput} input Span inputs.
 * @returns {number} Available span in px, never negative.
 */
export function computePaneSpan(input: SplitViewSpanInput): number {
    let splitterSpace = 0;
    for (const movable of input.splitterMovable) {
        splitterSpace += movable
            ? SPLIT_VIEW_SPLITTER_THICKNESS.active
            : SPLIT_VIEW_SPLITTER_THICKNESS.inactive;
    }
    // A column of `n` panes and `n - 1` splitters has `2n - 2` inter-item gaps.
    const gapSpace = Math.max(0, input.gap) * Math.max(0, 2 * input.splitterMovable.length);
    return Math.max(0, input.hostSpan - splitterSpace - gapSpace);
}


/**
 * Distribute `available` over the panes as fairly as possible.
 *
 * Fixed panes take their `minSize` verbatim. The remaining space is split equally between the
 * flexible panes, then a freeze loop (max 10 rounds) pins any pane whose share exceeds its
 * `maxSize` (to `maxSize`) or falls below its `minSize` (to `minSize`) and re-equalizes the rest.
 * When the frozen minimums exceed the span (a very tight host), the flexible minimums are scaled
 * down proportionally so the result never exceeds `available`.
 * @param {number} available Available span in px.
 * @param {readonly SplitViewPaneSpec[]} panes Pane specs.
 * @returns {number[]} One size per pane; the sum never exceeds `available`.
 */
export function distributeEqual(available: number, panes: readonly SplitViewPaneSpec[]): number[] {
    const count = panes.length;
    const sizes = new Array<number>(count).fill(0);
    if (count === 0 || !Number.isFinite(available) || available <= 0) {
        return sizes;
    }

    const flexibleIndices: number[] = [];
    let fixedTotal = 0;
    for (let i = 0; i < count; i++) {
        const pane = panes[i];
        if (pane.fixed) {
            const size = clamp(pane.minSize, pane.minSize, pane.maxSize);
            sizes[i] = size;
            fixedTotal += size;
        } else {
            flexibleIndices.push(i);
        }
    }

    if (flexibleIndices.length === 0) {
        return sizes;
    }

    const pool = available - fixedTotal;
    if (pool <= 0) {
        // No room left for the flexible panes; the browser clamps them to their minimum.
        for (const i of flexibleIndices) {
            sizes[i] = 0;
        }
        return sizes;
    }

    const totalFlexMin = flexibleIndices.reduce(
        (sum, i) => sum + Math.max(0, panes[i].minSize),
        0
    );
    if (totalFlexMin > pool) {
        // Tight layout: scale the flexible minimums proportionally so the total fits.
        const scale = pool / totalFlexMin;
        for (const i of flexibleIndices) {
            sizes[i] = Math.max(0, panes[i].minSize) * scale;
        }
        return sizes;
    }

    const unfrozen = new Set(flexibleIndices);
    let remaining = pool;

    for (let round = 0; round < 10 && unfrozen.size > 0; round++) {
        const target = remaining / unfrozen.size;
        let changed = false;
        for (const i of Array.from(unfrozen)) {
            const pane = panes[i];
            let size = target;
            if (target > pane.maxSize) {
                size = pane.maxSize;
            } else if (target < pane.minSize) {
                size = pane.minSize;
            }
            if (size !== target) {
                sizes[i] = size;
                remaining -= size;
                unfrozen.delete(i);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
    }

    if (unfrozen.size > 0) {
        const share = remaining / unfrozen.size;
        for (const i of unfrozen) {
            sizes[i] = Math.max(0, share);
        }
    }

    return sizes;
}


/**
 * Resolve an authoritative request (maximize/minimize/relative/drag).
 *
 * The target pane receives `requestedSize` clamped to its own min/max; the other panes keep their
 * minimums and receive any leftover capacity in proportion to their max-min headroom. Returns
 * `null` when the request cannot fit without pushing a sibling below its minimum.
 * @param {number} available Available span in px.
 * @param {readonly SplitViewPaneSpec[]} panes Pane specs.
 * @param {number} index Requested pane index.
 * @param {number} requestedSize Requested size in px.
 * @returns {number[] | null} One size per pane, or `null` when the request cannot be satisfied.
 */
function resolveAuthoritative(
    available: number,
    panes: readonly SplitViewPaneSpec[],
    index: number,
    requestedSize: number
): number[] | null {
    const count = panes.length;
    const targetPane = panes[index];
    const targetMax = Number.isFinite(targetPane.maxSize) ? targetPane.maxSize : Infinity;
    const clampedTarget = clamp(requestedSize, targetPane.minSize, targetMax);

    const baseOthers = new Array<number>(count).fill(0);
    let baseTotal = 0;
    for (let i = 0; i < count; i++) {
        if (i === index) {
            continue;
        }
        baseOthers[i] = panes[i].minSize;
        baseTotal += baseOthers[i];
    }

    const remaining = available - clampedTarget - baseTotal;
    if (remaining < -1e-6) {
        return null;
    }

    const capacities = new Array<number>(count).fill(0);
    let totalCapacity = 0;
    for (let i = 0; i < count; i++) {
        if (i === index) {
            continue;
        }
        // A sibling with no max can at most grow to fill the whole span, so its capacity headroom
        // is `available - minSize` (mirrors the old share-space `maxShare === 1`).
        const maxSize = Number.isFinite(panes[i].maxSize) ? panes[i].maxSize : available;
        capacities[i] = Math.max(0, maxSize - panes[i].minSize);
        totalCapacity += capacities[i];
    }

    const next = new Array<number>(count).fill(0);
    next[index] = clampedTarget;

    if (totalCapacity <= 0 || remaining <= 0) {
        for (let i = 0; i < count; i++) {
            if (i !== index) {
                next[i] = baseOthers[i];
            }
        }
    } else {
        const fillRatio = Math.min(1, remaining / totalCapacity);
        for (let i = 0; i < count; i++) {
            if (i === index) {
                continue;
            }
            next[i] = baseOthers[i] + capacities[i] * fillRatio;
        }
    }

    return next;
}

/**
 * Resolve a fair request (a `desiredSize` hint).
 *
 * The hint is capped at the requesting pane's equal share (computed with
 * {@link distributeEqual}), then the whole split is re-equalized with the requester's maximum
 * tightened to that cap. A hint at or above the equal share therefore leaves the equal layout
 * untouched, while a smaller hint (size-to-content) releases the remainder to the other flexible
 * panes equally. The result can never starve a sibling below its minimum.
 * @param {number} available Available span in px.
 * @param {readonly SplitViewPaneSpec[]} panes Pane specs.
 * @param {number} index Requested pane index.
 * @param {number} requestedSize Requested size in px.
 * @returns {number[]} One size per pane.
 */
function resolveFair(
    available: number,
    panes: readonly SplitViewPaneSpec[],
    index: number,
    requestedSize: number
): number[] {
    const equal = distributeEqual(available, panes);
    const targetPane = panes[index];
    const targetMax = Number.isFinite(targetPane.maxSize) ? targetPane.maxSize : Infinity;
    const cap = clamp(requestedSize, targetPane.minSize, Math.min(targetMax, equal[index]));

    const cappedPanes = panes.map((pane, i) =>
        i === index ? { ...pane, maxSize: Math.min(pane.maxSize, cap) } : pane
    );
    return distributeEqual(available, cappedPanes);
}

/**
 * Resolve a sizing request into one size per pane.
 * @param {number} available Available span in px.
 * @param {readonly SplitViewPaneSpec[]} panes Pane specs.
 * @param {SplitViewSizingRequest | null} [request] Optional request; omit for equal distribution.
 * @returns {number[] | null} One size per pane, or `null` when an authoritative request cannot fit.
 */
export function resolvePaneSizes(
    available: number,
    panes: readonly SplitViewPaneSpec[],
    request: SplitViewSizingRequest | null = null
): number[] | null {
    if (request === null) {
        return distributeEqual(available, panes);
    }
    if (request.index < 0 || request.index >= panes.length) {
        return null;
    }
    if (request.mode === 'fair') {
        return resolveFair(available, panes, request.index, request.size);
    }
    return resolveAuthoritative(available, panes, request.index, request.size);
}

/**
 * Convert pixel sizes into flex-grow shares (each size divided by `available`).
 * A non-positive `available` yields all zeros so callers never emit `Infinity` factors.
 * @param {readonly number[]} sizes Pane sizes in px.
 * @param {number} available Available span in px.
 * @returns {number[]} One share per pane.
 */
export function sizesToShares(sizes: readonly number[], available: number): number[] {
    if (!Number.isFinite(available) || available <= 0) {
        return sizes.map(() => 0);
    }
    return sizes.map((size) => (Number.isFinite(size) && size > 0 ? size / available : 0));
}

/**
 * Compute the flex-grow scale factor that lifts every positive share to at least 1.
 *
 * CSS Flexbox only hands out `sum × free space` when the unfrozen factors sum below one; scaling
 * the shares by `1 / min(positive share)` preserves the proportions and guarantees any non-empty
 * subset of unfrozen panes sums to at least one. Returns `1` when no pane has a positive share.
 * @param {readonly number[]} shares Pane shares.
 * @returns {number} Scale factor >= 1.
 */
export function scaledFlexFactors(shares: readonly number[]): number {
    const positive = shares.filter((share) => Number.isFinite(share) && share > 0);
    if (positive.length === 0) {
        return 1;
    }
    const scale = 1 / Math.min(...positive);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Compute the flex-grow factor for the residual filler pane, in the same scaled units as the panes
 * (the unused `1 - sum(shares)` fraction multiplied by {@link scaledFlexFactors}).
 * @param {readonly number[]} shares Pane shares.
 * @returns {number} Filler flex-grow factor.
 */
export function fillerFlexFactor(shares: readonly number[]): number {
    const sum = shares.reduce((acc, share) => acc + (Number.isFinite(share) ? share : 0), 0);
    const residual = Math.max(0, 1 - sum);
    return residual * scaledFlexFactors(shares);
}

