/**
 * GraphPanelViewport - Viewport management for GraphPanelView
 *
 * Handles coordinate transformations, pan, zoom, and viewport constraints.
 * Extracted as part of Phase 1 refactoring (2026-01-26).
 */

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type ViewportState = {
    scale: number;
    translateX: number;
    translateY: number;
    minScale: number;
    maxScale: number;
};

type TranslateState = {
    translateX: number;
    translateY: number;
};

type GridTranslateRange = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};

type ViewportConfig = {
    defaultZoom?: number;
    minZoom?: number;
    maxZoom?: number;
};

type WorkspaceLike = {
    config?: Record<string, unknown>;
};

type ViewportConstants = {
    GRID_SPACING?: number;
    GRID_MAJOR_INTERVAL?: number;
    [key: string]: unknown;
};

type GraphPanelViewportOptions = {
    constants: ViewportConstants;
    workspace?: WorkspaceLike | null;
    maxGridMajorIntervals: Size;
    onViewportChange?: ((state: ViewportSerialized) => void) | null;
};

type ViewportSerialized = {
    scale: number;
    translateX: number;
    translateY: number;
};

type ViewportDeserializeData = {
    viewport?: Partial<ViewportSerialized>;
};

export class GraphPanelViewport {
    constants: ViewportConstants;
    maxGridMajorIntervals: Size;
    majorGridSpacing: number;
    gridSizeWorld: Size;
    viewport: ViewportState;
    /** Workspace-configured default zoom, resolved once in the constructor. */
    defaultScale: number;

    /** Optional listener told about every interactive viewport change. */
    #onViewportChange: ((state: ViewportSerialized) => void) | null;

    /**
     * @param {object} options
     * @param {object} options.constants - Grid/rendering constants (GRID_SPACING, etc.)
     * @param {object} options.workspace - Workspace instance for config
     * @param {object} options.maxGridMajorIntervals - Max grid intervals {width, height}
     * @param {Function} [options.onViewportChange] - Called with the serialized viewport after every
     *   interactive pan/zoom (never after {@link GraphPanelViewport.deserialize})
     */
    constructor({
        constants,
        workspace,
        maxGridMajorIntervals,
        onViewportChange = null,
    }: GraphPanelViewportOptions) {
        this.constants = constants;
        this.maxGridMajorIntervals = maxGridMajorIntervals;

        const gridSpacing =
            typeof this.constants.GRID_SPACING === 'number' ? this.constants.GRID_SPACING : 32;
        const majorInterval =
            typeof this.constants.GRID_MAJOR_INTERVAL === 'number'
                ? this.constants.GRID_MAJOR_INTERVAL
                : 5;

        this.majorGridSpacing = gridSpacing * majorInterval;
        this.gridSizeWorld = {
            width: this.maxGridMajorIntervals.width * this.majorGridSpacing,
            height: this.maxGridMajorIntervals.height * this.majorGridSpacing,
        };

        const workspaceConfig = workspace?.config || {};
        const viewportConfig =
            typeof workspaceConfig.viewport === 'object' &&
            workspaceConfig.viewport !== null &&
            !Array.isArray(workspaceConfig.viewport)
                ? (workspaceConfig.viewport as ViewportConfig)
                : {};

        this.viewport = {
            scale: viewportConfig.defaultZoom || 1,
            translateX: 0,
            translateY: 0,
            // Zoom-out floor: half the previous 0.55 limit (one extra factor-of-two step).
            minScale: viewportConfig.minZoom || 0.275,
            maxScale: viewportConfig.maxZoom || 2.75,
        };

        this.defaultScale = viewportConfig.defaultZoom || 1;
        this.#onViewportChange = typeof onViewportChange === 'function' ? onViewportChange : null;
    }

    /**
     * Clamp scale value to min/max bounds.
     * @param {number} value - Desired scale
     * @returns {number} Clamped scale
     */
    clampViewportScale(value: number): number {
        const { minScale, maxScale } = this.viewport;
        const safe = Number.isFinite(value) ? value : 1;
        return Math.min(Math.max(safe, minScale), maxScale);
    }

    /**
     * Get the workspace default zoom, clamped to the allowed scale range.
     * @returns {number} Default scale within [minScale, maxScale].
     */
    getDefaultScale(): number {
        return this.clampViewportScale(this.defaultScale);
    }

