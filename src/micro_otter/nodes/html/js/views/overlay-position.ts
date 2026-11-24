// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Pure geometry helpers for overlays that open beside an anchor rectangle.
 *
 * No DOM access happens here beyond an optional `window.innerWidth/innerHeight` fallback, so the math
 * is unit-testable in JSDOM where every measured rectangle is zero.
 */

/** The parts of a `DOMRect` this module needs. */
export interface AnchorRectLike {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** Options for {@link computeAnchoredPosition}. */
export interface AnchoredPositionOptions {
    /** Viewport size; defaults to `window.innerWidth/innerHeight` when available. */
    viewport?: { width: number; height: number } | null;
    /** Gap between anchor and child. */
    gap?: number;
    /** Minimum distance to the viewport edge. */
    margin?: number;
    /** Preferred side; the opposite side is used when the preferred one does not fit. */
    placement?: 'right' | 'left';
}

/** Result of {@link computeAnchoredPosition}. */
export interface AnchoredPosition {
    x: number;
    y: number;
    side: 'right' | 'left';
}

/**
 * Viewport size to lay out against.
 * @param {object|null} viewport - Explicit viewport, or null to read the browser window.
 * @returns {object} Width and height in CSS pixels.
 */
function resolveViewport(viewport: { width: number; height: number } | null): {
    width: number;
    height: number;
} {
    if (viewport) {
        return { width: Math.max(0, viewport.width), height: Math.max(0, viewport.height) };
    }

    if (typeof window === 'undefined') {
        return { width: 0, height: 0 };
    }

    return {
        width: Math.max(0, window.innerWidth || 0),
        height: Math.max(0, window.innerHeight || 0),
    };
}

/**
 * Compute the screen position of a panel that opens beside an anchor (a menu row).
 *
 * The preferred side wins when the child fits there; otherwise the opposite side is used if the child
 * fits there; otherwise the side with more room is chosen and the child is pushed back inside the
 * viewport. `y` follows the anchor top and is clamped so the child stays inside the viewport, while
 * `x` never becomes negative.
 * @param {object} anchor - Anchor rectangle (typically `row.getBoundingClientRect()`).
 * @param {object} childSize - Size of the panel that opens.
 * @param {object} [options] - Placement options.
 * @param {object|null} [options.viewport=null] - Viewport size; defaults to the browser window.
 * @param {number} [options.gap=2] - Gap between anchor and child.
 * @param {number} [options.margin=8] - Minimum distance to the viewport edge.
 * @param {string} [options.placement='right'] - Preferred side.
 * @returns {object} `{ x, y, side }` position and the side that was used.
 */
export function computeAnchoredPosition(
    anchor: AnchorRectLike,
    childSize: { width: number; height: number },
    { viewport = null, gap = 2, margin = 8, placement = 'right' }: AnchoredPositionOptions = {}
): AnchoredPosition {
    const { width: viewportWidth, height: viewportHeight } = resolveViewport(viewport);
    const width = Math.max(0, childSize.width);
    const height = Math.max(0, childSize.height);

    const rightX = anchor.right + gap;
    const leftX = anchor.left - gap - width;
    const fitsRight = rightX + width <= viewportWidth - margin;
    const fitsLeft = leftX >= margin;
    const roomRight = viewportWidth - anchor.right - gap;
    const roomLeft = anchor.left - gap;

    const opposite = placement === 'right' ? 'left' : 'right';
    let side: 'right' | 'left' = placement;
    if (placement === 'right' ? !fitsRight : !fitsLeft) {
        if (placement === 'right' ? fitsLeft : fitsRight) {
            side = opposite;
        } else {
            // Neither side has enough room: keep the child on the roomier one and push it inside.
            side = roomRight >= roomLeft ? 'right' : 'left';
        }
    }

    const maxX = Math.max(0, viewportWidth - width - margin);
    const rawX = side === 'right' ? rightX : leftX;
    const x = Math.min(Math.max(0, rawX), maxX);

    const maxY = Math.max(margin, viewportHeight - height - margin);
    const y = Math.min(Math.max(anchor.top, margin), maxY);

    return { x, y, side };
}
