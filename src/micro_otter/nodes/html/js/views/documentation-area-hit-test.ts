// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Geometric hit testing for documentation areas.
 *
 * Pure functions only: no DOM, no canvas, no graph. The DOM layer's header/handle accessors exist
 * for cursor feedback and menu anchoring, never for hit testing, so this stays unit-testable in
 * plain `node:test`.
 */

import type { DocumentationAreaData } from '../data/documentation-area.js';

export type DocumentationAreaHitZone = 'header' | 'resize' | 'body';

export interface DocumentationAreaHit {
    areaId: string;
    zone: DocumentationAreaHitZone;
}

/** Header height in world units at zoom 1 (must match the header row in the stylesheet). */
export const DOCUMENTATION_AREA_HEADER_HEIGHT_WORLD = 32;

/** Edge length of the bottom-right resize handle in world units at zoom 1. */
export const DOCUMENTATION_AREA_RESIZE_HANDLE_WORLD = 14;

type Point = { x: number; y: number };

/**
 * Classify a world-space point against the documentation areas.
 *
 * The array is walked in reverse so the topmost (last painted) area wins, matching both the
 * canvas paint order and the DOM stacking order. Zone sizes are divided by the viewport scale, so
 * the header and handle keep their on-screen size at every zoom level.
 * @param {Point} posWorld - Pointer position in world coordinates.
 * @param {DocumentationAreaData[]} areas - Areas in paint order.
 * @param {number} [scale=1] - Viewport scale.
 * @returns {DocumentationAreaHit|null} Hit result, or null when the point hits no area.
 */
export function hitTestDocumentationAreas(
    posWorld: Point,
    areas: DocumentationAreaData[],
    scale = 1
): DocumentationAreaHit | null {
    if (!posWorld || !Array.isArray(areas) || areas.length === 0) {
        return null;
    }

    const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const headerHeight = DOCUMENTATION_AREA_HEADER_HEIGHT_WORLD / zoom;
    const handleSize = DOCUMENTATION_AREA_RESIZE_HANDLE_WORLD / zoom;

    for (let index = areas.length - 1; index >= 0; index -= 1) {
        const area = areas[index];
        const bounds = area?.bounds;
        if (!bounds || !area.id) {
            continue;
        }

        const insideX = posWorld.x >= bounds.x && posWorld.x <= bounds.x + bounds.width;
        const insideY = posWorld.y >= bounds.y && posWorld.y <= bounds.y + bounds.height;
        if (!insideX || !insideY) {
            continue;
        }

        const inHandleX = posWorld.x >= bounds.x + bounds.width - handleSize;
        const inHandleY = posWorld.y >= bounds.y + bounds.height - handleSize;
        if (inHandleX && inHandleY) {
            return { areaId: area.id, zone: 'resize' };
        }

        if (posWorld.y <= bounds.y + headerHeight) {
            return { areaId: area.id, zone: 'header' };
        }

        return { areaId: area.id, zone: 'body' };
    }

    return null;
}
