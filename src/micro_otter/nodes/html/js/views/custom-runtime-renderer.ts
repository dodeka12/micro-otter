// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Custom runtime renderer used by CustomRuntimeView.
 *
 * Transforms declarative JSON custom view specifications into interactive DOM
 * elements with controls, sections, and function execution capabilities.
 *
 * @module views/custom-runtime-renderer
 */

import {
    TextControl,
    NumberControl,
    DropdownControl,
    CheckboxControl,
    ButtonControl,
    type TextControlValidation,
} from './controls/custom-runtime-controls.js';
import { ProgressTracker } from '../core/progress-events.js';
import { ToolbarView } from './toolbar-view.js';
import { IconProvider } from './icon-provider.js';
import { ViewBase } from './view-base.js';
import { StackView, type StackItem, type StackViewAlignment } from './stack-view.js';
import { MessageView } from './message-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { SplitView } from './split-view.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

interface DeviceConnection {
    executeCustomViewAction?(
        functionName: string,
        parameters: unknown[],
        options: { runtimeImpact?: RuntimeImpact }
    ): Promise<string>;
    executeCustomViewRefreshAction?(
        functionName: string,
        parameters: unknown[],
        options: { runtimeImpact: RuntimeImpact }
    ): Promise<string>;
    softReset?(): Promise<void>;
    exitRawRepl?(): Promise<void>;
}

type RuntimeImpact = 'none' | 'stop' | 'restart';

interface I18nService {
    t(key: string, variables?: Record<string, unknown>): string;
}

interface DialogPayload {
    title: string;
    message: string;
    detail?: string;
    icon?: unknown;
    confirmLabel?: string;
    scrim?: unknown;
}

interface ViewManager {
    showError(payload: DialogPayload): Promise<void>;
    showInfo(payload: Omit<DialogPayload, 'detail'>): Promise<void>;
}

interface Logger {
    error?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
}

interface ToolbarBinding {
    controlId: string;
    toolbarControl: { element: HTMLButtonElement | null };
}

interface RuntimeControl {
    element?: HTMLElement | null;
    _disabled?: boolean;
    _executing?: boolean;
    render?(container: HTMLElement): void;
    destroy?(): void;
    getValue(): unknown;
    setValue(value: unknown): void;
    setDisabled?(disabled: boolean): void;
    validate?(): boolean;
    onChange?(handler: () => void): void;
    onClick?(handler: () => void): void;
}

interface FunctionConfig {
    name: string;
    parameters?: unknown[];
    runtimeImpact?: RuntimeImpact;
    executionIntent?: 'helper' | 'refresh';
    onSuccess?: SuccessConfig;
    onError?: ErrorConfig;
}

interface MappingEntry {
    controlId?: string;
    translate?: boolean;
}

type MappingValue = string | MappingEntry;

interface SetupCallConfig {
    name: string;
    parameters?: unknown[];
    runtimeImpact?: RuntimeImpact;
    executionIntent?: 'helper' | 'refresh';
    mapping?: Record<string, MappingValue>;
}

interface SetupConfig {
    calls?: SetupCallConfig[];
    onError?: {
        message?: string;
    };
}

interface SuccessConfig {
    action: 'updateControls' | 'showMessage' | 'softReset' | 'refresh' | string;
    mapping?: Record<string, MappingValue>;
    messageType?: string;
    message?: string;
}

interface ErrorConfig {
    action?: string;
    messageType?: string;
    message?: string;
    mapping?: Record<string, MappingValue>;
}

interface VisibilityCondition {
    controlId: string;
    equals?: unknown;
    notEquals?: unknown;
    in?: unknown[];
}

interface ControlDefinitionBase {
    id: string;
    type: string;
    label?: string;
    disabled?: boolean;
    grow?: boolean;
    width?: string | number | null;
    disableOnDirty?: string[];
    enableOnDirty?: string[];
    /**
     * Optional visibility condition(s). An array is ANDed. `equals` / `notEquals`
     * use the renderer's `_valuesEqual()` comparison, so checkbox booleans
     * (`true`/`false`) and dropdown string values both match.
     */
    visibleWhen?: VisibilityCondition | VisibilityCondition[];
}

interface TextControlDefinition extends ControlDefinitionBase {
    type: 'text';
    defaultValue?: unknown;
    placeholder?: string;
    password?: boolean;
    readonly?: boolean;
    linkifyIpAddress?: boolean;
    validation?: unknown;
}

interface NumberControlDefinition extends ControlDefinitionBase {
    type: 'number';
    defaultValue?: unknown;
    min?: number;
    max?: number;
    step?: number;
}

interface DropdownOption {
    value: unknown;
    label: string;
}

interface DropdownControlDefinition extends ControlDefinitionBase {
    type: 'dropdown';
    defaultValue?: unknown;
    options?: DropdownOption[];
}

interface CheckboxControlDefinition extends ControlDefinitionBase {
    type: 'checkbox';
    defaultValue?: unknown;
}

interface ButtonControlDefinition extends ControlDefinitionBase {
    type: 'button';
    style?: string;
    icon?: string;
    iconOnly?: boolean;
    function?: FunctionConfig;
    validate?: string[];
    clearDirty?: string[];
}

interface ToolbarSeparatorDefinition {
    type: 'separator';
}

interface ToolbarButtonDefinition extends ButtonControlDefinition {
    type: 'button';
}

interface ToolbarDefinition {
    title?: string;
    height?: number;
    layoutMode?: string;
    controls?: Array<
        ToolbarSeparatorDefinition | ToolbarButtonDefinition | Record<string, unknown>
    >;
}

interface RowDefinition {
    type: 'row';
    controls?: Array<ControlDefinition>;
}

interface StackDefinition {
    type: 'stack';
    id?: string;
    direction?: 'horizontal' | 'vertical';
    wrap?: boolean;
    gap?: string | number;
    align?: string;
    controls?: SectionEntry[];
}

type ControlDefinition =
    | TextControlDefinition
    | NumberControlDefinition
    | DropdownControlDefinition
    | CheckboxControlDefinition
    | ButtonControlDefinition
    | (ControlDefinitionBase & Record<string, unknown>);

type SectionEntry = ControlDefinition | RowDefinition | StackDefinition | Record<string, unknown>;

interface SectionDefinition {
    id: string;
    title: string;
    collapsible?: boolean;
    collapsed?: boolean;
    controls?: SectionEntry[];
}

