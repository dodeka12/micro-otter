// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Helper methods for NodeUi calculations and utilities.
 */

import {
    NODE_HEADER_HEIGHT,
    NODE_BODY_PADDING,
    CONTROL_HEIGHT,
    CONTROL_SPACING,
    CONTROL_LABEL_MARGIN,
    CONTROLS_CONNECTOR_GAP,
    CONTROL_LABEL_FONT,
    CONTROL_LABEL_CHAR_WIDTH_ESTIMATE,
    CONTROL_VALUE_MIN_WIDTH,
    CONTROL_VALUE_MIN_WIDTH_BY_TYPE,
    CONNECTOR_SPACING,
    CONNECTOR_LABEL_OFFSET,
    CONNECTOR_ROW_INSET,
    INPUT_DEFAULT_CONTROL_MIN_WIDTH,
    OUTPUT_LABEL_RESERVED_WIDTH,
    CONNECTOR_ROW_RESERVED_GAP,
    CONNECTOR_LABEL_FONT,
    OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE,
    CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR,
    CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH,
    CONNECTOR_HIGHLIGHT_LABEL_RADIUS,
} from './node-ui-constants.js';

import { resolveActiveInputIds, resolveHiddenControlIds } from '../data/type-conversions.js';

type NodeId = string;
type ControlLayout = 'inline' | 'stacked';

function normalizeNodeId(value: unknown): NodeId | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

export interface DropdownOption {
    value: unknown;
    label?: string | Record<string, unknown>;
    /**
     * Text the picker row shows instead of `label` (see `ResolvedDynamicOption`).
     */
    displayLabel?: string | Record<string, unknown>;
    activeControls?: NodeId[];
    activeInputs?: NodeId[];
    activeOutputs?: NodeId[];
    inputTypes?: Record<string, unknown>;
    outputTypes?: Record<string, unknown>;
}

export interface ControlDefinition {
    id: NodeId;
    type?: string;
    layout?: ControlLayout;
    affectsControls?: boolean;
    affectsInputs?: boolean;
    affectsOutputs?: boolean;
    default?: unknown;
    options?: DropdownOption[];
    dynamicOptions?: unknown;
    disabled?: boolean;
    maxVisibleItems?: number;
}

export interface NodeInputDefinition {
    id: NodeId;
    name?: unknown;
    label?: unknown;
    defaultControl?: unknown;
}

export interface NodeOutputDefinition {
    id?: NodeId;
    name?: unknown;
    label?: unknown;
}

/**
 * Minimal shape needed to derive the text drawn next to a connector.
 */
export interface ConnectorLabelSource {
    id?: unknown;
    name?: unknown;
    label?: unknown;
}

/**
 * Minimal shape needed to derive the text drawn in a control's label column.
 */
export interface ControlLabelSource {
    id?: unknown;
    label?: unknown;
}

/**
 * Result of {@link fitTextToWidth}.
 */
export interface FittedText {
    /** Text that fits the requested width (possibly ellipsised, possibly empty). */
    text: string;
    /** Measured width of `text` in pixels. */
    width: number;
}

/**
 * Minimal measuring surface used by {@link fitTextToWidth}, so callers can pass a real
 * canvas context or a headless stub.
 */
export interface TextMeasureContext {
    measureText(text: string): { width: number };
}

export interface VisibleInputEntry {
    entry: NodeInputDefinition;
    index: number;
}

export interface VisibleOutputEntry {
    entry: NodeOutputDefinition;
    index: number;
}

export interface NodeDataLike {
    id?: NodeId;
    collapsed?: boolean;
    controls?: ControlDefinition[];
    controlValues?: Record<string, unknown>;
    inputs?: NodeInputDefinition[];
    outputs?: NodeOutputDefinition[];
    /** Values of input-row default controls, keyed by input id. */
    inputDefaults?: Record<string, unknown>;
}

export interface ConnectionLike {
    toNode: NodeId;
    toIndex: number;
}

export interface NodeGraphWithConnections {
    getConnections: () => ConnectionLike[];
}

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface InputDefaultControlBoundsOptions {
    nodeX: number;
    nodeWidth: number;
    inputConnectorX: number;
    inputCenterY: number;
    rowHasOpposingOutput: boolean;
    /**
     * Rendered width of the opposing output's label text (see
     * {@link measureConnectorLabelWidth}). When omitted or invalid, the fixed
     * {@link OUTPUT_LABEL_RESERVED_WIDTH} fallback is reserved instead.
     */
    opposingOutputLabelWidth?: number;
    fontScale?: number;
    controlHeight?: number;
}

export interface ViewportTransform {
    pan: Point;
    zoom: number;
}

export interface ControlLayoutInfo {
    height?: number;
}

export interface ControlUiLike {
    getLayout?: () => ControlLayoutInfo | null | undefined;
}

export interface ControlGeometryOptions {
    y: number;
    width: number;
    x?: number;
    controlUi?: ControlUiLike | null;
    /**
     * Node-wide label column width (see {@link computeControlColumnLayout}). When omitted
     * or `0`, inline controls fall back to their intrinsic per-control layout.
     */
    labelWidth?: number;
}

/**
 * Shared label/value column of a node's inline controls.
 */
