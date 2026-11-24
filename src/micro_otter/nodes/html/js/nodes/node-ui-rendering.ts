// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Rendering methods for NodeUi.
 */

import {
    getVisibleInputEntries,
    getVisibleOutputEntries,
    getVisibleOutputs,
    computeControlColumnLayout,
    drawHighlightPill,
    fitTextToWidth,
    getControlGeometry,
    getControlsConnectorGap,
    getControlsSectionHeight,
    getInputDefaultControlBounds,
    isInputConnected,
    measureConnectorLabelWidth,
    resolveConnectorLabelText,
} from './node-ui-helpers.js';
import { getDataTypeColor, getInputConnectorType } from './data-type-colors.js';
import type {
    ControlDefinition,
    NodeDataLike as HelperNodeDataLike,
    NodeInputDefinition,
    NodeOutputDefinition,
    Rect,
} from './node-ui-helpers.js';
import type { NodeUiStyle } from './node-ui-constants.js';
import { resolveNodeDisplayName } from '../data/node-name-resolver.js';
import {
    NODE_HEADER_HEIGHT,
    NODE_HEADER_ICON_SIZE,
    NODE_HEADER_ICON_INSET,
    NODE_HEADER_TITLE_PADDING,
    NODE_HEADER_TITLE_FONT,
    NODE_BODY_PADDING,
    NODE_CORNER_RADIUS,
    CONNECTOR_ROW_INSET,
    CONTROLS_CONNECTOR_GAP,
    CONTROL_SEPARATOR_COLOR,
    CONTROL_SEPARATOR_MIN_WIDTH,
    CONTROL_SEPARATOR_THICKNESS,
    CONTROL_HEIGHT,
    CONTROL_SPACING,
    CONNECTOR_RADIUS,
    CONNECTOR_SPACING,
    CONNECTOR_LABEL_OFFSET,
    CONNECTOR_OVERLAP,
    COLLAPSE_BUTTON_SIZE,
    INPUT_DEFAULT_CONTROL_FONT_SCALE,
    CONNECTOR_LABEL_FONT,
    INPUT_CONNECTOR_STROKE_WIDTH,
    OUTPUT_CONNECTOR_STROKE_WIDTH,
    CONNECTOR_HIGHLIGHT_STROKE_SCALE,
    CONNECTOR_HIGHLIGHT_FILL_ALPHA,
    CONNECTOR_HIGHLIGHT_LABEL_PADDING_X,
    CONNECTOR_HIGHLIGHT_LABEL_HEIGHT,
    RELATED_NODE_BORDER_COLOR,
    RELATED_NODE_GLOW_COLOR,
    RELATED_NODE_GLOW_BLUR,
    SELECTED_NODE_GLOW_BLUR,
    RELATED_NODE_BODY_BRIGHTEN,
} from './node-ui-constants.js';
import { MDI_CANVAS_FONT } from './mdi-glyph-font.js';
import type { NodeCapabilityIssue } from '../core/node-capability-validator.js';

type NodeId = string;
type ConnectorKind = 'input' | 'output';

interface RenderBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * Node-wide label column width; inline controls must lay their label out in this
     * column instead of measuring their own.
     */
    labelWidth?: number;
}

interface ControlLayout {
    height?: number;
}

interface ControlUiLike {
    getLayout?: () => ControlLayout;
    renderCanvas?: (ctx: CanvasRenderingContext2D, bounds: RenderBounds) => void;
    /**
     * Rectangle of the label the control draws, or `null` when it draws none.
     * Optional: controls without it only highlight their socket.
     */
    getCanvasLabelBounds?: (ctx: CanvasRenderingContext2D, bounds: RenderBounds) => Rect | null;
}

interface InputDefaultControl {
    [key: string]: unknown;
}

interface NodeInputLike extends NodeInputDefinition {
    id: NodeId;
    allowedTypes?: string[];
    defaultControl?: InputDefaultControl;
}

interface NodeOutputLike extends NodeOutputDefinition {
    id?: NodeId;
    outputType?: string;
}

interface NodeDataLike extends HelperNodeDataLike {
    id: NodeId;
    x: number;
    y: number;
    width: number;
    height: number;
    type?: string;
    typeName?: unknown;
    title?: unknown;
    userName?: unknown;
    collapsed?: boolean;
    controls?: ControlDefinition[];
    inputs?: NodeInputLike[];
    outputs?: NodeOutputLike[];
    capabilityIssues?: NodeCapabilityIssue[];
}

interface RuntimeNodeTypeLike {
    title?: unknown;
}

interface RuntimeLike {
    getNodeType?: (nodeTypeId: unknown) => RuntimeNodeTypeLike | null | undefined;
}

interface RuntimeCollectionLike {
    getActiveRuntime?: () => RuntimeLike | null | undefined;
}