interface CustomViewDefinition {
    title?: string;
    description?: string;
    setup?: SetupConfig;
    toolbar?: ToolbarDefinition;
    sections?: SectionDefinition[];
}

interface RendererOptions {
    deviceConnection: DeviceConnection;
    viewDefinition: CustomViewDefinition;
    i18nService?: I18nService | null;
    viewManager?: ViewManager | null;
    logger?: Logger | null;
    showHeader?: boolean;
}

interface ResponseDialog {
    type?: string;
    title?: string;
    message?: string;
    detail?: string;
    icon?: unknown;
    confirmLabel?: string;
    scrim?: unknown;
}

interface FunctionResult {
    success?: boolean;
    error?: string;
    message?: string;
    dialog?: ResponseDialog;
    dialogs?: ResponseDialog[];
    [key: string]: unknown;
}

type RendererError = Error & { _customViewDialogShown?: boolean };

interface RendererControlGroup {
    item: StackItem;
    controlIds: string[];
}

/**
 * CustomViewRenderer - Renders JSON custom view definitions to DOM.
 *
 * Responsibilities:
 * - Parse and validate JSON custom view definitions
 * - Render sections and controls to DOM
 * - Manage control instances and state
 * - Execute device functions with parameter substitution
 * - Handle validation and success/error responses
 */
export class CustomViewRenderer {
    _deviceConnection: DeviceConnection;
    _viewDefinition: CustomViewDefinition;
    _i18nService: I18nService | null;
    _viewManager: ViewManager | null;
    _logger: Logger | null;
    _controls: Map<string, RuntimeControl>;
    _controlDefinitions: Map<string, ControlDefinitionBase>;
    _controlWrappers: Map<string, HTMLDivElement>;
    _controlItems: Map<string, StackItem>;
    _groupItems: RendererControlGroup[];
    _controlBaseDisabled: Map<string, boolean>;
    _controlBaselineValues: Map<string, unknown>;
    _dirtyControlIds: Set<string>;
    _invalidControlIds: Set<string>;
    _toolbarControlBindings: ToolbarBinding[];
    _setupInitialValues: Map<string, unknown>;
    _rootView: StackView | null;
    _contentStack: StackView | null;
    _topLevelView: CollapsibleView | null;
    _descriptionView: MessageView | null;
    _setupMessageView: MessageView | null;
    _sectionsView: SplitView | null;
    _sectionViews: CollapsibleView[];
    _toolbarView: ToolbarView | null;
    _showHeader: boolean;
    _renderToken: number;

    constructor({
        deviceConnection,
        viewDefinition,
        i18nService,
        viewManager,
        logger,
        showHeader = true,
    }: RendererOptions) {
        if (!deviceConnection) {
            throw new Error('CustomViewRenderer requires deviceConnection');
        }
        if (!viewDefinition) {
            throw new Error('CustomViewRenderer requires viewDefinition');
        }

        this._deviceConnection = deviceConnection;
        this._viewDefinition = viewDefinition;
        this._i18nService = i18nService ?? null;
        this._viewManager = viewManager ?? null;
        this._logger = logger ?? null;
        this._controls = new Map();
        this._controlDefinitions = new Map();
        this._controlWrappers = new Map();
        this._controlItems = new Map();
        this._groupItems = [];
        this._controlBaseDisabled = new Map();
        this._controlBaselineValues = new Map();
        this._dirtyControlIds = new Set();
        this._invalidControlIds = new Set();
        this._toolbarControlBindings = [];
        this._setupInitialValues = new Map();
        this._rootView = null;
        this._contentStack = null;
        this._topLevelView = null;
        this._descriptionView = null;
        this._setupMessageView = null;
        this._sectionsView = null;
        this._sectionViews = [];
        this._toolbarView = null;
        this._showHeader = showHeader;
        this._renderToken = 0;
    }

    render(container: HTMLElement): void {
        this._destroyChildViews();
        this._resetControls();
        this._setupInitialValues.clear();

        const renderToken = this._renderToken;
        const rootView = new StackView({
            title: this._t(this._viewDefinition.title || 'customView.title'),
            fill: true,
            gap: 8,
            padding: 8,
        });
        // This stack must always own a definite height. It hosts the section SplitView,
        // whose panes are flex-basis: 0 and collapse to zero height inside an auto-height parent.
        const contentStack = new StackView({
            title: this._t(this._viewDefinition.title || 'customView.title'),
            fill: true,
            gap: 8,
        });

        this._rootView = rootView;
        this._contentStack = contentStack;

        if (this._viewDefinition.description) {
            this._descriptionView = new MessageView({
                text: this._t(this._viewDefinition.description),
                tone: 'muted',
            });
            contentStack.addView(this._descriptionView);
        }

        this._setupMessageView = new MessageView({
            hidden: true,
            tone: 'info',
            variant: 'panel',
            role: 'status',
        });
        contentStack.addView(this._setupMessageView);

        if (this._showHeader && this._viewDefinition.title) {
            this._topLevelView = new CollapsibleView({
                headerTitle: this._t(this._viewDefinition.title),
                contentView: contentStack,
                sizeToContent: false,
            });
            rootView.addView(this._topLevelView, { grow: true });
        } else {
            rootView.addView(contentStack, { grow: true });
        }

        rootView.attachTo(container);

        const buildSections = (): void => {
            if (renderToken !== this._renderToken) {
                return;
            }

            const toolbarView = this._renderToolbar(this._viewDefinition.toolbar);
            if (toolbarView) {
                contentStack.addView(toolbarView);
                this._bindToolbarControlElements();
            }

            const sectionViews = (this._viewDefinition.sections || []).map((section) =>
                this._renderSection(section)
            );
            if (sectionViews.length > 0) {
                this._sectionsView = new SplitView({
                    title: this._t('customView.sections'),
                    orientation: 'vertical',
                    minPaneSize: 24,
                    gap: 8,
                    views: sectionViews,
                    i18nService: this._i18nService as ViewBaseOptions['i18nService'],
                    logger: this._logger as ViewBaseOptions['logger'],
                });
                contentStack.addView(this._sectionsView, { grow: true });
            }

            this._clearAllDirtyFlags();
            this._applyControlVisibility();
        };

        const setup = this._viewDefinition.setup;
        if (this._hasSetupCalls(setup)) {
            this._setSetupRunningState();
            this._runSetupInitialization(setup as SetupConfig)
                .then(() => {
                    if (renderToken !== this._renderToken) {
                        return;
                    }
                    this._setSetupReadyState();
                    buildSections();
                })
                .catch((error: unknown) => {
                    if (renderToken !== this._renderToken) {
                        return;
                    }
                    this._logger?.error?.(
                        '[CustomViewRenderer] Setup initialization failed',
                        error
                    );
                    this._setSetupErrorState(setup, error as Error);
                });
            return;
        }

        this._setSetupReadyState();
        buildSections();
    }