export interface ControlColumnLayout {
    /** Left/right inset used inside the node. */
    inset: number;
    /** `width - 2 * inset`, never negative. */
    availableWidth: number;
    /** Absolute x of the label column. */
    labelX: number;
    /** Shared label column width (`0` when the node has no inline controls). */
    labelWidth: number;
    /** Absolute x where every inline value area starts. */
    valueX: number;
    /** Shared value width, never negative. */
    valueWidth: number;
}

/**
 * Options for {@link computeControlColumnLayout}.
 */
export interface ControlColumnOptions {
    /** Node x position. */
    x: number;
    /** Node width. */
    width: number;
    /** Visible controls in render order. */
    visibleControls?: ControlDefinition[];
    /** Locale used to resolve localized control labels. */
    locale?: string;
    /** Left/right inset; defaults to {@link CONNECTOR_ROW_INSET}. */
    inset?: number;
}

export interface ControlGeometry {
    fullBounds: Rect;
    valueBounds: Rect;
    controlHeight: number;
    totalHeight: number;
    mode: ControlLayout;
}

const connectorLabelWidthCache = new Map<string, number>();
let connectorLabelMeasureContext: CanvasRenderingContext2D | null | undefined;

const controlLabelWidthCache = new Map<string, number>();
let controlLabelMeasureContext: CanvasRenderingContext2D | null | undefined;

/**
 * Lazily create (and reuse) the offscreen 2D context used to measure label text.
 * @returns Measuring context, or `null` when no canvas measurement is available.
 */
function getConnectorLabelMeasureContext(): CanvasRenderingContext2D | null {
    if (connectorLabelMeasureContext !== undefined) {
        return connectorLabelMeasureContext;
    }

    connectorLabelMeasureContext = null;

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return connectorLabelMeasureContext;
    }

    try {
        const canvas = document.createElement('canvas');
        const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        if (ctx) {
            ctx.font = CONNECTOR_LABEL_FONT;
            connectorLabelMeasureContext = ctx;
        }
    } catch {
        connectorLabelMeasureContext = null;
    }

    return connectorLabelMeasureContext;
}

/**
 * Measure the rendered width of a connector label.
 *
 * Results are memoised per label string, so repeated layout passes only pay for a
 * `Map` lookup. Without a measuring canvas (headless tests, SSR) the width is estimated
 * from the character count, which keeps the layout maths deterministic.
 *
 * @param label - Label text as drawn next to the connector.
 * @returns Width in pixels, or `0` for empty input.
 */
export function measureConnectorLabelWidth(label: string | null | undefined): number {
    if (typeof label !== 'string' || label.length === 0) {
        return 0;
    }

    const cached = connectorLabelWidthCache.get(label);
    if (cached !== undefined) {
        return cached;
    }

    const ctx = getConnectorLabelMeasureContext();
    const measured = ctx
        ? ctx.measureText(label).width
        : label.length * OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE;
    const width = Number.isFinite(measured) && measured > 0 ? measured : 0;

    connectorLabelWidthCache.set(label, width);
    return width;
}

/**
 * Pick the first label candidate that carries actual text.
 * @param value - Raw `name`, `label` or `id` value.
 * @returns The usable value, or `undefined` when it is empty.
 */
function pickLabelCandidate(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.trim().length > 0 ? value : undefined;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).length > 0 ? value : undefined;
    }

    return undefined;
}

/**
 * Resolve the text drawn next to a connector.
 *
 * Uses the same precedence as the render path (`name`, then `label`, then `id`) and
 * localises object values. Rendering, measurement and hit-testing must all go through
 * this function, so the reserved label width always matches the drawn text.
 *
 * @param entry - Connector entry, input definition or output definition.
 * @param locale - Current locale code used for localized labels.
 * @returns Plain label text, or `''` when nothing usable is available.
 */
export function resolveConnectorLabelText(
    entry: ConnectorLabelSource | null | undefined,
    locale = 'en'
): string {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const candidate =
        pickLabelCandidate(entry.name) ??
        pickLabelCandidate(entry.label) ??
        pickLabelCandidate(entry.id);

    if (candidate === undefined) {
        return '';
    }

    return typeof candidate === 'string' ? candidate : extractLocalizedString(candidate, locale);
}

/**
 * Lazily create (and reuse) the offscreen 2D context used to measure control labels.
 *
 * Kept separate from the connector measuring context because the two draw with different
 * fonts; a shared context would have to reassign `font` on every call.
 *
 * @returns Measuring context, or `null` when no canvas measurement is available.
 */
function getControlLabelMeasureContext(): CanvasRenderingContext2D | null {
    if (controlLabelMeasureContext !== undefined) {
        return controlLabelMeasureContext;
    }

    controlLabelMeasureContext = null;

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return controlLabelMeasureContext;
    }

    try {
        const canvas = document.createElement('canvas');
        const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        if (ctx) {
            ctx.font = CONTROL_LABEL_FONT;
            controlLabelMeasureContext = ctx;
        }
    } catch {
        controlLabelMeasureContext = null;
    }

    return controlLabelMeasureContext;
}

/**
 * Measure the rendered width of a control label.
 *
 * Rendering, the shared label column and the content-derived minimum width all consume
 * this value, so the measured text must be the text that is actually drawn (see
 * {@link resolveControlLabelText}). Results are memoised per label string, including the
 * headless fallback, so repeated layout passes only pay for a `Map` lookup.
 *
 * @param label - Label text as drawn beside the control value.
 * @returns Width in pixels, or `0` for empty input.
 */
