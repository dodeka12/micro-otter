// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file CustomRuntimeView - ViewBase wrapper for custom runtime settings UI
 *
 * Wraps CustomViewRenderer in a proper ViewBase lifecycle for use in
 * SplitView, TabbedView, and other view containers.
 *
 * @module views/custom-runtime-view
 */

import { ViewBase } from './view-base.js';
import * as customRuntimeRendererModule from './custom-runtime-renderer.js';
import { StackView } from './stack-view.js';
import { MessageView } from './message-view.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

type LoggerOption = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceOption = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
type LoggerLike = LoggerOption | Console;

interface CustomViewRendererLike {
    render: (container: HTMLElement) => void;
    destroy?: () => void;
}

interface CustomViewRendererConstructor {
    new (options: {
        deviceConnection: unknown;
        viewDefinition: Record<string, unknown>;
        i18nService: I18nServiceOption | null;
        viewManager: unknown;
        logger: LoggerOption;
        showHeader?: boolean;
    }): CustomViewRendererLike;
}

const CustomViewRenderer = (
    customRuntimeRendererModule as unknown as { CustomViewRenderer: CustomViewRendererConstructor }
).CustomViewRenderer;

export { CustomViewRenderer };

interface CustomRuntimeViewOptions {
    viewDefinition?: Record<string, unknown> | null;
    deviceConnection?: unknown;
    i18nService?: I18nServiceOption | null;
    viewManager?: unknown;
    logger?: LoggerLike | null;
    showHeader?: boolean;
    title?: string;
    icon?: string;
    minHeight?: number;
    id?: string | null;
    minWidth?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
}

type CustomRuntimeViewSerializedData = ReturnType<ViewBase['serialize']>;

interface CustomRuntimeViewDeserializeContext {
    deviceConnection?: unknown;
    viewDefinition?: Record<string, unknown> | null;
    i18nService?: I18nServiceOption | null;
    viewManager?: unknown;
    logger?: LoggerLike | null;
}

/**
 * CustomRuntimeView - ViewBase wrapper for custom runtime configuration UI
 *
 * Features:
 * - ViewBase lifecycle (attach/detach/serialize)
 * - Wraps CustomViewRenderer for DOM rendering
 * - Can delegate its top-level header to a hosting CollapsibleView
 * - SplitView compatible (resizable)
 * - Theme-aware styling through standard view-system components
 *
 * @extends ViewBase
 */
export class CustomRuntimeView extends ViewBase {
    private _viewDefinition: Record<string, unknown> | null;
    private _deviceConnection: unknown;
    private _viewManager: unknown;
    private _renderer: CustomViewRendererLike | null;
    private _showHeader: boolean;
    private _placeholderView: StackView | null;

    /**
     * @param {Object} options - Configuration options
     * @param {Object} options.viewDefinition - JSON custom view definition
     * @param {DeviceConnection} options.deviceConnection - Device connection instance
     * @param {I18nService} [options.i18nService] - Translation service
     * @param {Object} [options.viewManager] - ViewManager for error modals
     * @param {Object} [options.logger=console] - Logger instance
     * @param {string} [options.title='Runtime Settings'] - View title
     * @param {string} [options.icon='settings'] - Icon identifier
     * @param {number} [options.minHeight=72] - Minimum expanded pane height in pixels (~2 toolbar rows)
     * @param {boolean} [options.showHeader=true] - Render the definition's top-level title/description header
     */
    constructor({
        viewDefinition = null,
        deviceConnection,
        i18nService,
        viewManager,
        logger = console,
        showHeader = true,
        title = 'Runtime Settings',
        icon = 'settings',
        minHeight = 72,
        ...rest
    }: CustomRuntimeViewOptions = {}) {
        super({
            i18nService,
            logger: logger as LoggerOption,
            title,
            icon,
            minHeight,
            ...rest,
        });

        this._viewDefinition = viewDefinition;
        this._deviceConnection = deviceConnection;
        this._viewManager = viewManager;
        this._renderer = null;
        this._showHeader = showHeader;
        this._placeholderView = null;

        this._log('constructor-complete', {
            hasViewDefinition: Boolean(viewDefinition),
            hasDeviceConnection: Boolean(deviceConnection),
        });
    }

    /**
     * Render custom runtime view
     * @param {HTMLElement} container - Parent container
     */
    override render(container: HTMLElement): void {
        this._log('render-start');

        if (this._placeholderView?.isAttached) {
            this._placeholderView.detach();
        }
        this._placeholderView = null;

        if (this._viewDefinition && this._deviceConnection) {
            if (!this._renderer) {
                this._renderer = new CustomViewRenderer({
                    deviceConnection: this._deviceConnection,
                    viewDefinition: this._viewDefinition,
                    i18nService: this._i18nService,
                    viewManager: this._viewManager,
                    logger: this._logger,
                    showHeader: this._showHeader,
                }) as CustomViewRendererLike;
            }

            this._renderer.render(container);
        } else {
            const placeholder = new StackView({
                fill: true,
                align: 'center',
                justify: 'center',
                padding: 10,
            });
            placeholder.addView(
                new MessageView({
                    text: this.t('customRuntimeView.noViewAvailable'),
                    tone: 'muted',
                })
            );
            this._placeholderView = placeholder;
            placeholder.attachTo(container);
        }

        this._log('render-complete');
    }

    /**
     * Hook called after view attached
     */
    override afterAttach(): void {
        super.afterAttach();
        this._log('after-attach');

        this._subscribeToLanguageChanges((): void => {
            if (this._container) {
                this.render(this._container);
            }
        });
    }

    /**
     * Hook called before view detached
     */
    override beforeDetach(): void {
        this._log('before-detach');

        if (this._placeholderView?.isAttached) {
            this._placeholderView.detach();
        }
        this._placeholderView = null;

        if (this._renderer && typeof this._renderer.destroy === 'function') {
            this._renderer.destroy();
        }
        this._renderer = null;

        super.beforeDetach();
    }

    /**
     * Serialize view state
     * @returns {Object} Serialized state
     */
    override serialize(): CustomRuntimeViewSerializedData {
        return {
            ...super.serialize(),
            type: 'custom-runtime-view',
        };
    }

    /**
     * Deserialize and restore view state
     * @param {Object} data - Serialized state
     * @param {Object} context - Deserialization context with dependencies
     * @returns {CustomRuntimeView} Restored view instance
     */
    static override deserialize(
        data: Record<string, unknown> = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: CustomRuntimeViewDeserializeContext | null | undefined = {}
    ): CustomRuntimeView {
        void viewFactory;
        const { deviceConnection, viewDefinition } = context || {};

        if (!deviceConnection) {
            throw new Error('CustomRuntimeView.deserialize requires deviceConnection in context');
        }

        return new CustomRuntimeView({
            ...(data as CustomRuntimeViewSerializedData),
            deviceConnection,
            viewDefinition,
            i18nService: context?.i18nService,
            viewManager: context?.viewManager,
            logger: context?.logger,
        });
    }
}