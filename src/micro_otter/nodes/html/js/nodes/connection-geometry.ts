// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared geometry for graph connection curves.
 *
 * Connection lines are cubic beziers whose control points sit a horizontal
 * offset away from the connectors. Forward links use a proportional bend
 * bounded to a fixed maximum. Backward links (an output on a far-right node
 * feeding an input on a left node) grow their offset just enough to keep a
 * fixed loop past each connector, so the line never balloons out as the nodes
 * get further apart.
 */

/** Minimum bend so short connections still curve nicely. */
export const CONNECTION_CURVE_MIN_CONTROL_OFFSET: number = 60;

/** Maximum bend for forward connections. */
export const CONNECTION_CURVE_MAX_CONTROL_OFFSET: number = 120;

/** Fixed loop excursion for backward connections, in pixels. */
export const CONNECTION_CURVE_BACKWARD_LOOP: number = 24;

/**
 * Clamp a raw bezier control-point offset into the allowed bend range.
 * @param offset - Raw offset, e.g. proportional to the horizontal distance.
 * @returns Offset bounded to [MIN, MAX].
 */
export function clampConnectionControlOffset(offset: number): number {
    return Math.min(
        Math.max(offset, CONNECTION_CURVE_MIN_CONTROL_OFFSET),
        CONNECTION_CURVE_MAX_CONTROL_OFFSET
    );
}

/**
 * Exact maximum horizontal excursion past the source endpoint for a symmetric
 * backward bezier (start = 0, end = -span, control points +offset / -span-offset).
 */
function backwardLoopExcursion(offset: number, span: number): number {
    const ratio = offset / (6 * offset + 2 * span);
    const root = Math.max(0, 1 - 4 * ratio);
    const peakT = (1 - Math.sqrt(root)) / 2;
    const cubic = 6 * offset + 2 * span;
    const quadratic = 9 * offset + 3 * span;
    return cubic * peakT * peakT * peakT - quadratic * peakT * peakT + 3 * offset * peakT;
}

/**
 * Control-point offset that makes a backward connection loop a fixed distance
 * past its connectors, independent of how far apart they are.
 * @param span - Horizontal distance between the connector x positions.
 */
export function getBackwardControlOffset(span: number): number {
    let low = CONNECTION_CURVE_MIN_CONTROL_OFFSET;
    let high = 256;

    while (backwardLoopExcursion(high, span) < CONNECTION_CURVE_BACKWARD_LOOP) {
        high *= 2;
    }

    for (let iteration = 0; iteration < 40; iteration += 1) {
        const middle = (low + high) / 2;
        if (backwardLoopExcursion(middle, span) >= CONNECTION_CURVE_BACKWARD_LOOP) {
            high = middle;
        } else {
            low = middle;
        }
    }

    return high;
}

/**
 * Control-point offset for a connection between two connector x positions.
 * @param fromX - x position of the source connector (extended into the socket).
 * @param toX - x position of the destination connector.
 * @returns Horizontal offset for both bezier control points.
 */
export function getConnectionControlOffset(fromX: number, toX: number): number {
    const span = Math.abs(toX - fromX);
    return toX < fromX ? getBackwardControlOffset(span) : clampConnectionControlOffset(span);
}

/**
 * Control-point offset for an in-progress drag preview, where the source
 * connector points outward (outputs right, inputs left) and the cursor may end
 * up on either side. Backward previews use the fixed loop; forward previews
 * keep the gentler proportional bend.
 */
export function getDirectedControlOffset(fromX: number, toX: number, fromKind: string): number {
    const span = Math.abs(toX - fromX);
    const pointsRight = fromKind !== 'input';
    const isBackward = pointsRight ? toX < fromX : toX > fromX;
    return isBackward
        ? getBackwardControlOffset(span)
        : clampConnectionControlOffset(span * 0.35);
}