export function measureControlLabelWidth(label: string | null | undefined): number {
    if (typeof label !== 'string' || label.length === 0) {
        return 0;
    }

    const cached = controlLabelWidthCache.get(label);
    if (cached !== undefined) {
        return cached;
    }

    const ctx = getControlLabelMeasureContext();
    const measured = ctx
        ? ctx.measureText(label).width
        : label.length * CONTROL_LABEL_CHAR_WIDTH_ESTIMATE;
    const width = Number.isFinite(measured) && measured > 0 ? measured : 0;

    controlLabelWidthCache.set(label, width);
    return width;
}

/**
 * Normalize the requested opposing output label width for the row layout.
 * @param value - Measured label width, if known.
 * @returns Width to reserve, falling back to {@link OUTPUT_LABEL_RESERVED_WIDTH}.
 */
function normalizeOpposingOutputLabelWidth(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return OUTPUT_LABEL_RESERVED_WIDTH;
    }
    return value;
}

/**
 * Measure text with a text-measuring context, treating invalid results as `0`.
 * @param ctx - Measuring context.
 * @param text - Text to measure.
 * @returns Width in pixels.
 */
function measureTextWidth(ctx: TextMeasureContext, text: string): number {
    const measured = ctx.measureText(text)?.width;
    return typeof measured === 'number' && Number.isFinite(measured) && measured > 0 ? measured : 0;
}

/**
 * Resolve the text drawn in a control's label column.
 *
 * Precedence is `label` → `id` (controls have no `name`); string values are returned
 * verbatim and objects are localized. This is the single rule for rendering, column
 * measurement and hit-testing.
 *
 * @param control - Control definition.
 * @param locale - Current locale code used for localized labels.
 * @returns Plain label text, or `''` when nothing usable is available.
 */
export function resolveControlLabelText(
    control: ControlLabelSource | null | undefined,
    locale = 'en'
): string {
    if (!control || typeof control !== 'object') {
        return '';
    }

    const candidate = pickLabelCandidate(control.label) ?? pickLabelCandidate(control.id);

    if (candidate === undefined) {
        return '';
    }

    return typeof candidate === 'string' ? candidate : extractLocalizedString(candidate, locale);
}

/**
 * Resolve the minimum width of a control's value area from its type.
 *
 * These are layout floors used to widen the node, not preferred widths.
 *
 * @param control - Control definition.
 * @returns Width floor in pixels.
 */
export function getControlValueMinWidth(control: ControlDefinition | null | undefined): number {
    const byType = control?.type ? CONTROL_VALUE_MIN_WIDTH_BY_TYPE[control.type] : undefined;
    const width = typeof byType === 'number' ? byType : CONTROL_VALUE_MIN_WIDTH;

    if (!Number.isFinite(width) || width < 0) {
        return CONTROL_VALUE_MIN_WIDTH;
    }

    return width;
}

/**
 * Measure the natural (unclamped) label column for a set of controls.
 *
 * Only inline controls contribute: stacked controls draw their label on a full-width row
 * of their own. This must stay the only place the label column is measured, so the drawn
 * column and the width requirement can never disagree. Callers clamp the result to the
 * available node width before drawing; the content minimum uses it unclamped.
 *
 * @param controls - Controls to measure (stacked ones are ignored).
 * @param locale - Current locale code used for localized labels.
 * @returns Ceiled column width in pixels, `0` when there is no inline control.
 */
export function measureControlLabelColumnWidth(
    controls: ControlDefinition[] | null | undefined,
    locale = 'en'
): number {
    if (!Array.isArray(controls) || controls.length === 0) {
        return 0;
    }

    let columnWidth = 0;

    for (const control of controls) {
        if (normalizeControlLayout(control) !== 'inline') {
            continue;
        }

        const labelWidth = measureControlLabelWidth(resolveControlLabelText(control, locale));
        if (Number.isFinite(labelWidth) && labelWidth > columnWidth) {
            columnWidth = labelWidth;
        }
    }

    return Math.ceil(columnWidth);
}

/**
 * Truncate text with an ellipsis so it fits a given width.
 *
 * The caller owns `ctx.font`; this helper only calls `measureText` and never mutates the
 * context.
 *
 * @param ctx - Measuring context, or `null` when none is available.
 * @param text - Full text to fit.
 * @param maxWidth - Available width in pixels.
 * @param ellipsis - Marker appended to truncated text.
 * @returns Fitted text and its measured width.
 */
export function fitTextToWidth(
    ctx: TextMeasureContext | null | undefined,
    text: string,
    maxWidth: number,
    ellipsis = '…'
): FittedText {
    if (typeof text !== 'string' || text.length === 0 || !ctx) {
        return { text: '', width: 0 };
    }

    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        return { text: '', width: 0 };
    }

    const fullWidth = measureTextWidth(ctx, text);
    if (fullWidth <= maxWidth) {
        return { text, width: fullWidth };
    }

    let best: FittedText = { text: '', width: 0 };

    if (measureTextWidth(ctx, ellipsis) > maxWidth) {
        return best;
    }

    let low = 0;
    let high = Math.max(0, text.length - 1);

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = text.slice(0, middle) + ellipsis;
        const width = measureTextWidth(ctx, candidate);

        if (width <= maxWidth) {
            best = { text: candidate, width };
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return best;
}