    /** Destroy the view tree owned by the previous render and invalidate pending setup. */
    _destroyChildViews(): void {
        this._renderToken += 1;

        const rootView = this._rootView;
        this._rootView = null;
        this._contentStack = null;
        this._topLevelView = null;
        this._descriptionView = null;
        this._setupMessageView = null;
        this._sectionsView = null;
        this._sectionViews = [];

        if (rootView?.isAttached) {
            rootView.detach();
        }
    }

    /** Tear down toolbar and section views, e.g. after a failed setup run. */
    _destroySections(): void {
        const sectionsView = this._sectionsView;
        this._sectionsView = null;
        this._sectionViews = [];

        if (sectionsView?.isAttached) {
            sectionsView.detach();
        }

        const toolbarView = this._toolbarView;
        this._toolbarView = null;
        if (toolbarView?.isAttached) {
            toolbarView.detach();
        }
    }

    _resetControls(): void {
        for (const control of this._controls.values()) {
            if (control.destroy && typeof control.destroy === 'function') {
                control.destroy();
            }
        }
        this._controls.clear();
        this._controlDefinitions.clear();
        this._controlWrappers.clear();
        this._controlItems.clear();
        this._groupItems = [];
        this._controlBaseDisabled.clear();
        this._controlBaselineValues.clear();
        this._dirtyControlIds.clear();
        this._invalidControlIds.clear();
        this._toolbarControlBindings = [];

        if (this._toolbarView?.isAttached) {
            this._toolbarView.detach();
        }
        this._toolbarView = null;
    }

    _hasSetupCalls(setup?: SetupConfig): boolean {
        return !!(setup && Array.isArray(setup.calls) && setup.calls.length > 0);
    }

    async _runSetupInitialization(setup: SetupConfig): Promise<void> {
        for (const callConfig of setup.calls || []) {
            if (!callConfig || !callConfig.name) {
                throw new Error('Invalid setup call definition');
            }

            const executionIntent = callConfig.executionIntent || 'helper';
            const hasExplicitRuntimeImpact = Object.prototype.hasOwnProperty.call(
                callConfig,
                'runtimeImpact'
            );
            if (executionIntent === 'refresh' && !hasExplicitRuntimeImpact) {
                throw new Error(
                    `Setup call ${callConfig.name} uses refresh intent and must declare runtimeImpact`
                );
            }

            const parameters = this._extractParameters(callConfig.parameters);
            const result = await this._callDeviceFunction(
                callConfig.name,
                parameters,
                callConfig.runtimeImpact || 'none',
                executionIntent
            );
            const handledErrorDialog = await this._handleResponseDialogs(result);
            const objectResult = this._asFunctionResult(result);

            if (
                objectResult &&
                Object.prototype.hasOwnProperty.call(objectResult, 'success') &&
                objectResult.success === false
            ) {
                const detail = objectResult.error || objectResult.message || 'Setup failed';
                const error = new Error(detail) as RendererError;
                error._customViewDialogShown = handledErrorDialog;
                throw error;
            }

            this._applySetupMapping(callConfig, objectResult);
        }
    }

    _applySetupMapping(callConfig: SetupCallConfig, result: FunctionResult | null): void {
        if (!callConfig?.mapping || !result || typeof result !== 'object') {
            return;
        }

        for (const [resultKey, mappingValue] of Object.entries(callConfig.mapping)) {
            if (result[resultKey] === undefined) {
                continue;
            }
            const { controlId, translate } = this._resolveMappingValue(mappingValue);
            this._setupInitialValues.set(controlId, this._translateMappedValue(translate, result[resultKey]));
        }
    }

    _setSetupRunningState(): void {
        if (this._setupMessageView) {
            this._setupMessageView.setTone('info');
            this._setupMessageView.setVariant('panel');
            this._setupMessageView.setRole('status');
            this._setupMessageView.setText(this._t('customRuntimeView.setup.loading'));
            this._setupMessageView.setHidden(false);
        }
    }

    _setSetupReadyState(): void {
        if (this._setupMessageView) {
            this._setupMessageView.setText('');
            this._setupMessageView.setHidden(true);
        }
    }

    _setSetupErrorState(setup: SetupConfig | undefined, error: Error): void {
        const messageKey = setup?.onError?.message || 'customRuntimeView.setup.error';
        const translated = this._t(messageKey, { error: error?.message || '' });
        const fallbackPrefix = this._t('customRuntimeView.setup.error');
        const detail = error?.message ? `: ${error.message}` : '';
        const message = translated === messageKey ? `${fallbackPrefix}${detail}` : translated;

        this._destroySections();

        if (this._setupMessageView) {
            this._setupMessageView.setTone('error');
            this._setupMessageView.setVariant('panel');
            this._setupMessageView.setRole('alert');
            this._setupMessageView.setText(message);
            this._setupMessageView.setHidden(false);
        }
    }

    _renderSection(section: SectionDefinition): CollapsibleView {
        const body = new StackView({
            title: this._t(section.title),
            orientation: 'vertical',
            gap: 8,
            padding: 8,
            striped: true,
        });
        this._renderSectionEntries(section.controls || [], body);

        const sectionView = new CollapsibleView({
            id: section.id,
            title: this._t(section.title),
            headerTitle: this._t(section.title),
            collapsible: section.collapsible === true,
            collapsed: section.collapsible === true ? (section.collapsed ?? false) : false,
            sizeToContent: true,
            contentView: body,
            i18nService: this._i18nService as ViewBaseOptions['i18nService'],
            logger: this._logger as ViewBaseOptions['logger'],
        });

        this._sectionViews.push(sectionView);
        return sectionView;
    }