interface WorkspaceLike {
    runtimeCollection?: RuntimeCollectionLike;
}

interface NodeUiRenderingContext {
    graph?: unknown;
    controlInstances: Map<NodeId, ControlUiLike>;
    inputDefaultControlInstances: Map<NodeId, ControlUiLike>;
    getCurrentLocale?: () => string;
    getWorkspace?: () => WorkspaceLike | null;
}

interface HoverConnectorLike {
    nodeId?: NodeId;
    type?: string;
    kind?: string;
    index?: number;
}

interface DraggingConnectionLike {
    startKind?: string;
    startNodeId?: string;
    startIndex?: number;
}

interface DrawNodeOptions {
    hoverConnector?: HoverConnectorLike | null;
    draggingConnection?: DraggingConnectionLike | null;
    relatedHighlight?: boolean;
}

const CAPABILITY_ISSUE_BORDER_COLOR = '#f87171';
const CAPABILITY_ISSUE_FIELD_OUTLINE_COLOR = '#f87171';

/**
 * Blend a hex colour toward white while keeping its hue.
 *
 * Used to brighten the body fill of one-hop-related nodes. Supports `#rgb`, `#rgba`,
 * `#rrggbb` and `#rrggbbaa`; any other CSS colour (named colours, `rgb()`/`rgba()`) is
 * returned unchanged so arbitrary user-assigned colours stay safe.
 *
 * @param color - CSS hex colour to brighten.
 * @param amount - Blend factor in `[0, 1]`; `0` keeps the colour, `1` returns white.
 * @returns The brightened hex colour, or `color` when it is not a supported hex string.
 */
export function brightenColor(color: string, amount: number): string {
    const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
    if (!match) {
        return color;
    }

    const hex = match[1];
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const channels = [0, 2, 4].map((offset) =>
        Number.parseInt(expanded.slice(offset, offset + 2), 16)
    );
    const alpha = expanded.length === 8 ? expanded.slice(6, 8) : '';
    const factor = Math.min(1, Math.max(0, amount));
    const brightened = channels
        .map((channel) => Math.round(channel + (255 - channel) * factor))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');

    return `#${brightened}${alpha}`;
}

function getCapabilityIssues(data: NodeDataLike | null | undefined): NodeCapabilityIssue[] {
    if (!data?.capabilityIssues || !Array.isArray(data.capabilityIssues)) {
        return [];
    }
    return data.capabilityIssues;
}

function hasNodeCapabilityIssues(data: NodeDataLike | null | undefined): boolean {
    return getCapabilityIssues(data).length > 0;
}

function hasControlCapabilityIssue(
    data: NodeDataLike | null | undefined,
    controlId: string | null | undefined
): boolean {
    if (!controlId) {
        return false;
    }

    return getCapabilityIssues(data).some(
        (issue) => issue.scope === 'control' && issue.controlId === controlId
    );
}

function hasInputDefaultCapabilityIssue(
    data: NodeDataLike | null | undefined,
    inputId: string | null | undefined
): boolean {
    if (!inputId) {
        return false;
    }

    return getCapabilityIssues(data).some(
        (issue) => issue.scope === 'input-default' && issue.inputId === inputId
    );
}

interface ConnectorRenderEntry {
    type: ConnectorKind;
    index: number;
    row?: number;
    x: number;
    y: number;
    id?: NodeId;
    label?: unknown;
    inputData?: NodeInputLike;
}