/**
 * Paint the dark highlight pill used behind a connector label.
 *
 * Shared by `drawConnectorLabel()` and by the input default-control path in
 * `drawConnectors()`, so a highlighted target looks identical whether its label is
 * owned by the connector renderer or by a `NodeControlUi`. This is the only function that
 * paints the pill.
 *
 * The caller owns the "should there be a pill at all" decision: this helper only skips
 * invalid rectangles. It never touches `font`, `textAlign`, `textBaseline` or
 * `globalAlpha`, so the caller can keep drawing its label afterwards.
 *
 * @param ctx - Canvas context.
 * @param rect - Pill rectangle in the caller's coordinate space.
 * @param borderColor - Connector data-type colour used for the border.
 * @param radius - Corner radius; defaults to `CONNECTOR_HIGHLIGHT_LABEL_RADIUS`.
 */
export function drawHighlightPill(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    borderColor: string,
    radius: number = CONNECTOR_HIGHLIGHT_LABEL_RADIUS
): void {
    const { x, y, width, height } = rect;

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
    ) {
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH;
    ctx.stroke();
    ctx.restore();
}

/**
 * Normalize a shared label column width.
 * @param value - Label column width, if known.
 * @returns Width to use, falling back to `0` (intrinsic per-control layout).
 */
function normalizeLabelWidth(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 0;
    }
    return value;
}

/**
 * Compute the shared label/value column of a node's inline controls.
 *
 * Rendering and hit-testing both call this, so the drawn value rectangle and
 * `ControlHitResult.bounds` can never disagree. The label column is clamped so a value box
 * of at least `min(CONTROL_VALUE_MIN_WIDTH, availableWidth)` always remains, which keeps
 * the control usable in pathological widths (labels then truncate instead).
 *
 * @param options - Node position/width, visible controls, locale and optional inset.
 * @returns Finite, non-negative column geometry.
 */
export function computeControlColumnLayout(options: ControlColumnOptions): ControlColumnLayout {
    const x = Number.isFinite(options.x) ? options.x : 0;
    const width = Number.isFinite(options.width) ? Math.max(0, options.width) : 0;
    const requestedInset = options.inset ?? CONNECTOR_ROW_INSET;
    const inset = Number.isFinite(requestedInset) ? Math.max(0, requestedInset) : 0;
    const availableWidth = Math.max(0, width - 2 * inset);
    const visibleControls = Array.isArray(options.visibleControls) ? options.visibleControls : [];

    const naturalLabelWidth = measureControlLabelColumnWidth(
        visibleControls,
        options.locale ?? 'en'
    );
    const valueReserve = Math.min(CONTROL_VALUE_MIN_WIDTH, availableWidth);
    const labelWidth = Math.min(
        naturalLabelWidth,
        Math.max(0, availableWidth - CONTROL_LABEL_MARGIN - valueReserve)
    );
    const labelX = x + inset;

    return {
        inset,
        availableWidth,
        labelX,
        labelWidth,
        valueX: labelX + labelWidth + CONTROL_LABEL_MARGIN,
        valueWidth: Math.max(0, availableWidth - labelWidth - CONTROL_LABEL_MARGIN),
    };
}

/**
 * Minimum width requirement of a node's panel controls.
 */
export interface ControlsMinWidthRequirement {
    /** Width needed so inline labels never truncate (`0` without inline controls). */
    inline: number;
    /** Width needed so stacked labels and values never truncate (`0` without). */
    stacked: number;
    /** `max(inline, stacked)`. */
    combined: number;
}

/**
 * Compute the width a node needs so its panel controls render without truncation.
 *
 * These are *content minima*: at this width the label column never truncates. Stacked
 * controls put their value on a full-width row of their own, so their label does not need
 * a column. `getLayout().width` is deliberately not used — the per-type floors from
 * {@link getControlValueMinWidth} describe what the value needs.
 *
 * @param controls - Visible controls in render order.
 * @param locale - Current locale code used for localized labels.
 * @returns Inline, stacked and combined width requirements in pixels.
 */
export function computeControlsMinWidth(
    controls: ControlDefinition[] | null | undefined,
    locale = 'en'
): ControlsMinWidthRequirement {
    const empty: ControlsMinWidthRequirement = { inline: 0, stacked: 0, combined: 0 };

    if (!Array.isArray(controls) || controls.length === 0) {
        return empty;
    }

    const inlineControls = controls.filter(
        (control) => normalizeControlLayout(control) === 'inline'
    );
    const stackedControls = controls.filter(
        (control) => normalizeControlLayout(control) === 'stacked'
    );

    let inline = 0;
    if (inlineControls.length > 0) {
        const labelWidth = measureControlLabelColumnWidth(inlineControls, locale);
        const valueFloor = Math.max(
            ...inlineControls.map((control) => getControlValueMinWidth(control))
        );
        inline = 2 * CONNECTOR_ROW_INSET + labelWidth + CONTROL_LABEL_MARGIN + valueFloor;
    }

    let stacked = 0;
    for (const control of stackedControls) {
        const labelWidth = measureControlLabelWidth(resolveControlLabelText(control, locale));
        const contentWidth = Math.max(labelWidth, getControlValueMinWidth(control));
        stacked = Math.max(stacked, 2 * CONNECTOR_ROW_INSET + contentWidth);
    }

    const inlineWidth = Number.isFinite(inline) && inline > 0 ? inline : 0;
    const stackedWidth = Number.isFinite(stacked) && stacked > 0 ? stacked : 0;

    return {
        inline: inlineWidth,
        stacked: stackedWidth,
        combined: Math.max(inlineWidth, stackedWidth),
    };
}