    _renderSectionEntries(
        entries: SectionEntry[],
        stack: StackView,
        flow: 'column' | 'row' = 'column'
    ): void {
        for (const entry of entries) {
            if (
                (entry as StackDefinition)?.type === 'stack' &&
                Array.isArray((entry as StackDefinition).controls)
            ) {
                const childStack = this._renderStack(entry as StackDefinition);
                if (childStack) {
                    const item = stack.addView(childStack);
                    this._registerGroupItem(
                        item,
                        this._collectEntryControlIds((entry as StackDefinition).controls ?? [])
                    );
                }
                continue;
            }

            if (
                (entry as RowDefinition)?.type === 'row' &&
                Array.isArray((entry as RowDefinition).controls)
            ) {
                const row = this._renderRow(entry as RowDefinition);
                if (row) {
                    const item = stack.addView(row);
                    this._registerGroupItem(
                        item,
                        this._collectEntryControlIds((entry as RowDefinition).controls ?? [])
                    );
                }
                continue;
            }

            const controlEntry = entry as ControlDefinition;
            const controlWrapper = this._renderControl(controlEntry);
            if (controlWrapper) {
                const item = stack.addElement(controlWrapper, {
                    itemId: controlEntry.id,
                    grow: flow === 'row' ? !!controlEntry.grow : false,
                    width: flow === 'row' ? controlEntry.width : null,
                });
                this._controlItems.set(controlEntry.id, item);
            }
        }
    }

    _registerGroupItem(item: StackItem, controlIds: string[]): void {
        if (controlIds.length > 0) {
            this._groupItems.push({ item, controlIds });
        }
    }

    _renderRow(rowDef: RowDefinition): StackView | null {
        const row = new StackView({
            orientation: 'horizontal',
            align: 'flex-end',
            gap: 8,
        });
        this._renderSectionEntries(rowDef.controls || [], row, 'row');
        return row.items.length > 0 ? row : null;
    }

    _renderStack(stackDef: StackDefinition): StackView | null {
        const direction = stackDef.direction === 'vertical' ? 'vertical' : 'horizontal';
        const stack = new StackView({
            id: stackDef.id ?? null,
            orientation: direction,
            gap: stackDef.gap ?? 8,
            wrap: direction === 'horizontal' ? stackDef.wrap !== false : false,
            align:
                typeof stackDef.align === 'string'
                    ? (stackDef.align as StackViewAlignment)
                    : direction === 'horizontal'
                      ? 'flex-start'
                      : 'stretch',
        });
        this._renderSectionEntries(
            stackDef.controls ?? [],
            stack,
            direction === 'vertical' ? 'column' : 'row'
        );
        return stack.items.length > 0 ? stack : null;
    }

    _collectEntryControlIds(entries: SectionEntry[]): string[] {
        const ids: string[] = [];

        for (const entry of entries) {
            const def = entry as ControlDefinitionBase & {
                type?: string;
                controls?: SectionEntry[];
            };
            if (!def || typeof def !== 'object') {
                continue;
            }

            if (def.type === 'row' || def.type === 'stack') {
                if (Array.isArray(def.controls)) {
                    ids.push(...this._collectEntryControlIds(def.controls));
                }
            } else if (typeof def.id === 'string' && def.id) {
                ids.push(def.id);
            }
        }

        return ids;
    }

    _renderControl(controlDef?: ControlDefinitionBase): HTMLDivElement | null {
        if (!controlDef || typeof controlDef !== 'object' || !controlDef.id) {
            return null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = `control-wrapper control-wrapper--${controlDef.type}`;
        wrapper.dataset.controlId = controlDef.id;
        this._controlWrappers.set(controlDef.id, wrapper);

        let control: RuntimeControl | null = null;

        switch (controlDef.type) {
            case 'text':
                control = this._createTextControl(controlDef as TextControlDefinition);
                break;
            case 'number':
                control = this._createNumberControl(controlDef as NumberControlDefinition);
                break;
            case 'dropdown':
                control = this._createDropdownControl(controlDef as DropdownControlDefinition);
                break;
            case 'checkbox':
                control = this._createCheckboxControl(controlDef as CheckboxControlDefinition);
                break;
            case 'button':
                control = this._createButtonControl(controlDef as ButtonControlDefinition);
                break;
            default:
                this._logger?.warn?.(
                    `[CustomViewRenderer] Unknown control type: ${controlDef.type}`
                );
                return null;
        }

        if (control) {
            this._registerControl(controlDef, control);
            control.render?.(wrapper);
        }

        return wrapper;
    }

    _createTextControl(def: TextControlDefinition): RuntimeControl {
        const defaultValue = this._getInitialControlValue(def.id, def.defaultValue ?? '');
        return new TextControl({
            label: this._t(def.label || ''),
            placeholder: def.placeholder ? this._t(def.placeholder) : undefined,
            defaultValue: typeof defaultValue === 'string' ? this._t(defaultValue) : defaultValue,
            password: def.password || false,
            disabled: def.disabled || false,
            readonly: def.readonly || false,
            linkifyIpAddress: def.linkifyIpAddress || false,
            validation: this._normalizeTextValidation(def.validation),
        }) as unknown as RuntimeControl;
    }

    _normalizeTextValidation(value: unknown): TextControlValidation | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const source = value as Record<string, unknown>;
        const validation: TextControlValidation = {};

        if (typeof source.required === 'boolean') {
            validation.required = source.required;
        }
        if (typeof source.allowEmpty === 'boolean') {
            validation.allowEmpty = source.allowEmpty;
        }
        if (typeof source.pattern === 'string') {
            validation.pattern = source.pattern;
        }
        if (typeof source.minLength === 'number' && Number.isFinite(source.minLength)) {
            validation.minLength = source.minLength;
        }
        if (typeof source.maxLength === 'number' && Number.isFinite(source.maxLength)) {
            validation.maxLength = source.maxLength;
        }

        return Object.keys(validation).length > 0 ? validation : undefined;
    }

    _createNumberControl(def: NumberControlDefinition): RuntimeControl {
        const defaultValue = this._getInitialControlValue(def.id, def.defaultValue ?? 0);
        return new NumberControl({
            label: this._t(def.label || ''),
            defaultValue,
            min: def.min,
            max: def.max,
            step: def.step ?? 1,
            disabled: def.disabled || false,
        }) as unknown as RuntimeControl;
    }

    _createDropdownControl(def: DropdownControlDefinition): RuntimeControl {
        const options = (def.options || []).map((opt) => ({
            value: opt.value,
            label: this._t(opt.label),
        }));

        return new DropdownControl({
            label: this._t(def.label || ''),
            options,
            defaultValue: this._getInitialControlValue(def.id, def.defaultValue),
            disabled: def.disabled || false,
        }) as unknown as RuntimeControl;
    }