interface ConnectorPositionLike {
    index: number;
    row?: number;
    x: number;
    y: number;
    id?: NodeId;
    label?: unknown;
    inputData?: NodeInputLike;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function colorToAlpha(color: string, alpha: number): string {
    const normalized = color.trim();
    const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
    if (!hexMatch) {
        return color;
    }

    const hex = hexMatch[1];
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

interface ConnectorLabelOptions {
    /** Anchor x: the text starts here for `left`, ends here for `right`. */
    x: number;
    /** Vertical centre of the label row. */
    y: number;
    align: 'left' | 'right';
    text: string;
    textColor: string;
    /**
     * Data-type colour of the connector when the label must be highlighted, otherwise
     * `null`. The colour is used for the backdrop border only; the text always keeps
     * `textColor` so light data types never become invisible.
     */
    highlightColor?: string | null;
}

/**
 * Draw a connector label, optionally on a dark backdrop.
 *
 * The backdrop replaces the old behaviour of painting the label text in the connector's
 * data-type colour. Light types (`any` → `#e3e3e3`) were unreadable on a light node body,
 * so the highlight now uses a dark pill with a data-type-coloured border and keeps the
 * label text at the node's `textColor`.
 *
 * @param ctx - Canvas context whose font is already set to {@link CONNECTOR_LABEL_FONT}.
 * @param options - Label geometry, text and highlight colour.
 */
export function drawConnectorLabel(
    ctx: CanvasRenderingContext2D,
    { x, y, align, text, textColor, highlightColor = null }: ConnectorLabelOptions
): void {
    if (highlightColor && text.trim().length > 0) {
        const textWidth = ctx.measureText(text).width;
        const padding = CONNECTOR_HIGHLIGHT_LABEL_PADDING_X;
        drawHighlightPill(
            ctx,
            {
                x: align === 'right' ? x - textWidth - padding : x - padding,
                y: y - CONNECTOR_HIGHLIGHT_LABEL_HEIGHT / 2,
                width: textWidth + padding * 2,
                height: CONNECTOR_HIGHLIGHT_LABEL_HEIGHT,
            },
            highlightColor
        );
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
}

function resolveInputConnectorColor(entry: ConnectorPositionLike): string {
    const connectorType = getInputConnectorType(entry.inputData?.allowedTypes);
    return getDataTypeColor(connectorType);
}

function resolveOutputConnectorColor(data: NodeDataLike, entry: ConnectorPositionLike): string {
    const maybeNodeData = data as unknown as {
        getOutputType?: (outputId: string) => string;
    };

    if (typeof maybeNodeData.getOutputType === 'function' && entry.id) {
        try {
            const dynamicType = maybeNodeData.getOutputType(entry.id);
            if (typeof dynamicType === 'string' && dynamicType.trim()) {
                return getDataTypeColor(dynamicType);
            }
        } catch {
            // Best effort: fall back to the declared output type.
        }
    }

    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const outputByIndex = outputs[entry.index] as NodeOutputLike | undefined;
    if (outputByIndex?.outputType) {
        return getDataTypeColor(outputByIndex.outputType);
    }

    if (entry.id) {
        const outputById = outputs.find((output) => output?.id === entry.id) as
            | NodeOutputLike
            | undefined;
        if (outputById?.outputType) {
            return getDataTypeColor(outputById.outputType);
        }
    }

    return getDataTypeColor('any');
}

function mergeLocalizedTypeName(persistedTypeName: unknown, runtimeTypeName: unknown): unknown {
    if (!isPlainObject(persistedTypeName) && !isPlainObject(runtimeTypeName)) {
        return persistedTypeName ?? runtimeTypeName;
    }

    if (!isPlainObject(persistedTypeName)) {
        if (typeof persistedTypeName === 'string' && persistedTypeName.trim()) {
            return {
                ...(isPlainObject(runtimeTypeName) ? runtimeTypeName : {}),
                en: persistedTypeName.trim(),
            };
        }
        return runtimeTypeName;
    }

    return {
        ...(isPlainObject(runtimeTypeName) ? runtimeTypeName : {}),
        ...persistedTypeName,
    };
}

function getRuntimeTypeName(
    nodeUi: NodeUiRenderingContext | null | undefined,
    nodeTypeId: unknown
) {
    if (!nodeUi || !nodeTypeId) {
        return null;
    }

    const runtime = nodeUi.getWorkspace?.()?.runtimeCollection?.getActiveRuntime?.();
    if (!runtime) {
        return null;
    }

    return runtime.getNodeType?.(nodeTypeId)?.title ?? null;
}

/**
 * Icon descriptor the node header paints: a loaded image, an MDI glyph, or neither (placeholder).
 */
export interface NodeIconDescriptor {
    image: HTMLImageElement | null;
    mdiGlyph: string | null;
}

/**
 * Main draw method for rendering a node.
 * @param ctx - Canvas context.
 * @param data - Node data.
 * @param style - Style configuration.
 * @param selected - Whether node is selected.
 * @param options - Drawing options.
 * @param icon - Icon descriptor to render in the header (image or MDI glyph).
 * @param getVisibleControlsFn - Function to get visible controls.
 * @param getConnectorPositionsFn - Function to get connector positions.
 * @param nodeUi - NodeUi instance containing control instances.
 */
export function drawNode(
    ctx: CanvasRenderingContext2D | null | undefined,
    data: NodeDataLike | null | undefined,
    style: NodeUiStyle,
    selected: boolean,
    {
        hoverConnector = null,
        draggingConnection = null,
        relatedHighlight = false,
    }: DrawNodeOptions = {},
    icon: NodeIconDescriptor | null,
    getVisibleControlsFn: (node: NodeDataLike) => ControlDefinition[],
    getConnectorPositionsFn: (kind: ConnectorKind) => ConnectorPositionLike[],
    nodeUi: NodeUiRenderingContext | null | undefined
): void {
    if (!ctx || !data) return;

    const bounds = {
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
    };

    ctx.save();

    // Glow ring for the selected node or a node related to the selection.
    if (selected || relatedHighlight) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, NODE_CORNER_RADIUS);
        ctx.strokeStyle = relatedHighlight ? RELATED_NODE_BORDER_COLOR : style.selectedBorderColor;
        ctx.lineWidth = relatedHighlight ? 3 : 2;
        ctx.shadowColor = relatedHighlight ? RELATED_NODE_GLOW_COLOR : style.selectedBorderColor;
        ctx.shadowBlur = relatedHighlight ? RELATED_NODE_GLOW_BLUR : SELECTED_NODE_GLOW_BLUR;
        ctx.stroke();
        ctx.restore();
    }

    // Body — related nodes get a brighter version of their own fill; the selected node keeps its own
    ctx.fillStyle = relatedHighlight
        ? brightenColor(style.bodyColor, RELATED_NODE_BODY_BRIGHTEN)
        : style.bodyColor;
    const hasCapabilityIssue = hasNodeCapabilityIssues(data);
    ctx.strokeStyle = hasCapabilityIssue
        ? CAPABILITY_ISSUE_BORDER_COLOR
        : selected
          ? style.selectedBorderColor
          : relatedHighlight
            ? RELATED_NODE_BORDER_COLOR
            : style.borderColor;
    ctx.lineWidth = selected ? 3 : relatedHighlight ? 2 : 1.2;
    ctx.beginPath();
    ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, NODE_CORNER_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Header (clip to node radius so the top corners stay rounded)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, NODE_CORNER_RADIUS);
    ctx.clip();
    ctx.fillStyle = style.headerColor;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, NODE_HEADER_HEIGHT);
    ctx.restore();

    // Node type icon (left side)
    const iconSize = NODE_HEADER_ICON_SIZE;
    const iconX = bounds.x + NODE_HEADER_ICON_INSET;
    const iconY = bounds.y + (NODE_HEADER_HEIGHT - iconSize) / 2;

    // Draw icon if available: the loaded image, the resolved MDI glyph, else the placeholder square.
    const iconImage = icon?.image ?? null;
    const mdiGlyph = icon?.mdiGlyph ?? null;

    if (iconImage && iconImage.complete) {
        ctx.drawImage(iconImage, iconX, iconY, iconSize, iconSize);
    } else if (mdiGlyph) {
        ctx.fillStyle = style.textColor;
        ctx.font = MDI_CANVAS_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(mdiGlyph, iconX + iconSize / 2, iconY + iconSize / 2);
    } else {
        // Fallback: draw simple placeholder square
        ctx.fillStyle = style.textColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(iconX, iconY, iconSize, iconSize);
        ctx.globalAlpha = 1.0;
    }

    // Title (centred in the free span between icon and collapse button)
    ctx.fillStyle = style.textColor;
    // Use system font stack with fallbacks for better cross-platform rendering
    ctx.font = NODE_HEADER_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const locale = nodeUi?.getCurrentLocale?.() || 'en';
    const runtimeTypeName = getRuntimeTypeName(nodeUi, data.type);
    const resolvedTypeName = mergeLocalizedTypeName(data.typeName ?? data.title, runtimeTypeName);
    const title = resolveNodeDisplayName({
        userName: data.userName,
        typeName: resolvedTypeName,
        type: data.type,
        locale,
    });
    const safeLeft =
        bounds.x + NODE_HEADER_ICON_INSET + NODE_HEADER_ICON_SIZE + NODE_HEADER_TITLE_PADDING;
    const safeRight = bounds.x + bounds.width - COLLAPSE_BUTTON_SIZE + NODE_HEADER_TITLE_PADDING;
    const safeWidth = safeRight - safeLeft;

    // Extremely narrow nodes drop the title instead of drawing it under the chrome
    if (safeWidth >= 1) {
        const fittedTitle = fitTextToWidth(ctx, title, safeWidth);
        ctx.fillText(fittedTitle.text, safeLeft + safeWidth / 2, bounds.y + NODE_HEADER_HEIGHT / 2);
    }

    // Collapse indicator (chevron on right side)
    drawCollapseIndicator(
        ctx,
        bounds.x + bounds.width - COLLAPSE_BUTTON_SIZE / 2,
        bounds.y + NODE_HEADER_HEIGHT / 2,
        data.collapsed || false,
        style.textColor
    );

    // Connectors
    drawConnectors(
        ctx,
        'input',
        data,
        hoverConnector,
        draggingConnection,
        style,
        getConnectorPositionsFn,
        nodeUi
    );
    drawConnectors(
        ctx,
        'output',
        data,
        hoverConnector,
        draggingConnection,
        style,
        getConnectorPositionsFn,
        nodeUi
    );

    // Controls (only when not collapsed)
    if (!data.collapsed) {
        drawControls(ctx, data, style.textColor, getVisibleControlsFn, nodeUi);
        drawControlsConnectorSeparator(
            ctx,
            data,
            getVisibleControlsFn,
            getConnectorPositionsFn,
            nodeUi
        );
    }

    ctx.restore();
}