/**
 * Calculate input default control bounds for a connector row.
 *
 * The control starts at the input connector and ends either at the node body padding
 * (input-only row) or right before the opposing output's label text (opposed row),
 * which is why callers should pass the measured label width via
 * `opposingOutputLabelWidth`. The returned width never drops below
 * {@link INPUT_DEFAULT_CONTROL_MIN_WIDTH}: `NodeUi.ensureNodeWidth()` grows the node
 * until this fits, so the floor only shows up for nodes that have not been widened yet
 * (for example when a node type pins a `maxWidth` below the content minimum).
 */
export function getInputDefaultControlBounds(options: InputDefaultControlBoundsOptions): Rect {
    const {
        nodeX,
        nodeWidth,
        inputConnectorX,
        inputCenterY,
        rowHasOpposingOutput,
        fontScale = 1,
        controlHeight = CONTROL_HEIGHT,
    } = options;

    const controlX = inputConnectorX + CONNECTOR_LABEL_OFFSET;
    const outputLabelAnchorX = nodeX + nodeWidth - CONNECTOR_ROW_INSET;
    const opposingOutputLabelWidth = normalizeOpposingOutputLabelWidth(
        options.opposingOutputLabelWidth
    );
    const opposedRowEndX =
        outputLabelAnchorX - opposingOutputLabelWidth - CONNECTOR_ROW_RESERVED_GAP;
    const inputOnlyRowEndX = nodeX + nodeWidth - NODE_BODY_PADDING;
    const controlEndX = rowHasOpposingOutput ? opposedRowEndX : inputOnlyRowEndX;

    const availableWidth = controlEndX - controlX;
    const width = Math.max(INPUT_DEFAULT_CONTROL_MIN_WIDTH, availableWidth);

    const scaledHeight = controlHeight * fontScale;

    return {
        x: controlX,
        y: inputCenterY - scaledHeight / 2,
        width,
        height: scaledHeight,
    };
}

/**
 * Options for {@link computeNodeMinContentWidth}.
 */
export interface NodeContentWidthOptions {
    /** Locale used to resolve localized connector labels. */
    locale?: string;
    /** Pre-computed visible inputs, so callers can reuse their visibility cache. */
    visibleInputs?: NodeInputDefinition[];
    /** Pre-computed visible outputs, so callers can reuse their visibility cache. */
    visibleOutputs?: NodeOutputDefinition[];
    /** Pre-computed visible controls, so callers can reuse their visibility cache. */
    visibleControls?: ControlDefinition[];
    /**
     * Decides whether a row renders a default control instead of the input label.
     * Defaults to "the input declares a `defaultControl`".
     */
    hasDefaultControl?: (input: NodeInputDefinition) => boolean;
}

/**
 * Compute the minimum node width that keeps connector rows and panel controls usable.
 *
 * Rows pair the n-th visible input with the n-th visible output, exactly like
 * `computeConnectorPositions()`. Per row:
 *
 * - input + output: `inset + max(inputLabelWidth, controlMinWidth) + gap + outputLabelWidth + inset`
 * - input only: `inset + max(inputLabelWidth, controlMinWidth) + NODE_BODY_PADDING`
 * - output only: `inset + outputLabelWidth`
 *
 * with `inset = CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET`. The control width is always
 * reserved in its worst case, so connecting or disconnecting an input never changes the
 * node width.
 *
 * Panel controls contribute `computeControlsMinWidth().combined`, so a node without
 * connectors still grows until its labels and values fit.
 *
 * The result is a *minimum*: callers may only grow to it (`NodeUi.ensureNodeWidth()` never
 * shrinks a wider node).
 *
 * @param nodeData - Node data with inputs, outputs and controls.
 * @param options - Locale, visibility overrides and control predicate.
 * @returns Ceiled minimum width in pixels, or `0` when the node is collapsed or has neither
 * connector rows nor visible controls.
 */
export function computeNodeMinContentWidth(
    nodeData: NodeDataLike | null | undefined,
    options: NodeContentWidthOptions = {}
): number {
    if (!nodeData || nodeData.collapsed) {
        return 0;
    }

    const locale = options.locale ?? 'en';
    const visibleInputs = options.visibleInputs ?? getVisibleInputs(nodeData);
    const visibleOutputs = options.visibleOutputs ?? getVisibleOutputs(nodeData);
    const visibleControls = options.visibleControls ?? getVisibleControls(nodeData);
    const hasDefaultControl =
        options.hasDefaultControl ??
        ((input: NodeInputDefinition) => Boolean(input.defaultControl));

    const rowCount = Math.max(visibleInputs.length, visibleOutputs.length);
    let requiredWidth = computeControlsMinWidth(visibleControls, locale).combined;

    for (let row = 0; row < rowCount; row += 1) {
        const input = visibleInputs[row];
        const output = visibleOutputs[row];
        const outputLabelWidth = output
            ? measureConnectorLabelWidth(resolveConnectorLabelText(output, locale))
            : 0;

        let rowWidth = 0;

        if (input) {
            const inputLabelWidth = measureConnectorLabelWidth(
                resolveConnectorLabelText(input, locale)
            );
            rowWidth +=
                CONNECTOR_ROW_INSET +
                Math.max(
                    inputLabelWidth,
                    hasDefaultControl(input) ? INPUT_DEFAULT_CONTROL_MIN_WIDTH : 0
                );

            rowWidth += output
                ? CONNECTOR_ROW_RESERVED_GAP + outputLabelWidth + CONNECTOR_ROW_INSET
                : NODE_BODY_PADDING;
        } else if (output) {
            rowWidth += CONNECTOR_ROW_INSET + outputLabelWidth;
        }

        requiredWidth = Math.max(requiredWidth, rowWidth);
    }

    return Math.ceil(requiredWidth);
}