    _createCheckboxControl(def: CheckboxControlDefinition): RuntimeControl {
        return new CheckboxControl({
            label: this._t(def.label || ''),
            defaultValue: this._getInitialControlValue(def.id, def.defaultValue ?? false),
            disabled: def.disabled || false,
        }) as unknown as RuntimeControl;
    }

    _getInitialControlValue(controlId: string, fallbackValue: unknown): unknown {
        if (this._setupInitialValues.has(controlId)) {
            return this._setupInitialValues.get(controlId);
        }
        return fallbackValue;
    }

    _createButtonControl(def: ButtonControlDefinition): RuntimeControl {
        const button = new ButtonControl({
            label: this._t(def.label || ''),
            style: def.style || 'secondary',
            disabled: def.disabled || false,
            icon: this._resolveIconUrl(def.icon),
            iconOnly: !!def.iconOnly,
        }) as unknown as RuntimeControl;

        button.onClick?.(() => this._handleButtonClick(def, button));

        return button;
    }

    _registerControl(controlDef: ControlDefinitionBase, control: RuntimeControl): void {
        this._controls.set(controlDef.id, control);
        this._controlDefinitions.set(controlDef.id, controlDef);
        this._controlBaseDisabled.set(controlDef.id, !!controlDef.disabled);

        if (control?.onChange && typeof control.onChange === 'function') {
            control.onChange(() => this._onControlValueChanged(controlDef.id));
        }
    }

    _renderToolbar(toolbarDefinition: ToolbarDefinition | undefined): ToolbarView | null {
        this._toolbarControlBindings = [];

        if (!toolbarDefinition || !Array.isArray(toolbarDefinition.controls)) {
            return null;
        }

        const toolbarView = new ToolbarView({
            title: this._t(toolbarDefinition.title || 'customView.toolbar.title'),
            icon: null,
            height: toolbarDefinition.height || 36,
            layoutMode: toolbarDefinition.layoutMode || 'scroll',
            i18nService: this._i18nService as ViewBaseOptions['i18nService'],
            logger: this._logger as ViewBaseOptions['logger'],
        });
        this._toolbarView = toolbarView;

        for (const item of toolbarDefinition.controls) {
            if ((item as ToolbarSeparatorDefinition)?.type === 'separator') {
                toolbarView.addSeparator();
                continue;
            }

            const buttonItem = item as ToolbarButtonDefinition;
            if (buttonItem?.type !== 'button' || !buttonItem.id) {
                continue;
            }

            const toolbarControl = toolbarView.addButton({
                icon: this._resolveIconUrl(buttonItem.icon) || '',
                label: this._t(buttonItem.label || ''),
                onClick: () => this._handleButtonClick(buttonItem),
            });

            const control: RuntimeControl = {
                _disabled: !!buttonItem.disabled,
                _executing: false,
                element: null,
                getValue() {
                    return undefined;
                },
                setValue() {
                    // No-op for toolbar buttons
                },
                setDisabled: (disabled: boolean) => {
                    control._disabled = !!disabled;
                    this._setControlElementDisabled(control.element, control._disabled);
                },
            };

            this._registerControl(buttonItem, control);
            this._toolbarControlBindings.push({ controlId: buttonItem.id, toolbarControl });
        }

        return toolbarView;
    }

    /** Bind registered toolbar button controls to their rendered elements after attach. */
    _bindToolbarControlElements(): void {
        for (const binding of this._toolbarControlBindings) {
            const control = this._controls.get(binding.controlId);
            if (!control) {
                continue;
            }
            control.element = binding.toolbarControl.element;
            this._setControlElementDisabled(control.element, !!control._disabled);
        }
    }

    async _handleButtonClick(
        buttonDef: ButtonControlDefinition,
        buttonControl: RuntimeControl | null = null
    ): Promise<void> {
        const didSucceed = await this._executeFunction(buttonDef, buttonControl);

        if (didSucceed && Array.isArray(buttonDef.clearDirty) && buttonDef.clearDirty.length > 0) {
            this._clearDirtyFlags(buttonDef.clearDirty);
        }
    }

    async _executeFunction(
        buttonDef: ButtonControlDefinition,
        buttonControl: RuntimeControl | null = null
    ): Promise<boolean | undefined> {
        const funcConfig = buttonDef.function;
        const buttonElement = buttonControl?.element;

        if (!funcConfig) {
            return true;
        }

        if (buttonControl && buttonControl._executing) {
            return;
        }
        if (buttonControl) {
            buttonControl._executing = true;
        }

        const originalCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';

        const wasDisabled = this._getControlElementDisabled(buttonControl?.element);
        if (buttonControl?.element) {
            this._setControlElementDisabled(buttonControl.element, true);
        }

        try {
            if (buttonDef.validate && buttonDef.validate.length > 0) {
                const failingControlIds = this._collectValidationFailures(buttonDef.validate);
                if (failingControlIds.length > 0) {
                    this._setInvalidControls(failingControlIds);
                    await this._reportValidationFailure(buttonDef, failingControlIds);
                    return false;
                }
                this._clearInvalidControls();
            }

            const parameters = this._extractParameters(funcConfig.parameters);
            const executionIntent = funcConfig.executionIntent || 'helper';
            const hasExplicitRuntimeImpact = Object.prototype.hasOwnProperty.call(
                funcConfig,
                'runtimeImpact'
            );
            if (executionIntent === 'refresh' && !hasExplicitRuntimeImpact) {
                throw new Error(
                    `Function ${funcConfig.name} uses refresh intent and must declare runtimeImpact`
                );
            }
            const result = await this._callDeviceFunction(
                funcConfig.name,
                parameters,
                funcConfig.runtimeImpact || 'none',
                executionIntent
            );
            const handledErrorDialog = await this._handleResponseDialogs(result);
            const objectResult = this._asFunctionResult(result);

            if (
                objectResult &&
                Object.prototype.hasOwnProperty.call(objectResult, 'success') &&
                objectResult.success === false
            ) {
                const detail = objectResult.error || objectResult.message || 'Operation failed';
                const error = new Error(detail) as RendererError;
                error._customViewDialogShown = handledErrorDialog;
                throw error;
            }

            if (buttonElement) {
                buttonElement.classList.add('custom-view-button--success');
                setTimeout(() => {
                    buttonElement.classList.remove('custom-view-button--success');
                }, 1000);
            }

            if (funcConfig.onSuccess) {
                await this._handleSuccess(funcConfig.onSuccess, objectResult);
            }

            return true;
        } catch (error: unknown) {
            this._logger?.error?.('[CustomViewRenderer] Function execution failed', error);

            const runtimeError = error as RendererError;

            if (this._viewManager && !runtimeError?._customViewDialogShown) {
                await this._viewManager.showError({
                    title: this._t('customView.executionError'),
                    message: `${this._t('customView.functionFailed')}: ${funcConfig.name}`,
                    detail: runtimeError.message,
                });
            } else {
                this._showMessage('error', runtimeError.message);
            }

            if (funcConfig.onError) {
                this._handleError(funcConfig.onError, runtimeError);
            }

            return false;
        } finally {
            document.body.style.cursor = originalCursor;

            if (buttonControl?.element && !wasDisabled) {
                this._setControlElementDisabled(buttonControl.element, false);
            }

            if (buttonControl) {
                buttonControl._executing = false;
            }
        }
    }