    /**
     * Tell the optional listener that the viewport changed.
     *
     * A failing listener must never break panning or zooming, so the callback is isolated.
     * @private
     */
    #notifyViewportChange(): void {
        if (!this.#onViewportChange) {
            return;
        }
        try {
            this.#onViewportChange(this.serialize());
        } catch (_error) {
            console.error('[GraphPanelViewport] onViewportChange failed', _error);
        }
    }

    /**
     * Apply the current viewport transform to a rendering context.
     * Preserves any existing DPR scaling by using transform() instead of setTransform().
     * @param {CanvasRenderingContext2D} ctx - Target context.
     */
    applyViewport(ctx: CanvasRenderingContext2D | null): void {
        if (!ctx) return;
        ctx.transform(
            this.viewport.scale,
            0,
            0,
            this.viewport.scale,
            this.viewport.translateX,
            this.viewport.translateY
        );
    }

    /**
     * Convert screen-space coordinates to world-space using the active viewport.
     * @param {{x:number,y:number}} point - Screen position (pixels).
     * @returns {{x:number,y:number}} World position.
     */
    screenToWorld(point: Point): Point {
        const scale = this.viewport.scale || 1;
        return {
            x: (point.x - this.viewport.translateX) / scale,
            y: (point.y - this.viewport.translateY) / scale,
        };
    }

    /**
     * Convert screen-space size to world-space using the active viewport.
     * @param {{width:number,height:number}} size - Size in screen space (pixels).
     * @returns {{width:number,height:number}} Size in world space.
     */
    screenSizeToWorld(size: Size): Size {
        const scale = this.viewport.scale || 1;
        return {
            width: size.width / scale,
            height: size.height / scale,
        };
    }

    /**
     * Convert world-space coordinates to screen-space using the active viewport.
     * @param {{x:number,y:number}} point - World position.
     * @returns {{x:number,y:number}} Screen position (pixels).
     */
    worldToScreen(point: Point): Point {
        return {
            x: point.x * this.viewport.scale + this.viewport.translateX,
            y: point.y * this.viewport.scale + this.viewport.translateY,
        };
    }

    /**
     * Clamp viewport translation so the grid stays within the visible bounds.
     * @param {{translateX:number,translateY:number}} nextT - Proposed translation.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     * @returns {{translateX:number,translateY:number}} Clamped translation.
     */
    clampViewportTranslate(nextT: TranslateState, canvasClientSize: Size): TranslateState {
        const translateRange = this.evalGridViewportTranslateRange(canvasClientSize);
        const clampedX = Math.max(
            Math.min(nextT.translateX, translateRange.maxX),
            translateRange.minX
        );
        const clampedY = Math.max(
            Math.min(nextT.translateY, translateRange.maxY),
            translateRange.minY
        );
        return { translateX: clampedX, translateY: clampedY };
    }

    /**
     * Update viewport scale and translation with clamping safeguards.
     * @param {{scale?:number,translateX?:number,translateY?:number}} next - Desired viewport values.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     */
    setViewport(next: Partial<ViewportSerialized>, canvasClientSize: Size): void {
        if (!next) return;
        const nextScale = this.clampViewportScale(
            Number.isFinite(next.scale) ? next.scale : this.viewport.scale
        );
        const newTranslate = this.clampViewportTranslate(
            {
                translateX: Number.isFinite(next.translateX)
                    ? (next.translateX as number)
                    : this.viewport.translateX,
                translateY: Number.isFinite(next.translateY)
                    ? (next.translateY as number)
                    : this.viewport.translateY,
            },
            canvasClientSize
        );

        this.viewport = {
            ...this.viewport,
            ...next,
            scale: nextScale,
            translateX: newTranslate.translateX,
            translateY: newTranslate.translateY,
        };

        this.#notifyViewportChange();
    }

    /**
     * Zoom around a specific screen point, maintaining that point under the cursor.
     * @param {{x:number,y:number}} posScreen - Anchor in screen space.
     * @param {number} factor - Multiplicative zoom factor.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     */
    zoomAt(posScreen: Point, factor: number, canvasClientSize: Size): void {
        const clampedFactor = Number.isFinite(factor) ? factor : 1;
        const nextScale = this.clampViewportScale(this.viewport.scale * clampedFactor);
        const worldPos = this.screenToWorld(posScreen);
        const nextTranslateX = posScreen.x - worldPos.x * nextScale;
        const nextTranslateY = posScreen.y - worldPos.y * nextScale;
        this.viewport.scale = nextScale;
        this.viewport.translateX = nextTranslateX;
        this.viewport.translateY = nextTranslateY;
        const clampedTranslate = this.clampViewportTranslate(this.viewport, canvasClientSize);
        this.viewport.translateX = clampedTranslate.translateX;
        this.viewport.translateY = clampedTranslate.translateY;

        this.#notifyViewportChange();
    }

    /**
     * Center the visible area on a world-space point at the current scale.
     *
     * The computed translation goes through {@link GraphPanelViewport.setViewport}, so the grid
     * clamping rules stay authoritative and the change notification fires. Content near the world
     * origin therefore centers only as far as the clamp allows.
     * @param {{x:number,y:number}} point - World position to put at the canvas center.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     */
    centerOnWorldPoint(point: Point, canvasClientSize: Size): void {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
            return;
        }
        if (!(canvasClientSize?.width > 0) || !(canvasClientSize?.height > 0)) {
            return;
        }

        const scale = this.viewport.scale || 1;
        this.setViewport(
            {
                translateX: canvasClientSize.width / 2 - point.x * scale,
                translateY: canvasClientSize.height / 2 - point.y * scale,
            },
            canvasClientSize
        );
    }

    /**
     * Get the maximum grid position in world coordinates.
     * @returns {{x:number,y:number}}
     */
    evalMaxGridPosWorld(): Point {
        return {
            x: this.maxGridMajorIntervals.width * this.majorGridSpacing,
            y: this.maxGridMajorIntervals.height * this.majorGridSpacing,
        };
    }

    /**
     * Compute min/max viewport translations that keep the grid visible.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     * @returns {{minX:number,maxX:number,minY:number,maxY:number}}
     */
    evalGridViewportTranslateRange(canvasClientSize: Size): GridTranslateRange {
        const canvasBoundsWorld = this.getCanvasBoundsWorld(canvasClientSize);

        const translateRange = {
            minX: Math.min(
                0,
                canvasBoundsWorld.width - this.gridSizeWorld.width - 0.5 * this.majorGridSpacing
            ),
            maxX: this.majorGridSpacing / 2,
            minY: Math.min(
                0,
                canvasBoundsWorld.height - this.gridSizeWorld.height - 0.5 * this.majorGridSpacing
            ),
            maxY: this.majorGridSpacing / 2,
        };

        return {
            minX: translateRange.minX * this.viewport.scale,
            maxX: translateRange.maxX * this.viewport.scale,
            minY: translateRange.minY * this.viewport.scale,
            maxY: translateRange.maxY * this.viewport.scale,
        };
    }

    /**
     * Compute the world-space bounds that correspond to the visible canvas area.
     * @param {{width:number,height:number}} canvasClientSize - Canvas dimensions
     * @returns {{x:number,y:number,width:number,height:number}}
     */
    getCanvasBoundsWorld(canvasClientSize: Size): { x: number; y: number; width: number; height: number } {
        const worldSize = this.screenToWorld({
            x: canvasClientSize.width,
            y: canvasClientSize.height,
        });
        const topLeft = this.screenToWorld({ x: 0, y: 0 });
        return {
            x: topLeft.x,
            y: topLeft.y,
            width: worldSize.x - topLeft.x,
            height: worldSize.y - topLeft.y,
        };
    }

    /**
     * Clamp a position to stay within the grid bounds.
     *
     * This only constrains a position to the world bounds; it does not quantize the
     * position to grid steps. Use {@link GraphPanelViewport.snapToGrid} for snapping.
     *
     * @param {number} x - Desired x coordinate.
     * @param {number} y - Desired y coordinate.
     * @param {number} [width=0] - Width to keep inside bounds.
     * @param {number} [height=0] - Height to keep inside bounds.
     * @returns {{x:number,y:number}} Clamped position.
     */
    clampToGrid(x: number, y: number, width = 0, height = 0): Point {
        const bounds = this.gridSizeWorld;
        const clampedX = Math.min(Math.max(x, 0), Math.max(0, bounds.width - width));
        const clampedY = Math.min(Math.max(y, 0), Math.max(0, bounds.height - height));
        return { x: clampedX, y: clampedY };
    }

    /**
     * Snap a position to the nearest grid step and clamp it to the grid bounds.
     * @param {number} x - Desired x coordinate.
     * @param {number} y - Desired y coordinate.
     * @param {number} [width=0] - Width to keep inside bounds.
     * @param {number} [height=0] - Height to keep inside bounds.
     * @param {number} [spacing] - Optional grid spacing; falls back to GRID_SPACING.
     * @returns {{x:number,y:number}} Snapped and clamped position.
     */
    snapToGrid(x: number, y: number, width = 0, height = 0, spacing?: number): Point {
        const step =
            typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0
                ? spacing
                : typeof this.constants.GRID_SPACING === 'number' &&
                    this.constants.GRID_SPACING > 0
                  ? this.constants.GRID_SPACING
                  : 32;
        const snappedX = Math.round(x / step) * step;
        const snappedY = Math.round(y / step) * step;
        return this.clampToGrid(snappedX, snappedY, width, height);
    }

    /**
     * Serialize viewport state for persistence.
     * @returns {{scale:number,translateX:number,translateY:number}}
     */
    serialize(): ViewportSerialized {
        return {
            scale: this.viewport.scale,
            translateX: this.viewport.translateX,
            translateY: this.viewport.translateY,
        };
    }

    /**
     * Restore viewport state from serialized data.
     * @param {{viewport?:object}} data - Serialized data with viewport property
     */
    deserialize(data: ViewportDeserializeData): void {
        if (!data.viewport) {
            return;
        }
        this.viewport.scale = data.viewport.scale ?? this.viewport.scale;
        this.viewport.translateX = data.viewport.translateX ?? this.viewport.translateX;
        this.viewport.translateY = data.viewport.translateY ?? this.viewport.translateY;
    }
}