function isGraphWithConnections(value: unknown): value is NodeGraphWithConnections {
    return Boolean(value) && typeof value === 'object' && 'getConnections' in value;
}

/**
 * Gap between the controls block and the first connector row.
 *
 * Returns `CONTROLS_CONNECTOR_GAP` only when both sections have visible content; the
 * height budget, the connector positions and control hit-testing all call this, so they
 * can never drift apart.
 *
 * Note that the controls section already includes one trailing `CONTROL_SPACING`, so the
 * total clearance is `CONTROL_SPACING + CONTROLS_CONNECTOR_GAP`.
 *
 * @param controls - Visible controls in render order.
 * @param connectorRowCount - Number of visible connector rows.
 * @returns Gap in pixels, `0` when one of the sections is empty.
 */
export function getControlsConnectorGap(
    controls: ControlDefinition[] | null | undefined,
    connectorRowCount: number
): number {
    const hasControls = Array.isArray(controls) && controls.length > 0;
    const hasConnectorRows = Number.isFinite(connectorRowCount) && connectorRowCount > 0;

    return hasControls && hasConnectorRows ? CONTROLS_CONNECTOR_GAP : 0;
}

/**
 * Calculate required node height based on content.
 * Layout order: Header → Controls → Inputs/Outputs (horizontally aligned)
 * @param nodeData - Node data with inputs, outputs, controls.
 * @param getVisibleControlsFn - Function to get visible controls.
 * @param getVisibleInputsFn - Function to get visible inputs.
 * @param getVisibleOutputsFn - Function to get visible outputs.
 * @returns Required height in pixels.
 */
export function calculateNodeHeight(
    nodeData: NodeDataLike,
    getVisibleControlsFn: (node: NodeDataLike) => ControlDefinition[],
    getVisibleInputsFn: (node: NodeDataLike) => NodeInputDefinition[],
    getVisibleOutputsFn: (node: NodeDataLike) => NodeOutputDefinition[]
): number {
    if (nodeData.collapsed) {
        return NODE_HEADER_HEIGHT;
    }

    let height = NODE_HEADER_HEIGHT;
    height += NODE_BODY_PADDING;

    const visibleControls = getVisibleControlsFn(nodeData);
    if (visibleControls.length > 0) {
        const controlsHeight = getControlsSectionHeight(visibleControls);
        height += controlsHeight;
    }

    const visibleInputs = getVisibleInputsFn(nodeData);
    const visibleOutputs = getVisibleOutputsFn(nodeData);
    const maxConnectors = Math.max(visibleInputs.length, visibleOutputs.length);

    if (maxConnectors > 0) {
        if (visibleControls.length > 0) {
            height += getControlsConnectorGap(visibleControls, maxConnectors);
        }
        const connectorsHeight = maxConnectors * CONNECTOR_SPACING;
        height += connectorsHeight;
    }

    height += NODE_BODY_PADDING;

    return height;
}

/**
 * Normalize control layout mode.
 * @param control - Control definition.
 * @returns Normalized layout mode.
 */
export function normalizeControlLayout(
    control: ControlDefinition | null | undefined
): ControlLayout {
    if (control?.layout === 'stacked') {
        return 'stacked';
    }
    return 'inline';
}

/**
 * Resolve control body height from control instance layout with fallback.
 * @param controlUi - Control UI instance.
 * @returns Control body height.
 */
export function getControlBodyHeight(controlUi: ControlUiLike | null | undefined): number {
    const layoutHeight = controlUi?.getLayout?.()?.height;
    if (typeof layoutHeight === 'number' && Number.isFinite(layoutHeight) && layoutHeight > 0) {
        return layoutHeight;
    }
    return CONTROL_HEIGHT;
}

/**
 * Get total render height for a control, including stacked label row when applicable.
 * @param control - Control definition.
 * @param controlUi - Optional control UI instance.
 * @returns Total render height in pixels.
 */
export function getControlRenderHeight(
    control: ControlDefinition | null | undefined,
    controlUi?: ControlUiLike | null
): number {
    const mode = normalizeControlLayout(control);
    const controlHeight = getControlBodyHeight(controlUi);

    if (mode === 'stacked') {
        return CONTROL_HEIGHT + CONTROL_SPACING + controlHeight;
    }

    return controlHeight;
}

/**
 * Calculate full and editor/value bounds for a control row.
 *
 * The inline branch honours the node-wide label column: pass the same `labelWidth` the
 * renderer used and `valueBounds` is exactly the drawn value rectangle. Omitting it
 * reproduces the legacy intrinsic per-control layout.
 *
 * @param control - Control definition.
 * @param options - Geometry options.
 * @returns Control geometry.
 */