    _extractParameters(parameters: unknown[] | undefined): unknown[] {
        if (!parameters || !Array.isArray(parameters)) {
            return [];
        }

        return parameters.map((param) => {
            if (typeof param === 'string' && param.startsWith('${') && param.endsWith('}')) {
                const controlId = param.slice(2, -1);
                const control = this._controls.get(controlId);

                if (!control) {
                    throw new Error(`Control not found: ${controlId}`);
                }

                return control.getValue();
            }

            return param;
        });
    }

    async _callDeviceFunction(
        functionName: string,
        parameters: unknown[],
        runtimeImpact: RuntimeImpact = 'none',
        executionIntent: 'helper' | 'refresh' = 'helper'
    ): Promise<FunctionResult> {
        const tracker = new ProgressTracker(`custom-function-${functionName}`);
        tracker.start(`Executing ${functionName}...`);

        try {
            let result = '';
            if (executionIntent === 'refresh') {
                if (typeof this._deviceConnection.executeCustomViewRefreshAction !== 'function') {
                    throw new Error(
                        'CustomViewRenderer requires deviceConnection.executeCustomViewRefreshAction; ' +
                            'direct executeCode fallback is not supported'
                    );
                }
                result = await this._deviceConnection.executeCustomViewRefreshAction(
                    functionName,
                    parameters,
                    { runtimeImpact }
                );
            } else {
                if (typeof this._deviceConnection.executeCustomViewAction !== 'function') {
                    throw new Error(
                        'CustomViewRenderer requires deviceConnection.executeCustomViewAction; ' +
                            'direct executeCode fallback is not supported'
                    );
                }

                result = await this._deviceConnection.executeCustomViewAction(
                    functionName,
                    parameters,
                    {
                        runtimeImpact,
                    }
                );
            }

            tracker.complete(`${functionName} complete`);

            if (!result || result.trim().length === 0) {
                throw new Error(
                    `Function ${functionName} returned an empty response; expected JSON object response`
                );
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(result);
            } catch {
                throw new Error(
                    `Function ${functionName} returned non-JSON output; expected JSON object response`
                );
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error(
                    `Function ${functionName} returned invalid JSON payload; expected object response`
                );
            }

            const objectResult = { ...(parsed as FunctionResult) };
            if (!Object.prototype.hasOwnProperty.call(objectResult, 'success')) {
                const errorValue = objectResult.error;
                const hasError =
                    typeof errorValue === 'string' ? errorValue.trim().length > 0 : !!errorValue;
                objectResult.success = !hasError;
            } else if (typeof objectResult.success !== 'boolean') {
                throw new Error(
                    `Function ${functionName} returned invalid success field; expected boolean`
                );
            }

            return objectResult;
        } catch (error) {
            tracker.error(`${functionName} failed`, error as Error);
            throw error;
        }
    }

    _collectValidationFailures(controlIds: string[]): string[] {
        const failures: string[] = [];

        for (const controlId of controlIds) {
            const control = this._controls.get(controlId);
            if (!control) {
                this._logger?.warn?.(
                    `[CustomViewRenderer] Control not found for validation: ${controlId}`
                );
                failures.push(controlId);
                continue;
            }

            const definition = this._controlDefinitions.get(controlId);
            if (definition && !this._isControlVisible(controlId)) {
                // Controls hidden through `visibleWhen` never block a button.
                continue;
            }

            if (control.validate && typeof control.validate === 'function') {
                if (!control.validate()) {
                    failures.push(controlId);
                }
            }
        }

        return failures;
    }

    _validateControls(controlIds: string[]): boolean {
        return this._collectValidationFailures(controlIds).length === 0;
    }

    _setInvalidControls(controlIds: string[]): void {
        this._clearInvalidControls();

        for (const controlId of controlIds) {
            const wrapper = this._controlWrappers.get(controlId);
            if (!wrapper) {
                continue;
            }
            this._invalidControlIds.add(controlId);
            this._setControlInvalid(wrapper, true);
        }
    }

    _clearInvalidControl(controlId: string): void {
        if (!this._invalidControlIds.delete(controlId)) {
            return;
        }

        const wrapper = this._controlWrappers.get(controlId);
        if (wrapper) {
            this._setControlInvalid(wrapper, false);
        }
    }

    _clearInvalidControls(): void {
        for (const controlId of this._invalidControlIds) {
            const wrapper = this._controlWrappers.get(controlId);
            if (wrapper) {
                this._setControlInvalid(wrapper, false);
            }
        }
        this._invalidControlIds.clear();
    }

    /**
     * Toggle the invalid marker on the rendered control root.
     * @param {HTMLDivElement} wrapper Outer control wrapper.
     * @param {boolean} invalid New invalid state.
     */
    _setControlInvalid(wrapper: HTMLDivElement, invalid: boolean): void {
        wrapper.querySelector('.custom-control')?.classList.toggle('is-invalid', invalid);
    }

    /**
     * Build the user-facing message for a blocked execution.
     *
     * The generic locale text is extended with the translated labels of the
     * offending controls so the user knows which field to fix.
     */
    _validationFailureMessage(failingControlIds: string[]): string {
        const base = this._t('customView.validationFailed');
        const labels: string[] = [];

        for (const controlId of failingControlIds) {
            const labelKey = this._controlDefinitions.get(controlId)?.label;
            const label = labelKey ? this._t(labelKey) : controlId;
            if (label && labels.indexOf(label) === -1) {
                labels.push(label);
            }
        }

        return labels.length > 0 ? `${base}: ${labels.join(', ')}` : base;
    }