/**
 * Draw the collapse indicator (chevron) in the header.
 * @param ctx - Canvas context.
 * @param x - X coordinate.
 * @param y - Y coordinate.
 * @param collapsed - Whether node is collapsed.
 * @param textColor - Color for the chevron.
 */
export function drawCollapseIndicator(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    collapsed: boolean,
    textColor: string
): void {
    ctx.save();
    ctx.translate(x, y);

    // Rotate 180 degrees if collapsed
    if (collapsed) {
        ctx.rotate(Math.PI);
    }

    // Draw chevron down
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(0, 2);
    ctx.lineTo(4, -2);
    ctx.stroke();

    ctx.restore();
}

/**
 * Render all controls in the node body using control instances.
 *
 * The whole block is inset by {@link CONNECTOR_ROW_INSET} and every inline control draws
 * through one shared column, so labels line up with the connector labels below them.
 *
 * @param ctx - Canvas context.
 * @param data - Node data.
 * @param textColor - Text color from style.
 * @param getVisibleControlsFn - Function to get visible controls.
 * @param nodeUi - NodeUi instance containing control instances.
 */
export function drawControls(
    ctx: CanvasRenderingContext2D,
    data: NodeDataLike,
    textColor: string,
    getVisibleControlsFn: (node: NodeDataLike) => ControlDefinition[],
    nodeUi: NodeUiRenderingContext | null | undefined
): void {
    if (!data || !nodeUi) return;

    const visibleControls = getVisibleControlsFn(data);
    if (visibleControls.length === 0) return;

    ctx.save();

    // Calculate starting Y position (immediately after header, before connectors)
    let yOffset = data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING;

    // Control rendering area, aligned with the connector rows
    const leftMargin = data.x + CONNECTOR_ROW_INSET;
    const totalWidth = Math.max(0, data.width - CONNECTOR_ROW_INSET * 2);

    // One column for all inline controls of this node
    const column = computeControlColumnLayout({
        x: data.x,
        width: data.width,
        visibleControls,
        locale: nodeUi.getCurrentLocale?.() ?? 'en',
    });

    for (const control of visibleControls) {
        // Get the control UI instance
        const controlUi = nodeUi.controlInstances.get(control.id);
        if (!controlUi) {
            continue;
        }

        const controlGeometry = getControlGeometry(control, {
            x: leftMargin,
            y: yOffset,
            width: totalWidth,
            controlUi,
            labelWidth: column.labelWidth,
        });

        // Call control's renderCanvas method with full available width
        // Control handles label drawing and positioning its own value
        const hasCapabilityIssue = hasControlCapabilityIssue(data, control.id);
        if (hasCapabilityIssue) {
            ctx.save();
            ctx.strokeStyle = CAPABILITY_ISSUE_FIELD_OUTLINE_COLOR;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(
                leftMargin - 2,
                yOffset - 1,
                totalWidth + 4,
                controlGeometry.totalHeight + 2,
                4
            );
            ctx.stroke();
            ctx.restore();
        }

        controlUi.renderCanvas(ctx, {
            x: leftMargin,
            y: yOffset,
            width: totalWidth,
            height: controlGeometry.totalHeight,
            labelWidth: column.labelWidth,
        });

        yOffset += controlGeometry.totalHeight + CONTROL_SPACING;
    }

    ctx.restore();
}