export function getControlGeometry(
    control: ControlDefinition | null | undefined,
    options: ControlGeometryOptions
): ControlGeometry {
    const mode = normalizeControlLayout(control);
    const controlHeight = getControlBodyHeight(options.controlUi);
    const x = options.x ?? 0;

    if (mode === 'stacked') {
        const valueY = options.y + CONTROL_HEIGHT + CONTROL_SPACING;
        const totalHeight = CONTROL_HEIGHT + CONTROL_SPACING + controlHeight;
        return {
            fullBounds: {
                x,
                y: options.y,
                width: options.width,
                height: totalHeight,
            },
            valueBounds: {
                x,
                y: valueY,
                width: options.width,
                height: controlHeight,
            },
            controlHeight,
            totalHeight,
            mode,
        };
    }

    const labelWidth = normalizeLabelWidth(options.labelWidth);
    const valueOffset = labelWidth > 0 ? labelWidth + CONTROL_LABEL_MARGIN : 0;
    const valueX = x + valueOffset;
    const valueWidth = Math.max(0, options.width - valueOffset);

    return {
        fullBounds: {
            x,
            y: options.y,
            width: options.width,
            height: controlHeight,
        },
        valueBounds: {
            x: valueX,
            y: options.y,
            width: valueWidth,
            height: controlHeight,
        },
        controlHeight,
        totalHeight: controlHeight,
        mode,
    };
}

/**
 * Calculate total controls section height including inter-control spacing.
 * @param controls - Visible controls in render order.
 * @param getControlUiFn - Optional function to resolve control UI instances.
 * @returns Total controls section height.
 */
export function getControlsSectionHeight(
    controls: ControlDefinition[],
    getControlUiFn?: (controlId: string) => ControlUiLike | null | undefined
): number {
    if (!Array.isArray(controls) || controls.length === 0) {
        return 0;
    }

    return controls.reduce((height, control) => {
        const controlUi = getControlUiFn ? getControlUiFn(control.id) : null;
        return height + getControlRenderHeight(control, controlUi) + CONTROL_SPACING;
    }, 0);
}

/**
 * Get list of controls that should be visible based on dropdown selections.
 *
 * Delegates to {@link resolveHiddenControlIds}, the rule shared with the graph typing engine
 * (`NodeGraph.#applyDropdownOptionConnectorTypes()`), so the rendered rows and the resolved
 * connector types can never disagree.
 *
 * @param nodeData - Node data with controls and controlValues.
 * @param extraAffectingDropdowns - Dropdowns that are not part of `nodeData.controls` but
 * still reveal or hide controls, such as a dropdown on an input-row default control.
 * They only take part in the "declared membership" computation; the returned list is always
 * filtered `nodeData.controls`, so a synthetic entry can never be rendered as a row.
 * @returns Visible control objects.
 */
export function getVisibleControls(
    nodeData: NodeDataLike,
    extraAffectingDropdowns: ControlDefinition[] = []
): ControlDefinition[] {
    const controls = nodeData.controls || [];
    const hasAffectingDropdown =
        controls.some((control) => control.type === 'dropdown' && control.affectsControls) ||
        (Array.isArray(extraAffectingDropdowns) && extraAffectingDropdowns.length > 0);
    if (!hasAffectingDropdown) {
        return controls;
    }

    const hiddenControlIds = resolveHiddenControlIds(nodeData, extraAffectingDropdowns);
    return controls.filter((control) => !hiddenControlIds.has(control.id));
}

/**
 * Get list of inputs that should be visible based on dropdown selections.
 *
 * Delegates to {@link resolveActiveInputIds}, the rule shared with union typing, so the
 * rendered connectors and the resolved output types can never disagree.
 *
 * @param nodeData - Node data with inputs, controls, and controlValues.
 * @returns Visible input objects.
 */
export function getVisibleInputs(nodeData: NodeDataLike): NodeInputDefinition[] {
    const inputs = nodeData.inputs || [];
    const activeInputIds = resolveActiveInputIds(nodeData);
    return activeInputIds ? inputs.filter((input) => activeInputIds.has(input.id)) : inputs;
}

/**
 * Check if an input is connected to another node's output.
 * @param nodeId - ID of the node containing the input.
 * @param inputIndex - Index of the input to check.
 * @param graph - NodeGraph instance with getConnections() method.
 * @returns True if the input has an incoming connection.
 */
export function isInputConnected(nodeId: NodeId, inputIndex: number, graph: unknown): boolean {
    if (!isGraphWithConnections(graph) || typeof graph.getConnections !== 'function') {
        return false;
    }
    const normalizedNodeId = normalizeNodeId(nodeId);
    if (!normalizedNodeId) {
        return false;
    }

    const connections = graph.getConnections();
    return connections.some((connection) => {
        return (
            normalizeNodeId(connection.toNode) === normalizedNodeId &&
            connection.toIndex === inputIndex
        );
    });
}

/**
 * Get list of outputs that should be visible based on dropdown selections.
 * @param nodeData - Node data with outputs, controls, and controlValues.
 * @returns Visible output objects.
 */
export function getVisibleOutputs(nodeData: NodeDataLike): NodeOutputDefinition[] {
    const outputs = nodeData.outputs || [];
    const controls = nodeData.controls || [];
    const controlValues = nodeData.controlValues || {};

    const affectingDropdowns = controls.filter(
        (control) => control.type === 'dropdown' && control.affectsOutputs
    );

    if (affectingDropdowns.length === 0) {
        return outputs;
    }

    const activeOutputIds = new Set<NodeId>();

    for (const dropdown of affectingDropdowns) {
        const selectedValue = controlValues[dropdown.id] ?? dropdown.default;
        const selectedOption = dropdown.options?.find((option) => option.value === selectedValue);

        if (selectedOption?.activeOutputs) {
            selectedOption.activeOutputs.forEach((id) => activeOutputIds.add(id));
        }
    }

    if (activeOutputIds.size === 0) {
        return outputs;
    }

    const visibleOutputs = outputs.filter(
        (output) => Boolean(output.id) && activeOutputIds.has(output.id)
    );
    return visibleOutputs;
}