    /**
     * Surface a blocked execution to the user.
     *
     * Validation failures used to be logged to the console only, which made a
     * blocked upload look like a silent no-op. The message is routed through the
     * button's `onError` handler when it declares one (the general runtime
     * upload writes it into the status control) and falls back to an error
     * dialog, so a refused function call is always visible.
     */
    async _reportValidationFailure(
        buttonDef: ButtonControlDefinition,
        failingControlIds: string[]
    ): Promise<void> {
        const message = this._validationFailureMessage(failingControlIds);
        this._showMessage('error', `[customView] ${message} (${failingControlIds.join(', ')})`);

        const onError = buttonDef.function?.onError;
        if (onError) {
            this._handleError(onError, new Error(message));
            return;
        }

        if (this._viewManager) {
            await this._viewManager.showError({
                title: this._t('customView.executionError'),
                message,
            });
        }
    }

    async _handleSuccess(config: SuccessConfig, result: FunctionResult | null): Promise<void> {
        switch (config.action) {
            case 'updateControls':
                if (config.mapping && result && typeof result === 'object') {
                    for (const [key, mappingValue] of Object.entries(config.mapping)) {
                        const { controlId, translate } = this._resolveMappingValue(mappingValue);
                        const control = this._controls.get(controlId);
                        if (control && result[key] !== undefined) {
                            control.setValue(this._translateMappedValue(translate, result[key]));
                            this._updateControlDirtyState(controlId);
                        }
                    }
                }
                this._refreshDirtyDependentControlStates();
                break;

            case 'showMessage':
                this._showMessage(
                    config.messageType || 'success',
                    this._t(config.message || 'customView.operationSuccess')
                );
                break;

            case 'softReset':
                this._showMessage(
                    config.messageType || 'success',
                    this._t(config.message || 'customView.operationSuccess')
                );
                if (!this._deviceConnection?.softReset) {
                    throw new Error('Device connection does not support soft reset');
                }
                await this._deviceConnection.softReset();
                if (typeof this._deviceConnection?.exitRawRepl === 'function') {
                    await new Promise((resolve) => {
                        setTimeout(resolve, 2000);
                    });
                    try {
                        await this._deviceConnection.exitRawRepl();
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : String(error);
                        this._logger?.warn?.(
                            `[CustomViewRenderer] Failed to exit raw REPL after soft reset: ${message}`
                        );
                    }
                }
                break;

            case 'refresh':
                break;

            default:
                this._logger?.warn?.(
                    `[CustomViewRenderer] Unknown success action: ${config.action}`
                );
        }
    }

    _handleError(config: ErrorConfig, error: Error): void {
        if (config.action === 'updateControls' && config.mapping) {
            for (const mappingValue of Object.values(config.mapping)) {
                const { controlId } = this._resolveMappingValue(mappingValue);
                const control = this._controls.get(controlId);
                if (control) {
                    control.setValue(error.message);
                }
            }
            return;
        }

        if (config.action === 'showMessage') {
            this._showMessage(
                config.messageType || 'error',
                this._t(config.message || 'customView.operationError', {
                    error: error.message,
                })
            );
        }
    }

    /**
     * Show the dialog directives of a device function result, in order.
     *
     * Accepts the single `dialog` object and the `dialogs` array. `error` opens the error
     * dialog and marks the call as already reported, so the caller adds no second modal;
     * `warning` opens the info dialog with a warning icon and title, because a
     * saved-but-disabled setting needs an acknowledgement, not a failure report.
     * @param {unknown} result Parsed device function result.
     * @returns {Promise<boolean>} True when an error dialog was shown.
     * @private
     */
    async _handleResponseDialogs(result: unknown): Promise<boolean> {
        const objectResult = this._asFunctionResult(result);
        if (!objectResult) {
            return false;
        }

        const directives: ResponseDialog[] = [];

        if (objectResult.dialog && typeof objectResult.dialog === 'object') {
            directives.push(objectResult.dialog);
        }

        if (Array.isArray(objectResult.dialogs)) {
            directives.push(
                ...objectResult.dialogs.filter((dialog) => dialog && typeof dialog === 'object')
            );
        }

        if (directives.length === 0) {
            return false;
        }

        let handledErrorDialog = false;
        for (const dialog of directives) {
            const type = (dialog.type || 'info').toLowerCase();
            const title = this._t(dialog.title || this._defaultDialogTitle(type));
            const message = this._t(dialog.message || '');
            const detail = dialog.detail ? this._t(dialog.detail) : undefined;
            const icon = dialog.icon ?? (type === 'warning' ? '⚠️' : undefined);
            const confirmLabel = dialog.confirmLabel ? this._t(dialog.confirmLabel) : undefined;
            const scrim = dialog.scrim;

            if (this._viewManager) {
                if (type === 'error') {
                    handledErrorDialog = true;
                    await this._viewManager.showError({
                        title,
                        message,
                        detail,
                        icon,
                        confirmLabel,
                        scrim,
                    });
                } else {
                    // A warning is informational: it needs an acknowledgement, not an
                    // error report, so it shares the info dialog with a warning icon.
                    await this._viewManager.showInfo({
                        title,
                        message,
                        icon,
                        confirmLabel,
                        scrim,
                    });
                }
                continue;
            }

            const inlineMessage = detail ? `${message}\n${detail}` : message;
            this._showMessage(type, inlineMessage);
            if (type === 'error') {
                handledErrorDialog = true;
            }
        }

        return handledErrorDialog;
    }

    /**
     * Headline a dialog directive gets when it does not carry a `title` i18n key.
     * @param {string} type Lower-cased dialog type (`error`, `warning`, else info).
     * @returns {string} Default title, resolved through the i18n service by the caller.
     * @private
     */
    _defaultDialogTitle(type: string): string {
        if (type === 'error') {
            return 'Error';
        }
        if (type === 'warning') {
            return 'Warning';
        }
        return 'Information';
    }

    _showMessage(type: string, message: string): void {
        if (type === 'error') {
            console.error(`[${type.toUpperCase()}] ${message}`);
            return;
        }
        console.warn(`[${type.toUpperCase()}] ${message}`);
    }

    _resolveMappingValue(value: MappingValue): { controlId: string; translate: boolean } {
        if (typeof value === 'string') {
            return { controlId: value, translate: false };
        }
        return {
            controlId: typeof value?.controlId === 'string' ? value.controlId : '',
            translate: value?.translate === true,
        };
    }

