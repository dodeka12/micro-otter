// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Constants for Node UI rendering and layout.
 */

import { IRQ_NAME_SOURCE } from './irq-triggers.js';
import { SIGNAL_NAME_SOURCE } from './signal-names.js';
import { VAR_NAME_SOURCE, VAR_STORE_SOURCE } from './var-stores.js';

export type NodeUiStyle = {
    bodyColor: string;
    headerColor: string;
    borderColor: string;
    selectedBorderColor: string;
    textColor: string;
};

export type NodeUiInputControlConfig = {
    inputDefaultControlFontScale: number;
};

/** Dynamic-control sources whose option list is built from *other* nodes. */
export const CROSS_NODE_DYNAMIC_SOURCES: string[] = [
    'graphTopics',
    'availabilityRefs',
    VAR_STORE_SOURCE,
    VAR_NAME_SOURCE,
    IRQ_NAME_SOURCE,
    SIGNAL_NAME_SOURCE,
];

export const DEFAULT_STYLE: NodeUiStyle = {
    bodyColor: '#5b7fc7',
    headerColor: '#2d3350',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    selectedBorderColor: '#f0d858',
    textColor: '#f5f5f5',
};

export const NODE_HEADER_HEIGHT: number = 22;
export const NODE_BODY_PADDING: number = 6;
export const NODE_CORNER_RADIUS: number = 10;
export const CONNECTOR_RADIUS: number = 7;
/**
 * Vertical pitch between connector rows: `CONTROL_HEIGHT` (18) plus a 3 px gap, so
 * neighbouring rows never touch.
 */
export const CONNECTOR_SPACING: number = 21;
/**
 * Gap between the controls block and the first connector row.
 *
 * Measured from the end of the controls section (which already includes one trailing
 * `CONTROL_SPACING`). `calculateNodeHeight()`, `computeConnectorPositions()` and control
 * hit-testing all consume it through `getControlsConnectorGap()`, so they cannot drift.
 */
export const CONTROLS_CONNECTOR_GAP: number = 12;
export const CONNECTOR_LABEL_OFFSET: number = 14;
export const CONNECTOR_OVERLAP: number = 2; // How much connector extends outside node
export const HIT_PADDING: number = 4;
export const CONTROL_HEIGHT: number = 18;
export const CONTROL_SPACING: number = 5;
/**
 * Gap between a control's label column and its value area.
 *
 * This is the single definition of the label→value gap. Renderers, hit-testing and the
 * minimum-width computation must all use it instead of hardcoding their own margin.
 */
export const CONTROL_LABEL_MARGIN: number = 4;
/**
 * Font used to measure and draw control labels on the node canvas.
 *
 * The same string must be assigned to `ctx.font` before control labels are drawn —
 * `measureControlLabelWidth()` measures label text with this font, and the measured
 * values drive the shared label column and the content-derived minimum node width.
 */
export const CONTROL_LABEL_FONT =
    '500 11px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
/**
 * Per-character width estimate for control labels when no measuring canvas is
 * available (headless tests, SSR). Keeps the column maths deterministic there.
 */
export const CONTROL_LABEL_CHAR_WIDTH_ESTIMATE: number = 7;
/**
 * Default floor for a control's value column.
 *
 * These floors are *minimum widths for the value column*, not preferred widths: a node
 * is widened until `label column + margin + floor` fits. `getLayout().width` is
 * intentionally not used for this purpose — checkbox and color keep their intrinsic
 * drawings inside whatever column they are given.
 */
export const CONTROL_VALUE_MIN_WIDTH: number = 80;
/**
 * Per-control-type value column floors (px).
 *
 * Frozen so a typo cannot silently resize every node. Unknown types fall back to
 * {@link CONTROL_VALUE_MIN_WIDTH}.
 */
export const CONTROL_VALUE_MIN_WIDTH_BY_TYPE: Readonly<Record<string, number>> = Object.freeze({
    number: 80,
    dropdown: 96,
    text: 96,
    // `icon` inherits the text editor and canvas rendering, so it shares the text floor.
    icon: 96,
    checkbox: 24,
    color: 40,
    slider: 120,
});
/**
 * Distance from the node edge to the first pixel of a connector label or of an input's
 * default control: the connector overlaps the border by {@link CONNECTOR_OVERLAP} and
 * the label/control starts after {@link CONNECTOR_LABEL_OFFSET}.
 *
 * Panel controls are inset by the same amount so control labels line up with connector
 * labels.
 */
export const CONNECTOR_ROW_INSET: number = CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET;
export const COLLAPSE_BUTTON_SIZE: number = 24;
/**
 * Colour of the hairline that separates the controls section from the connector rows.
 *
 * Kept subtle and theme-neutral (no per-style override in this plan) so it reads on both
 * the node body and the header colours.
 */
export const CONTROL_SEPARATOR_COLOR = 'rgba(255, 255, 255, 0.18)';
/**
 * Thickness of the controls/connector separator in pixels.
 */
