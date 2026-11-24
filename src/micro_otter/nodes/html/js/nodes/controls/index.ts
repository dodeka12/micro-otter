// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Control UI exports: Barrel file for all control UI classes.
 */

export { default as NodeControlUi } from './node-control-ui.js';
export { default as NumberControlUi, clampNumericControlValue } from './number-control-ui.js';
export { default as TextControlUi } from './text-control-ui.js';
export { default as CheckboxControlUi } from './checkbox-control-ui.js';
export { default as NodeDropdownControlUi } from './node-dropdown-control-ui.js';
export { default as SliderControlUi } from './slider-control-ui.js';
export { default as ColorControlUi } from './color-control-ui.js';
export { default as IconControlUi } from './icon-control-ui.js';

export type { default as NodeControlUiType } from './node-control-ui.js';
export type { default as NumberControlUiType } from './number-control-ui.js';
export type { default as TextControlUiType } from './text-control-ui.js';
export type { default as CheckboxControlUiType } from './checkbox-control-ui.js';
export type { default as NodeDropdownControlUiType } from './node-dropdown-control-ui.js';
export type { default as SliderControlUiType } from './slider-control-ui.js';
export type { default as ColorControlUiType } from './color-control-ui.js';
export type { default as IconControlUiType } from './icon-control-ui.js';

export type {
    ControlValue,
    ControlLabel,
    NodeControlData,
    NodeDataLike,
    NodeUiLike,
    NodeControlUiOptions,
    ControlRenderLayout,
    ValueLayout,
    EditorScreenPoint,
    ControlPoint,
    HitTestResult,
} from './node-control-ui.js';

export type {
    NumberControlConstraints,
    NumberControlPayload,
    NumberControlNodeState,
    NumberControlNodeUiLike,
    NumberControlLayout,
    NumberControlDimensions,
    NumericParsePayload,
    NumericValidationPayload,
} from './number-control-ui.js';

export type {
    CheckboxControlLocalizedLabel,
    CheckboxControlPayload,
    CheckboxControlNodeState,
    CheckboxControlChangeTarget,
    CheckboxControlNodeUiLike,
    CheckboxControlLayout,
    CheckboxControlDimensions,
} from './checkbox-control-ui.js';

export type {
    NodeDropdownControlLocalizedLabel,
    NodeDropdownOptionLabel,
    NodeDropdownOption,
    NodeDropdownControlPayload,
    NodeDropdownControlNodeState,
    NodeDropdownControlVisibilityChangePayload,
    NodeDropdownControlNodeUiLike,
    NodeDropdownControlLayout,
    NodeDropdownControlDimensions,
    NodeDropdownSelectedValue,
} from './node-dropdown-control-ui.js';

export type {
    ColorControlLocalizedLabel,
    ColorControlPayload,
    ColorControlNodeState,
    ColorControlNodeUiLike,
    ColorControlLayout,
    ColorControlDimensions,
    ColorControlValueLayout,
    ParsedColorValue,
} from './color-control-ui.js';