    _translateMappedValue(translate: boolean, value: unknown): unknown {
        if (translate && typeof value === 'string') {
            return this._t(value);
        }
        return value;
    }

    getControlValue(controlId: string): unknown {
        const control = this._controls.get(controlId);
        return control ? control.getValue() : undefined;
    }

    setControlValue(controlId: string, value: unknown): void {
        const control = this._controls.get(controlId);
        if (control) {
            control.setValue(value);
            this._updateControlDirtyState(controlId);
            this._refreshDirtyDependentControlStates();
        }
    }

    _onControlValueChanged(controlId: string): void {
        this._updateControlDirtyState(controlId);
        this._refreshDirtyDependentControlStates();
    }

    _updateControlDirtyState(controlId: string): void {
        const control = this._controls.get(controlId);
        if (!control) {
            return;
        }

        const definition = this._controlDefinitions.get(controlId);
        if (definition?.type === 'button') {
            return;
        }

        // A changed value invalidates the previous validation verdict.
        this._clearInvalidControl(controlId);

        if (!this._controlBaselineValues.has(controlId)) {
            this._controlBaselineValues.set(controlId, control.getValue());
        }

        const baselineValue = this._controlBaselineValues.get(controlId);
        const currentValue = control.getValue();

        if (this._valuesEqual(currentValue, baselineValue)) {
            this._dirtyControlIds.delete(controlId);
        } else {
            this._dirtyControlIds.add(controlId);
        }
    }

    _clearAllDirtyFlags(): void {
        this._dirtyControlIds.clear();
        this._controlBaselineValues.clear();

        for (const [controlId, control] of this._controls.entries()) {
            const definition = this._controlDefinitions.get(controlId);
            if (definition?.type === 'button') {
                continue;
            }
            this._controlBaselineValues.set(controlId, control.getValue());
        }

        this._refreshDirtyDependentControlStates();
    }

    _clearDirtyFlags(controlIds: string[]): void {
        for (const controlId of controlIds) {
            const control = this._controls.get(controlId);
            const definition = this._controlDefinitions.get(controlId);
            if (!control || definition?.type === 'button') {
                continue;
            }
            this._controlBaselineValues.set(controlId, control.getValue());
            this._dirtyControlIds.delete(controlId);
        }

        this._refreshDirtyDependentControlStates();
    }

    _isControlVisible(controlId: string): boolean {
        const raw = this._controlDefinitions.get(controlId)?.visibleWhen;
        const conditions = Array.isArray(raw) ? raw : raw ? [raw] : [];

        for (const condition of conditions) {
            if (!condition || typeof condition.controlId !== 'string') {
                continue;
            }

            const driver = this._controls.get(condition.controlId);
            if (!driver) {
                // Unknown reference: treat the condition as satisfied.
                continue;
            }

            const value = driver.getValue();
            if ('equals' in condition && !this._valuesEqual(value, condition.equals)) {
                return false;
            }
            if ('notEquals' in condition && this._valuesEqual(value, condition.notEquals)) {
                return false;
            }
            if (Array.isArray(condition.in)) {
                if (!condition.in.some((candidate) => this._valuesEqual(value, candidate))) {
                    return false;
                }
            }
        }

        return true;
    }

    _applyControlVisibility(): void {
        for (const [controlId, item] of this._controlItems.entries()) {
            item.setHidden(!this._isControlVisible(controlId));
        }

        for (const group of this._groupItems) {
            const allHidden =
                group.controlIds.length > 0 &&
                group.controlIds.every((controlId) => !this._isControlVisible(controlId));
            group.item.setHidden(allHidden);
        }
    }

    _refreshDirtyDependentControlStates(): void {
        for (const [controlId, control] of this._controls.entries()) {
            const definition = this._controlDefinitions.get(controlId);
            const baseDisabled = this._controlBaseDisabled.get(controlId) || false;

            let disabled = baseDisabled;

            const disableOnDirty = Array.isArray(definition?.disableOnDirty)
                ? definition.disableOnDirty
                : [];
            const enableOnDirty = Array.isArray(definition?.enableOnDirty)
                ? definition.enableOnDirty
                : [];

            const hasDirtyInDisableList = disableOnDirty.some((id) =>
                this._dirtyControlIds.has(id)
            );
            if (hasDirtyInDisableList) {
                disabled = true;
            } else if (enableOnDirty.length > 0) {
                const hasDirtyInEnableList = enableOnDirty.some((id) =>
                    this._dirtyControlIds.has(id)
                );
                disabled = !hasDirtyInEnableList;
            }

            if (control?.setDisabled && typeof control.setDisabled === 'function') {
                control.setDisabled(disabled);
            }
        }

        this._applyControlVisibility();
    }

    _valuesEqual(a: unknown, b: unknown): boolean {
        if (a === b) {
            return true;
        }

        if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
            try {
                return JSON.stringify(a) === JSON.stringify(b);
            } catch {
                return false;
            }
        }

        return false;
    }

    _normalizeControlWidth(width: string | number | null | undefined): string {
        if (typeof width === 'number' && Number.isFinite(width)) {
            return `${Math.max(0, width)}px`;
        }

        if (typeof width === 'string') {
            const normalized = width.trim();
            if (/^\d+(?:\.\d+)?$/.test(normalized)) {
                return `${normalized}px`;
            }
            return normalized;
        }

        return 'auto';
    }

    _getControlElementDisabled(element: HTMLElement | null | undefined): boolean {
        return !!(element && element instanceof HTMLButtonElement && element.disabled);
    }

    _setControlElementDisabled(element: HTMLElement | null | undefined, disabled: boolean): void {
        if (element && element instanceof HTMLButtonElement) {
            element.disabled = disabled;
        }
    }

    _resolveIconUrl(iconName: unknown): string | null {
        if (typeof iconName !== 'string' || !iconName.trim()) {
            return null;
        }

        const normalized = iconName.trim();
        if (IconProvider.has(normalized)) {
            return IconProvider.get(normalized);
        }

        return normalized;
    }

    _t(key: string, variables: Record<string, unknown> = {}): string {
        if (!this._i18nService) {
            return key;
        }
        return this._i18nService.t(key, variables);
    }

    _asFunctionResult(value: unknown): FunctionResult | null {
        if (!value || typeof value !== 'object') {
            return null;
        }
        return value as FunctionResult;
    }

    destroy(): void {
        this._destroyChildViews();
        this._resetControls();
        this._setupInitialValues.clear();
    }
}