/**
 * Draw the hairline separating the controls section from the connector rows.
 *
 * Drawn only when the node has both visible controls and connector rows; it spans exactly
 * the connector row inset and sits in the middle of the controls→connectors gap. Purely
 * decorative: node height, content minimum width and hit-testing are unaffected.
 *
 * @param ctx - Canvas context.
 * @param data - Node data.
 * @param getVisibleControlsFn - Function to get visible controls.
 * @param getConnectorPositionsFn - Function to get connector positions (already filtered).
 * @param nodeUi - NodeUi instance containing control instances.
 */
export function drawControlsConnectorSeparator(
    ctx: CanvasRenderingContext2D,
    data: NodeDataLike,
    getVisibleControlsFn: (node: NodeDataLike) => ControlDefinition[],
    getConnectorPositionsFn: (kind: ConnectorKind) => ConnectorPositionLike[],
    nodeUi: NodeUiRenderingContext | null | undefined
): void {
    if (!data || data.collapsed) return;

    const visibleControls = getVisibleControlsFn(data);
    if (visibleControls.length === 0) return;

    const rowCount = Math.max(
        getConnectorPositionsFn('input').length,
        getConnectorPositionsFn('output').length
    );
    if (rowCount === 0) return;

    const controlsHeight = getControlsSectionHeight(
        visibleControls,
        (controlId) => nodeUi?.controlInstances?.get?.(controlId) ?? null
    );
    const y =
        data.y +
        NODE_HEADER_HEIGHT +
        NODE_BODY_PADDING +
        controlsHeight +
        CONTROLS_CONNECTOR_GAP / 2;
    const x1 = data.x + CONNECTOR_ROW_INSET;
    const x2 = data.x + data.width - CONNECTOR_ROW_INSET;

    if (x2 - x1 < CONTROL_SEPARATOR_MIN_WIDTH) return;

    ctx.save();
    ctx.strokeStyle = CONTROL_SEPARATOR_COLOR;
    ctx.lineWidth = CONTROL_SEPARATOR_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(x1, Math.round(y) + 0.5);
    ctx.lineTo(x2, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
}

/**
 * Render connector icons and labels for a given kind.
 * @param ctx - Canvas context.
 * @param kind - Connector type to draw.
 * @param data - Node data.
 * @param hoverConnector - Descriptor of hovered connector, if any.
 * @param draggingConnection - Info about connection being dragged.
 * @param style - Style configuration.
 * @param getConnectorPositionsFn - Function to get connector positions.
 * @param nodeUi - NodeUi instance for accessing control instances.
 */
export function drawConnectors(
    ctx: CanvasRenderingContext2D,
    kind: ConnectorKind,
    data: NodeDataLike,
    hoverConnector: HoverConnectorLike | null,
    draggingConnection: DraggingConnectionLike | null,
    style: NodeUiStyle,
    getConnectorPositionsFn: (kind: ConnectorKind) => ConnectorPositionLike[],
    nodeUi: NodeUiRenderingContext | null | undefined
): void {
    const isCollapsed = data?.collapsed || false;
    const entries = getConnectorPositionsFn(kind);
    const visibleOutputs = kind === 'input' ? getVisibleOutputs(data) : [];

    ctx.save();
    ctx.font = CONNECTOR_LABEL_FONT;
    ctx.textBaseline = 'middle';
    const locale = nodeUi?.getCurrentLocale?.() || 'en';

    for (const entry of entries) {
        const hoverType = hoverConnector?.type || hoverConnector?.kind;
        const isHover =
            hoverConnector &&
            hoverConnector.nodeId === data.id &&
            hoverType === kind &&
            hoverConnector.index === entry.index;

        // Check if this connector should be highlighted during connection dragging
        const isCompatible = isConnectorCompatible(
            kind,
            entry.index,
            draggingConnection,
            data,
            getConnectorPositionsFn,
            nodeUi
        );
        const shouldHighlight = Boolean(isHover || isCompatible);

        if (kind === 'input') {
            const connectorColor = resolveInputConnectorColor(entry);
            // Check if this input is connected
            let isConnected = false;
            if (nodeUi && nodeUi.graph && entry.inputData) {
                isConnected = isInputConnected(data.id, entry.index, nodeUi.graph);
            }

            // Only draw label/control when not collapsed
            if (!isCollapsed) {
                const label = resolveConnectorLabelText(entry, locale);
                const labelHighlightColor = shouldHighlight ? connectorColor : null;

                // Draw default control for disconnected inputs, or label for connected inputs
                if (nodeUi && nodeUi.graph && entry.inputData) {
                    if (!isConnected && entry.inputData.defaultControl) {
                        // Disconnected with default control: draw control
                        const hasCapabilityIssue = hasInputDefaultCapabilityIssue(
                            data,
                            entry.inputData.id
                        );
                        const controlUi = nodeUi.inputDefaultControlInstances.get(
                            entry.inputData.id
                        );
                        if (controlUi) {
                            const opposingOutput = visibleOutputs[entry.row];
                            const controlBounds = getInputDefaultControlBounds({
                                nodeX: data.x,
                                nodeWidth: data.width,
                                inputConnectorX: entry.x,
                                inputCenterY: entry.y,
                                rowHasOpposingOutput: Boolean(opposingOutput),
                                opposingOutputLabelWidth: opposingOutput
                                    ? measureConnectorLabelWidth(
                                          resolveConnectorLabelText(opposingOutput, locale)
                                      )
                                    : 0,
                                fontScale: INPUT_DEFAULT_CONTROL_FONT_SCALE,
                                controlHeight: CONTROL_HEIGHT,
                            });

                            if (controlBounds.width <= 0) {
                                continue;
                            }

                            ctx.save();
                            // Scale down font for smaller rendering
                            ctx.scale(
                                INPUT_DEFAULT_CONTROL_FONT_SCALE,
                                INPUT_DEFAULT_CONTROL_FONT_SCALE
                            );

                            const controlX = controlBounds.x / INPUT_DEFAULT_CONTROL_FONT_SCALE;
                            const controlY = controlBounds.y / INPUT_DEFAULT_CONTROL_FONT_SCALE;
                            const controlWidth =
                                controlBounds.width / INPUT_DEFAULT_CONTROL_FONT_SCALE;
                            const controlHeight =
                                controlBounds.height / INPUT_DEFAULT_CONTROL_FONT_SCALE;

                            if (hasCapabilityIssue) {
                                ctx.save();
                                ctx.strokeStyle = CAPABILITY_ISSUE_FIELD_OUTLINE_COLOR;
                                ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                ctx.roundRect(
                                    controlX - 2,
                                    controlY - 1,
                                    controlWidth + 4,
                                    controlHeight + 2,
                                    4
                                );
                                ctx.stroke();
                                ctx.restore();
                            }

                            if (shouldHighlight) {
                                const labelBounds = controlUi.getCanvasLabelBounds?.(ctx, {
                                    x: controlX,
                                    y: controlY,
                                    width: controlWidth,
                                    height: controlHeight,
                                });

                                if (labelBounds && labelBounds.width > 0) {
                                    const padding = CONNECTOR_HIGHLIGHT_LABEL_PADDING_X;
                                    drawHighlightPill(
                                        ctx,
                                        {
                                            x: labelBounds.x - padding,
                                            y:
                                                labelBounds.y +
                                                labelBounds.height / 2 -
                                                CONNECTOR_HIGHLIGHT_LABEL_HEIGHT / 2,
                                            width: Math.min(
                                                labelBounds.width + padding * 2,
                                                controlWidth
                                            ),
                                            height: CONNECTOR_HIGHLIGHT_LABEL_HEIGHT,
                                        },
                                        connectorColor
                                    );
                                }
                            }

                            controlUi.renderCanvas(ctx, {
                                x: controlX,
                                y: controlY,
                                width: controlWidth,
                                height: controlHeight,
                            });
                            ctx.restore();
                        }
                    } else {
                        // Connected OR no default control: draw label
                        drawConnectorLabel(ctx, {
                            x: entry.x + CONNECTOR_LABEL_OFFSET,
                            y: entry.y,
                            align: 'left',
                            text: String(label),
                            textColor: style.textColor,
                            highlightColor: labelHighlightColor,
                        });
                    }
                } else {
                    // Fallback: draw label if no inputData available
                    drawConnectorLabel(ctx, {
                        x: entry.x + CONNECTOR_LABEL_OFFSET,
                        y: entry.y,
                        align: 'left',
                        text: String(label),
                        textColor: style.textColor,
                        highlightColor: labelHighlightColor,
                    });
                }
            }

            // Draw narrow rectangular socket shape (open to the left for output connector to fit)
            // Height is reduced to just fit the connection line width (2.5px), creating a plug-in appearance
            const socketHeight = 4.5; // Slightly larger than connection line width (2.5px)
            const socketWidth = CONNECTOR_RADIUS; // Half the original width

            ctx.fillStyle = connectorColor;
            ctx.strokeStyle = connectorColor;
            ctx.lineWidth =
                INPUT_CONNECTOR_STROKE_WIDTH *
                (shouldHighlight ? CONNECTOR_HIGHLIGHT_STROKE_SCALE : 1);

            ctx.beginPath();
            ctx.moveTo(entry.x - socketWidth, entry.y - socketHeight / 2);
            ctx.lineTo(entry.x, entry.y - socketHeight / 2);
            ctx.lineTo(entry.x, entry.y + socketHeight / 2);
            ctx.lineTo(entry.x - socketWidth, entry.y + socketHeight / 2);
            ctx.stroke();

            ctx.fillStyle = colorToAlpha(
                connectorColor,
                shouldHighlight ? CONNECTOR_HIGHLIGHT_FILL_ALPHA : 0.28
            );
            ctx.fill();
        } else {
            const connectorColor = resolveOutputConnectorColor(data, entry);
            // Output connector - match input connector size (narrow plug shape)
            const plugWidth = CONNECTOR_RADIUS; // Same as input socket width

            ctx.fillStyle = connectorColor;
            ctx.strokeStyle = connectorColor;
            ctx.lineWidth =
                OUTPUT_CONNECTOR_STROKE_WIDTH *
                (shouldHighlight ? CONNECTOR_HIGHLIGHT_STROKE_SCALE : 1);

            // Draw narrow rectangular plug shape (extends to the right)
            ctx.beginPath();
            ctx.moveTo(entry.x, entry.y);
            ctx.lineTo(entry.x + plugWidth, entry.y);
            ctx.stroke();

            ctx.fillStyle = colorToAlpha(
                connectorColor,
                shouldHighlight ? CONNECTOR_HIGHLIGHT_FILL_ALPHA : 0.3
            );
            ctx.fill();

            // Only draw label when not collapsed
            if (!isCollapsed) {
                const label = resolveConnectorLabelText(entry, locale);
                drawConnectorLabel(ctx, {
                    x: entry.x - CONNECTOR_LABEL_OFFSET,
                    y: entry.y,
                    align: 'right',
                    text: String(label),
                    textColor: style.textColor,
                    highlightColor: shouldHighlight ? connectorColor : null,
                });
            }
        }
    }

    ctx.restore();
}

/**
 * Check if a connector is compatible with a dragging connection.
 * @param kind - The kind of connector to check.
 * @param index - The index of the connector.
 * @param draggingConnection - The connection being dragged.
 * @param nodeData - Node data.
 * @param getConnectorPositionsFn - Function to get connector positions.
 * @returns True if compatible.
 */
function isConnectorCompatible(
    kind: ConnectorKind,
    index: number,
    draggingConnection: DraggingConnectionLike | null,
    nodeData: NodeDataLike,
    getConnectorPositionsFn: (kind: ConnectorKind) => ConnectorPositionLike[],
    nodeUi: NodeUiRenderingContext | null | undefined
): boolean {
    if (!draggingConnection) return false;

    // draggingConnection is tempConnection: { start: {x,y}, end: {x,y}, startKind: 'input'|'output' }
    const sourceKind = draggingConnection.startKind;
    if (!sourceKind) return false;

    // Must be opposite kind: only highlight inputs when dragging from output, and vice versa
    if (kind === sourceKind) {
        // Same kind (both inputs or both outputs) - not compatible
        return false;
    }

    const startNodeId = draggingConnection.startNodeId;
    const startIndex = draggingConnection.startIndex;
    const targetNodeId = nodeData?.id;

    if (!startNodeId || typeof startIndex !== 'number' || !targetNodeId) {
        return false;
    }

    const graph = nodeUi?.graph as
        | {
              canConnect?: (
                  fromNodeId: string,
                  fromIndex: number,
                  toNodeId: string,
                  toIndex: number
              ) => { valid: boolean };
          }
        | undefined;

    if (!graph || typeof graph.canConnect !== 'function') {
        return false;
    }

    if (sourceKind === 'output') {
        return Boolean(graph.canConnect(startNodeId, startIndex, targetNodeId, index)?.valid);
    }

    return Boolean(graph.canConnect(targetNodeId, index, startNodeId, startIndex)?.valid);
}

/**
 * Compute connector anchor points and metadata.
 * @param kind - Connector type.
 * @param data - Node data.
 * @param getVisibleControlsFn - Function to get visible controls.
 * @returns Connector positions.
 */
export function computeConnectorPositions(
    kind: ConnectorKind,
    data: NodeDataLike | null | undefined,
    getVisibleControlsFn: (node: NodeDataLike) => ControlDefinition[],
    getControlUiFn?: (controlId: string) => ControlUiLike | null | undefined
): ConnectorRenderEntry[] {
    if (!data) return [];

    const isInput = kind === 'input';
    // Use visible inputs/outputs while keeping each connector's original index.
    const visibleEntries = (
        isInput ? getVisibleInputEntries(data) : getVisibleOutputEntries(data)
    ) as Array<{ entry: NodeInputLike | NodeOutputLike; index: number }>;

    const positions: ConnectorRenderEntry[] = [];

    // X position: extend outside node border
    const baseX = isInput ? data.x + CONNECTOR_OVERLAP : data.x + data.width - CONNECTOR_OVERLAP;

    // Calculate Y position: after header + padding + all visible controls
    const visibleControls = getVisibleControlsFn(data);
    const controlsHeight =
        visibleControls.length > 0 ? getControlsSectionHeight(visibleControls, getControlUiFn) : 0;
    const centerY =
        data.y +
        NODE_HEADER_HEIGHT +
        NODE_BODY_PADDING +
        controlsHeight +
        getControlsConnectorGap(visibleControls, visibleEntries.length) +
        CONNECTOR_RADIUS;

    visibleEntries.forEach(({ entry, index }, row) => {
        // When collapsed, all connectors overlay at header center
        const y = data.collapsed
            ? data.y + NODE_HEADER_HEIGHT / 2
            : centerY + row * CONNECTOR_SPACING;
        const position: ConnectorRenderEntry = {
            type: kind,
            index,
            row,
            x: baseX,
            y,
            id: entry.id,
            label: entry.name || entry.label,
        };
        // Include inputData for rendering default controls
        if (isInput) {
            position.inputData = entry as NodeInputLike;
        }
        positions.push(position);
    });
    return positions;
}
