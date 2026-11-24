// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Hit testing methods for NodeUi.
 */

import {
    pointInRect,
    getVisibleControls,
    getVisibleInputEntries,
    getVisibleOutputs,
    computeControlColumnLayout,
    getControlGeometry,
    getControlsConnectorGap,
    getControlsSectionHeight,
    getInputDefaultControlBounds,
    isInputConnected,
    measureConnectorLabelWidth,
    resolveConnectorLabelText,
} from './node-ui-helpers.js';
import {
    HIT_PADDING,
    CONNECTOR_RADIUS,
    NODE_HEADER_HEIGHT,
    COLLAPSE_BUTTON_SIZE,
    NODE_BODY_PADDING,
    CONNECTOR_ROW_INSET,
    CONTROL_HEIGHT,
    CONTROL_SPACING,
    CONNECTOR_OVERLAP,
    CONNECTOR_SPACING,
    INPUT_DEFAULT_CONTROL_FONT_SCALE,
} from './node-ui-constants.js';

export type ConnectorKind = 'input' | 'output';

export interface Position {
    x: number;
    y: number;
}

export interface Rect extends Position {
    width: number;
    height: number;
}

export interface NodeConnectorPosition extends Position {
    type: ConnectorKind;
    index: number;
    id?: string;
}

export interface ConnectorHitResult extends Position {
    type: ConnectorKind;
    index: number;
    id: string | undefined;
    nodeId: string;
}

export interface HeaderHitResult {
    type: 'name' | 'collapse' | 'drag';
    bounds?: Rect;
}

export interface ResizeHandleHitResult {
    edge: 'left' | 'right';
}

export interface HitTestResult {
    hit?: boolean;
}

export interface ControlLayout {
    height?: number;
}

export interface ControlUiLike {
    getLayout?: () => ControlLayout | null | undefined;
    hitTest?: (point: Position, bounds: Rect) => HitTestResult | null | undefined;
}

export interface NodeControlLike {
    id: string;
    type: string;
    layout?: 'inline' | 'stacked';
}

export interface InputDefaultControlLike {
    type?: string;
}

export interface NodeInputLike {
    id: string;
    name?: unknown;
    label?: unknown;
    defaultControl?: InputDefaultControlLike;
}

export interface NodeOutputLike {
    id?: string;
    name?: unknown;
    label?: unknown;
}

export interface NodeDataLike {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    collapsed?: boolean;
    controls?: NodeControlLike[];
    controlValues?: Record<string, unknown>;
    inputs?: NodeInputLike[];
    outputs?: NodeOutputLike[];
}

export interface NodeGraphLike {
    getConnections?: () => unknown[];
}

export interface NodeUiLike {
    getNodeData?: () => NodeDataLike | null;
    getCurrentLocale?: () => string;
    controlInstances?: {
        get?: (id: string) => ControlUiLike | null | undefined;
    };
    inputDefaultControlInstances?: {
        get: (id: string) => ControlUiLike | null | undefined;
    };
    /**
     * Visible controls in the order the node draws them.
     *
     * A `dynamicOptions` picker only knows its `activeControls` after resolution (the
     * `__new__` sentinel of a store or variable picker reveals its companion text control
     * that way), so the raw `control.options` list cannot serve hit testing: it would
     * include the companion controls of every option and return a row one slot off.
     */
    _getVisibleControls?: (data: NodeDataLike) => ReturnType<typeof getVisibleControls>;
    graph?: NodeGraphLike;
}

export interface ControlHitResult {
    controlId: string;
    type: string;
    bounds: Rect;
    controlUi?: ControlUiLike;
    control?: NodeControlLike | InputDefaultControlLike;
    isInputDefault?: boolean;
}

/**
 * Hit test the node body (not connectors).
 * @param point - Point to test.
 * @param bounds - Node bounds.
 * @param padding - Extra padding around the body hit box.
 * @returns True if the point lands within the padded rectangle.
 */
export function hitTestNode(
    point: Position | null | undefined,
    bounds: Rect,
    padding = HIT_PADDING
) {
    const { x, y, width, height } = bounds;
    const px = point?.x ?? 0;
    const py = point?.y ?? 0;
    return (
        px >= x - padding &&
        px <= x + width + padding &&
        py >= y - padding &&
        py <= y + height + padding
    );
}

/**
 * Hit test connectors. Returns null if nothing hit; otherwise a descriptor.
 * @param point - Point to test.
 * @param connectors - Array of connector positions from getConnectors().
 * @param nodeId - ID of this node.
 */