/**
 * Get visible inputs together with their original positions in `data.inputs`.
 * Mirrors `getVisibleInputs` but keeps the connector's full-list index so wiring
 * stays keyed to the original index rather than the visible row.
 */
export function getVisibleInputEntries(nodeData: NodeDataLike): VisibleInputEntry[] {
    const inputs = nodeData.inputs || [];
    const controls = nodeData.controls || [];
    const controlValues = nodeData.controlValues || {};

    const affectingDropdowns = controls.filter(
        (control) => control.type === 'dropdown' && control.affectsInputs
    );

    if (affectingDropdowns.length === 0) {
        return inputs.map((entry, index) => ({ entry, index }));
    }

    const activeInputIds = new Set<NodeId>();

    for (const dropdown of affectingDropdowns) {
        const selectedValue = controlValues[dropdown.id] ?? dropdown.default;
        const selectedOption = dropdown.options?.find((option) => option.value === selectedValue);

        if (selectedOption?.activeInputs) {
            selectedOption.activeInputs.forEach((id) => activeInputIds.add(id));
        }
    }

    if (activeInputIds.size === 0) {
        return inputs.map((entry, index) => ({ entry, index }));
    }

    const entries: VisibleInputEntry[] = [];
    inputs.forEach((entry, index) => {
        if (activeInputIds.has(entry.id)) {
            entries.push({ entry, index });
        }
    });
    return entries;
}

/**
 * Get visible outputs together with their original positions in `data.outputs`.
 * Mirrors `getVisibleOutputs` but keeps the connector's full-list index.
 */
export function getVisibleOutputEntries(nodeData: NodeDataLike): VisibleOutputEntry[] {
    const outputs = nodeData.outputs || [];
    const controls = nodeData.controls || [];
    const controlValues = nodeData.controlValues || {};

    const affectingDropdowns = controls.filter(
        (control) => control.type === 'dropdown' && control.affectsOutputs
    );

    if (affectingDropdowns.length === 0) {
        return outputs.map((entry, index) => ({ entry, index }));
    }

    const activeOutputIds = new Set<NodeId>();

    for (const dropdown of affectingDropdowns) {
        const selectedValue = controlValues[dropdown.id] ?? dropdown.default;
        const selectedOption = dropdown.options?.find((option) => option.value === selectedValue);

        if (selectedOption?.activeOutputs) {
            selectedOption.activeOutputs.forEach((id) => activeOutputIds.add(id));
        }
    }

    if (activeOutputIds.size === 0) {
        return outputs.map((entry, index) => ({ entry, index }));
    }

    const entries: VisibleOutputEntry[] = [];
    outputs.forEach((entry, index) => {
        if (entry.id && activeOutputIds.has(entry.id)) {
            entries.push({ entry, index });
        }
    });
    return entries;
}

/**
 * Extract localized string from value using current locale.
 * @param value - String or localization object.
 * @param currentLocale - Current locale code.
 * @returns Localized string.
 */
export function extractLocalizedString(value: unknown, currentLocale = 'en'): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        const localizationMap = value as Record<string, unknown>;
        return (localizationMap[currentLocale] ||
            localizationMap.en ||
            localizationMap[Object.keys(localizationMap)[0]] ||
            '') as string;
    }
    return String(value);
}

/**
 * Format control value for display, handling localization.
 * @param control - Control definition.
 * @param value - Control value.
 * @param currentLocale - Current locale code.
 * @returns Formatted value text.
 */
export function formatControlValue(
    control: ControlDefinition,
    value: unknown,
    currentLocale = 'en'
): string {
    switch (control.type) {
        case 'checkbox':
            return value ? '☑' : '☐';
        case 'dropdown':
            if (control.options && Array.isArray(control.options)) {
                const option = control.options.find((opt) => opt.value === value);
                if (option) {
                    return (
                        extractLocalizedString(option.label, currentLocale) ||
                        (value as string) ||
                        ''
                    );
                }
            }
            return value !== undefined && value !== null ? String(value) : '';
        default:
            return value !== undefined && value !== null ? String(value) : '';
    }
}

/**
 * Check if a point is inside a rectangle.
 * @param point - Point coordinates.
 * @param rect - Rectangle bounds.
 * @returns True if point is inside rectangle.
 */
export function pointInRect(point: Point, rect: Rect): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

/**
 * Convert canvas coordinates to screen coordinates.
 * @param canvasPoint - Canvas coordinates.
 * @param canvasElement - Canvas element for bounds.
 * @param viewport - Viewport transform.
 * @returns Screen coordinates.
 */
export function canvasToScreen(
    canvasPoint: Point,
    canvasElement: HTMLElement | null | undefined,
    viewport: ViewportTransform | null | undefined
): Point {
    if (!canvasElement || !viewport) {
        return { x: canvasPoint.x, y: canvasPoint.y };
    }

    const rect = canvasElement.getBoundingClientRect();
    const x = (canvasPoint.x + viewport.pan.x) * viewport.zoom + rect.left;
    const y = (canvasPoint.y + viewport.pan.y) * viewport.zoom + rect.top;

    return { x, y };
}