export const CONTROL_SEPARATOR_THICKNESS: number = 1;
/**
 * Minimum width of the controls/connector separator; narrower nodes draw none.
 */
export const CONTROL_SEPARATOR_MIN_WIDTH: number = 8;
/**
 * Size of the node type icon drawn in the header.
 */
export const NODE_HEADER_ICON_SIZE: number = 16;
/**
 * Distance from the node's left edge to the header icon.
 */
export const NODE_HEADER_ICON_INSET: number = 6;
/**
 * Minimum gap between the title text and the header icon / collapse button.
 */
export const NODE_HEADER_TITLE_PADDING: number = 4;
/**
 * Font used to measure and draw the node title.
 *
 * Must equal the font assigned to `ctx.font` before the title is measured, otherwise the
 * title gets ellipsised at the wrong length.
 */
export const NODE_HEADER_TITLE_FONT =
    '600 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
export const INPUT_DEFAULT_CONTROL_FONT_SCALE: number = 1; // Match regular node control size
/**
 * Smallest width at which an input's default control stays operable.
 *
 * The control never shrinks below this value; if the connector row cannot provide
 * the space, `NodeUi.ensureNodeWidth()` widens the node instead.
 */
export const INPUT_DEFAULT_CONTROL_MIN_WIDTH: number = 64;
/**
 * Fallback space reserved to the right of a row for the opposing output label.
 *
 * Only used when the actual label width cannot be measured
 * (`getInputDefaultControlBounds()` without `opposingOutputLabelWidth`).
 */
export const OUTPUT_LABEL_RESERVED_WIDTH: number = 84;
export const CONNECTOR_ROW_RESERVED_GAP: number = 6;
/**
 * Font used for connector labels in the node body.
 *
 * Must stay identical to the font assigned to `ctx.font` before connector labels are
 * drawn — `measureConnectorLabelWidth()` measures label text with this font, and the
 * measured values drive the connector row layout.
 */
export const CONNECTOR_LABEL_FONT = '11px "Segoe UI", Arial, sans-serif';
/**
 * Stroke width of an input socket, and of an output plug, in pixels.
 *
 * Highlighted connectors scale these by {@link CONNECTOR_HIGHLIGHT_STROKE_SCALE} so an
 * allowed input and an allowed output read with the same weight.
 */
export const INPUT_CONNECTOR_STROKE_WIDTH: number = 2;
export const OUTPUT_CONNECTOR_STROKE_WIDTH: number = 4;
/**
 * Stroke-width multiplier applied to a connector that is hovered or compatible with the
 * connection being dragged.
 */
export const CONNECTOR_HIGHLIGHT_STROKE_SCALE: number = 1.5;
/**
 * Fill opacity of a highlighted connector.
 *
 * Shared by input sockets and output plugs so both kinds of allowed target look the same
 * while a connection is dragged; unhighlighted connectors keep their own base alpha.
 */
export const CONNECTOR_HIGHLIGHT_FILL_ALPHA: number = 0.45;
/**
 * Dark backdrop drawn behind a connector label while that connector is hovered or
 * compatible with the dragged connection.
 *
 * The label text keeps the node style's `textColor` instead of switching to the data-type
 * colour, because light types such as `any` (`#e3e3e3`) are unreadable as text on a light
 * node body. The data-type colour moves to the backdrop's border instead, so the type stays
 * visible without risking an invisible label.
 */
export const CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR = 'rgba(31, 41, 55, 0.95)';
export const CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH: number = 1;
export const CONNECTOR_HIGHLIGHT_LABEL_PADDING_X: number = 4;
export const CONNECTOR_HIGHLIGHT_LABEL_HEIGHT: number = 16;
export const CONNECTOR_HIGHLIGHT_LABEL_RADIUS: number = 4;
/**
 * Per-character width estimate for connector labels when no measuring canvas is
 * available (headless tests, SSR). Keeps the layout maths deterministic there.
 */
export const OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE: number = 7;

/**
 * Blue outline for nodes connected to the current selection.
 *
 * Kept deliberately distinct from {@link DEFAULT_STYLE.selectedBorderColor} (yellow) so
 * one-hop neighbours never read as the selected node.
 */
export const RELATED_NODE_BORDER_COLOR = 'rgba(96, 165, 250, 0.95)';
/**
 * Blue halo colour for nodes connected to the current selection.
 *
 * Used as the canvas shadow colour behind {@link RELATED_NODE_BORDER_COLOR}; the selected
 * node keeps its own `selectedBorderColor` glow.
 */
export const RELATED_NODE_GLOW_COLOR = 'rgba(96, 165, 250, 0.55)';
export const RELATED_NODE_GLOW_BLUR = 20;
export const SELECTED_NODE_GLOW_BLUR = 14;
/**
 * Fraction the body fill is blended toward white for one-hop-related nodes.
 *
 * Keeps each node's own hue (including per-node `data.color`) while making neighbours of the
 * selection visibly brighter than the selected node, which keeps its normal fill and yellow ring.
 */
export const RELATED_NODE_BODY_BRIGHTEN = 0.22;