export function hitTestConnector(
    point: Position | null | undefined,
    connectors: NodeConnectorPosition[],
    nodeId: string
): ConnectorHitResult | null {
    const px = point?.x ?? 0;
    const py = point?.y ?? 0;
    for (const entry of connectors) {
        const dx = px - entry.x;
        const dy = py - entry.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= CONNECTOR_RADIUS + HIT_PADDING) {
            return {
                type: entry.type,
                index: entry.index,
                id: entry.id,
                nodeId: nodeId,
                x: entry.x,
                y: entry.y,
            };
        }
    }
    return null;
}

/**
 * Hit test for node header elements (name, collapse button).
 * Layout: [Icon 6-22px] [Title centered] [Collapse button right 24px]
 * @param point - Canvas coordinates.
 * @param data - Node data.
 */
export function hitTestHeader(
    point: Position,
    data: NodeDataLike | null | undefined
): HeaderHitResult | null {
    if (!data) return null;

    const headerBounds: Rect = {
        x: data.x,
        y: data.y,
        width: data.width,
        height: NODE_HEADER_HEIGHT,
    };

    if (!pointInRect(point, headerBounds)) {
        return null;
    }

    const collapseBounds: Rect = {
        x: data.x + data.width - COLLAPSE_BUTTON_SIZE,
        y: data.y,
        width: COLLAPSE_BUTTON_SIZE,
        height: NODE_HEADER_HEIGHT,
    };

    if (pointInRect(point, collapseBounds)) {
        return { type: 'collapse' };
    }

    const nameBounds: Rect = {
        x: data.x + 24,
        y: data.y,
        width: data.width - 24 - COLLAPSE_BUTTON_SIZE,
        height: NODE_HEADER_HEIGHT,
    };

    if (pointInRect(point, nameBounds)) {
        return { type: 'name', bounds: nameBounds };
    }

    return { type: 'drag' };
}

/**
 * Visible controls in the order the node draws them.
 *
 * Hit testing must walk the same rows the renderer paints, and the renderer paints the
 * *resolved* control list: `getVisibleControls()` alone sees a dynamic picker's raw
 * `options` (usually none), so a sibling only the selected option reveals — the
 * `customName` companion of a variable picker sitting on `__new__` — would be filtered
 * differently on the two sides. Every row below such a picker then lands one slot off, so
 * a click opens the editor of the wrong control and the text the user types is stored
 * under a control they never saw.
 *
 * @param nodeUi - Node UI, which owns the resolved (and cached) row list.
 * @param data - Node data currently read from the graph.
 * @returns The controls in paint order.
 */
function visibleControlsOf(nodeUi: NodeUiLike, data: NodeDataLike): NodeControlLike[] {
    const controls = nodeUi._getVisibleControls
        ? nodeUi._getVisibleControls(data)
        : getVisibleControls(data);
    return (controls || []) as NodeControlLike[];
}

/**
 * Hit test for control elements in the node body.
 * Layout order: Header → Controls → Connectors (controls come first now)
 * @param nodeUi - NodeUi instance (provides data + control instances).
 * @param point - Canvas coordinates.
 */
export function hitTestControl(
    nodeUi: NodeUiLike | null | undefined,
    point: Position | null | undefined
): ControlHitResult | null {
    if (!nodeUi || !point) return null;

    const data = nodeUi.getNodeData ? nodeUi.getNodeData() : null;
    if (!data || data.collapsed) return null;

    const visibleControls = visibleControlsOf(nodeUi, data);

    let yOffset = data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING;

    const leftMargin = data.x + CONNECTOR_ROW_INSET;
    const totalWidth = Math.max(0, data.width - CONNECTOR_ROW_INSET * 2);

    // Must stay identical to the column computed by the render path
    // (`node-ui-rendering.ts`), otherwise the returned bounds drift from the drawn value.
    const column = computeControlColumnLayout({
        x: data.x,
        width: data.width,
        visibleControls,
        locale: nodeUi.getCurrentLocale?.() || 'en',
    });

    for (const control of visibleControls || []) {
        const controlUi = nodeUi.controlInstances?.get?.(control.id) || null;
        const controlGeometry = getControlGeometry(control, {
            x: leftMargin,
            y: yOffset,
            width: totalWidth,
            controlUi,
            labelWidth: column.labelWidth,
        });

        const controlBounds: Rect = controlGeometry.fullBounds;

        if (controlUi && pointInRect(point, controlBounds)) {
            const localPoint: Position = {
                x: point.x - controlBounds.x,
                y: point.y - controlBounds.y,
            };

            const hitResult = controlUi.hitTest
                ? controlUi.hitTest(localPoint, controlBounds)
                : null;

            if (hitResult?.hit ?? true) {
                return {
                    controlId: control.id,
                    type: control.type,
                    bounds: controlGeometry.valueBounds,
                    controlUi,
                    control,
                };
            }
        }

        yOffset += controlGeometry.totalHeight + CONTROL_SPACING;
    }

    if (!data.collapsed && nodeUi.graph && nodeUi.inputDefaultControlInstances) {
        const visibleInputEntries = getVisibleInputEntries(data) as Array<{
            entry: NodeInputLike;
            index: number;
        }>;
        const visibleOutputs = getVisibleOutputs(data);
        const visibleControls = visibleControlsOf(nodeUi, data);
        const controlsHeight =
            visibleControls.length > 0
                ? getControlsSectionHeight(
                      visibleControls,
                      (controlId) => nodeUi.controlInstances?.get?.(controlId) ?? null
                  )
                : 0;
        const baseY =
            data.y +
            NODE_HEADER_HEIGHT +
            NODE_BODY_PADDING +
            controlsHeight +
            getControlsConnectorGap(visibleControls, visibleInputEntries.length) +
            CONNECTOR_RADIUS;

        for (let row = 0; row < visibleInputEntries.length; row++) {
            const { entry: input, index } = visibleInputEntries[row];
            if (!input.defaultControl) continue;

            const isConnected = isInputConnected(data.id, index, nodeUi.graph);
            if (isConnected) continue;

            const controlUi = nodeUi.inputDefaultControlInstances.get(input.id);
            if (!controlUi) continue;

            const inputY = baseY + row * CONNECTOR_SPACING;
            const inputConnectorX = data.x + CONNECTOR_OVERLAP;
            // Must stay identical to the bounds computed by the render path
            // (`node-ui-rendering.ts`), otherwise clicks land beside the drawn control.
            const opposingOutput = visibleOutputs[row];
            const controlBounds = getInputDefaultControlBounds({
                nodeX: data.x,
                nodeWidth: data.width,
                inputConnectorX,
                inputCenterY: inputY,
                rowHasOpposingOutput: Boolean(opposingOutput),
                opposingOutputLabelWidth: opposingOutput
                    ? measureConnectorLabelWidth(
                          resolveConnectorLabelText(
                              opposingOutput,
                              nodeUi.getCurrentLocale?.() || 'en'
                          )
                      )
                    : 0,
                fontScale: INPUT_DEFAULT_CONTROL_FONT_SCALE,
                controlHeight: CONTROL_HEIGHT,
            });

            if (controlBounds.width <= 0) {
                continue;
            }

            if (pointInRect(point, controlBounds)) {
                const localPoint: Position = {
                    x: (point.x - controlBounds.x) / INPUT_DEFAULT_CONTROL_FONT_SCALE,
                    y: (point.y - controlBounds.y) / INPUT_DEFAULT_CONTROL_FONT_SCALE,
                };

                const hitResult = controlUi.hitTest
                    ? controlUi.hitTest(localPoint, controlBounds)
                    : null;

                if (hitResult?.hit ?? true) {
                    return {
                        controlId: input.id,
                        type: input.defaultControl.type,
                        bounds: controlBounds,
                        controlUi,
                        control: input.defaultControl,
                        isInputDefault: true,
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Hit test left/right node resize handles.
 * Handles are thin vertical strips along node sides.
 */
export function hitTestResizeHandle(
    point: Position,
    data: NodeDataLike | null | undefined,
    handleWidth = 8,
    verticalPadding = 4
): ResizeHandleHitResult | null {
    if (!data || data.collapsed) {
        return null;
    }

    const leftBounds: Rect = {
        x: data.x - handleWidth * 0.5,
        y: data.y + verticalPadding,
        width: handleWidth,
        height: Math.max(0, data.height - verticalPadding * 2),
    };
    if (pointInRect(point, leftBounds)) {
        return { edge: 'left' };
    }

    const rightBounds: Rect = {
        x: data.x + data.width - handleWidth * 0.5,
        y: data.y + verticalPadding,
        width: handleWidth,
        height: Math.max(0, data.height - verticalPadding * 2),
    };
    if (pointInRect(point, rightBounds)) {
        return { edge: 'right' };
    }

    return null;
}
