import { AppEvent, AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LoggerFunction = (message: string, level?: unknown, ...data: unknown[]) => void;
type ViewBaseEventHandler = (event: AppEvent) => void;
type SplitViewResizeAction = 'collapse' | 'maximize' | 'minimize';

interface ViewSize {
    width: number;
    height: number;
}

interface ViewBaseMetadata {
    id: string;
    title: string;
    icon: string | null;
}

interface ViewBaseSerialized {
    type: string;
    id: string;
    title: string;
    icon: string | null;
    [key: string]: unknown;
}

interface ViewBaseOptions {
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: LoggerFunction | null;
    i18nService?: I18nServiceLike | null;
    minWidth?: number | null;
    minHeight?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
}

interface ViewBaseDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
}

interface ViewBaseDeserializeContext {
    i18nService?: I18nServiceLike | null;
    logger?: LoggerFunction | null;
}

interface ViewBaseHeightConstraints {
    minHeight?: number | null;
    maxHeight?: number | null;
}

interface ViewBaseSizeConstraints {
    minWidth?: number | null;
    minHeight?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
}

interface ViewBaseDesiredSize {
    width?: number | null;
    height?: number | null;
}

interface I18nServiceLike {
    t: (key: string, params?: Record<string, unknown>) => string;
    addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
}

interface MicroOtterLogApi {
    log: (className: string, reason: string, level: LogLevel, ...data: unknown[]) => void;
    logEnabled: (className: string, reason: string, level: string) => boolean;
}

interface SplitViewHostContainer extends HTMLElement {
    _splitViewChannel?: EventTarget | null;
}

declare global {
    var __microOtterLog: MicroOtterLogApi | undefined;
}

/**
 * Payload for `attach`/`afterAttach` events emitted by ViewBase.
 */
class ViewBaseAttachPayload extends AppPayload {
    container: HTMLElement;

    constructor({ container }: { container: HTMLElement }) {
        super('ViewBase.Attach.v1');
        this.container = container;
    }
}

/**
 * Payload for `beforeDetach`/`detach` events emitted by ViewBase.
 */
class ViewBaseDetachPayload extends AppPayload {
    container: HTMLElement;

    constructor({ container }: { container: HTMLElement }) {
        super('ViewBase.Detach.v1');
        this.container = container;
    }
}

/**
 * Payload for `resize` events emitted by ViewBase.
 */
class ViewBaseResizePayload extends AppPayload {
    width: number;
    height: number;

    constructor({ width, height }: ViewSize) {
        super('ViewBase.Resize.v1');
        this.width = width;
        this.height = height;
    }
}

/**
 * Payload for `focus` events emitted by ViewBase.
 */
class ViewBaseFocusPayload extends AppPayload {
    constructor() {
        super('ViewBase.Focus.v1');
    }
}

/**
 * Payload for `initialSize` events emitted by ViewBase.
 */
class ViewBaseInitialSizePayload extends AppPayload {
    width: number;
    height: number;

    constructor({ width, height }: ViewSize) {
        super('ViewBase.InitialSize.v1');
        this.width = width;
        this.height = height;
    }
}

/**
 * Payload for `resized` events emitted by ViewBase.
 */
class ViewBaseResizedPayload extends AppPayload {
    width: number;
    height: number;

    constructor({ width, height }: ViewSize) {
        super('ViewBase.Resized.v1');
        this.width = width;
        this.height = height;
    }
}

/**
 * Payload for `desiredSize` events emitted by ViewBase.
 */
class ViewBaseDesiredSizePayload extends AppPayload {
    width: number | null;
    height: number | null;

    constructor({ width, height }: { width: number | null; height: number | null }) {
        super('ViewBase.DesiredSize.v1');
        this.width = width;
        this.height = height;
    }
}

const defaultLogger: LoggerFunction = (...args) => {
    void args;
};

const validLogLevels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === 'string' && (validLogLevels as readonly string[]).includes(value);
}

/**
 * Base class for view implementations that can be attached to DOM containers.
 */
export class ViewBase extends AppEventEmitter {
    title: string;
    icon: string | null;
    id: string;

    protected _logger: LoggerFunction;
    protected _container: HTMLElement | null;

    protected _minWidth: number | null;
    protected _minHeight: number | null;
    protected _maxWidth: number | null;
    protected _maxHeight: number | null;

    protected _desiredWidth: number | null;
    protected _desiredHeight: number | null;

    protected _resizeObserver: ResizeObserver | null;
    protected _initialSizeDetected: boolean;
    protected _lastObservedSize: ViewSize;

    protected _i18nService: I18nServiceLike | null;
    protected _i18nCleanup: (() => void) | null;

    private _getListenerMap(): Map<string, Set<ViewBaseEventHandler>> {
        return (this as unknown as { _listeners: Map<string, Set<ViewBaseEventHandler>> })
            ._listeners;
    }

    constructor({
        title = 'Untitled View',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
        minWidth = null,
        minHeight = null,
        maxWidth = null,
        maxHeight = null,
    }: ViewBaseOptions = {}) {
        super();
        this.title = title;
        this.icon = icon;
        this.id = id || `view-${Math.random().toString(16).slice(2, 8)}`;
        this._logger = logger || defaultLogger;
        this._container = null;
        this._minWidth = Number.isFinite(minWidth) && minWidth >= 0 ? minWidth : null;
        this._minHeight = Number.isFinite(minHeight) && minHeight >= 0 ? minHeight : null;
        this._maxWidth = Number.isFinite(maxWidth) && maxWidth >= 0 ? maxWidth : null;
        this._maxHeight = Number.isFinite(maxHeight) && maxHeight >= 0 ? maxHeight : null;
        this._desiredWidth = null;
        this._desiredHeight = null;
        this._resizeObserver = null;
        this._initialSizeDetected = false;
        this._lastObservedSize = { width: 0, height: 0 };
        this._i18nService = i18nService;
        this._i18nCleanup = null;
    }

    get minHeight(): number | null {
        return this._minHeight;
    }

    get maxHeight(): number | null {
        return this._maxHeight;
    }

    get maxWidth(): number | null {
        return this._maxWidth;
    }

    get minWidth(): number | null {
        return this._minWidth;
    }

    get isAttached(): boolean {
        return Boolean(this._container);
    }

    get container(): HTMLElement | null {
        return this._container;
    }

    getMetadata(): ViewBaseMetadata {
        return { id: this.id, title: this.title, icon: this.icon };
    }

    attachTo(container: HTMLElement): void {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('ViewBase.attachTo requires a container HTMLElement.');
        }

        if (this._container && this._container !== container) {
            this.detach();
        }

        if (this._container === container) {
            return;
        }

        this._container = container;
        this._emit('attach', new ViewBaseAttachPayload({ container }));
        this._setupResizeObserver(container);
        this.render(container);
        this.afterAttach();
        this._notifySplitViewConstraints();
        this._emit('afterAttach', new ViewBaseAttachPayload({ container }));
    }

    detach(): void {
        if (!this._container) {
            this.beforeDetach();
            return;
        }
        const previous = this._container;
        this._emit('beforeDetach', new ViewBaseDetachPayload({ container: previous }));
        this.beforeDetach();
        previous.replaceChildren();
        this._container = null;
        this._emit('detach', new ViewBaseDetachPayload({ container: previous }));
    }

    mountContent(node: Node): void {
        if (!this._container) {
            throw new Error('Cannot mount content: view is not attached.');
        }
        this._container.replaceChildren(node);
    }

    render(container: HTMLElement): void {
        this._log('render noop', { container });
    }

    afterAttach(): void {}

    beforeDetach(): void {
        this._unsubscribeFromLanguageChanges();
        this._teardownResizeObserver();
    }

    serialize(): ViewBaseSerialized {
        return {
            type: this.constructor.name,
            id: this.id,
            title: this.title,
            icon: this.icon,
        };
    }

    static deserialize(
        data: ViewBaseDeserializeData = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: ViewBaseDeserializeContext = {}
    ): ViewBase {
        void viewFactory;
        const { title = 'Untitled View', icon = null, id = null } = data;
        const { i18nService = null, logger = null } = context;
        return new ViewBase({ title, icon, id, i18nService, logger });
    }

    t(key: string, params: Record<string, unknown> = {}): string {
        if (!this._i18nService) {
            console.warn(`[view] ${this.id}: No i18n service available for key "${key}"`);
            return key;
        }
        return this._i18nService.t(key, params);
    }

    protected _subscribeToLanguageChanges(callback: (event: Event) => void): void {
        if (
            !this._i18nService ||
            typeof this._i18nService.addEventListener !== 'function' ||
            typeof this._i18nService.removeEventListener !== 'function'
        ) {
            return;
        }

        const handler = (event: Event) => callback(event);
        this._i18nService.addEventListener('languagechange', handler);

        this._i18nCleanup = () => {
            this._i18nService?.removeEventListener('languagechange', handler);
        };
    }

    protected _unsubscribeFromLanguageChanges(): void {
        if (this._i18nCleanup) {
            this._i18nCleanup();
            this._i18nCleanup = null;
        }
    }

    onResize(payload: ViewSize): void {
        this._emit('resize', new ViewBaseResizePayload(payload));
    }

    onFocus(): void {
        this._log('focus');
        this._emit('focus', new ViewBaseFocusPayload());
    }

    onInitialSize(size: ViewSize): void {
        this._emit('initialSize', new ViewBaseInitialSizePayload(size));
    }

    onResized(size: ViewSize): void {
        this._emit('resized', new ViewBaseResizedPayload(size));
    }

    protected _setupResizeObserver(element: HTMLElement | null): void {
        if (!element || typeof ResizeObserver === 'undefined') {
            return;
        }

        if (this._resizeObserver) {
            this._teardownResizeObserver();
        }

        this._resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;

                if ((width > 0 || height > 0) && !this._initialSizeDetected) {
                    this._initialSizeDetected = true;
                    this._lastObservedSize = { width, height };
                    this.onInitialSize({ width, height });
                } else if (this._initialSizeDetected) {
                    const changed =
                        width !== this._lastObservedSize.width ||
                        height !== this._lastObservedSize.height;

                    if (changed) {
                        this._lastObservedSize = { width, height };
                        this.onResized({ width, height });
                    }
                }
            }
        });

        this._resizeObserver.observe(element);
    }

    protected _teardownResizeObserver(): void {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    getSplitViewChannel(): EventTarget | null {
        const container = this._container as SplitViewHostContainer | null;
        return container && container._splitViewChannel ? container._splitViewChannel : null;
    }

    querySplitViewHost(extraDetail: Record<string, unknown> = {}): Record<string, unknown> {
        const channel = this.getSplitViewChannel();
        const detail: Record<string, unknown> = { hosted: false, ...extraDetail };
        if (!channel) {
            return detail;
        }
        if (typeof CustomEvent !== 'function') {
            this._log('splitview query skipped; CustomEvent unavailable');
            return detail;
        }
        channel.dispatchEvent(new CustomEvent('splitview:query-host', { detail }));
        return detail;
    }

    requestSplitViewResize(
        action: SplitViewResizeAction,
        extraDetail: Record<string, unknown> = {}
    ): Record<string, unknown> {
        const channel = this.getSplitViewChannel();
        const detail: Record<string, unknown> = {
            action,
            handled: false,
            hosted: false,
            ...extraDetail,
        };
        if (!channel) {
            this._log('splitview request skipped; no channel', { action });
            return detail;
        }
        if (typeof CustomEvent !== 'function') {
            this._log('splitview request skipped; CustomEvent unavailable', { action });
            return detail;
        }

        channel.dispatchEvent(new CustomEvent('splitview:resize-request', { detail }));
        if (!detail.handled) {
            this._log('splitview request unhandled', { action, detail });
        }
        return detail;
    }

    /**
     * Ask the hosting SplitView to make this pane the only expanded collapsible pane.
     *
     * The host owns the operation: it expands the requester and collapses every other
     * direct child that advertises `isCollapsible`, so a view only states the intent.
     * The event name mirrors `SPLIT_VIEW_EVENTS.soloRequest`; importing that constant
     * here would create a base-to-container module cycle.
     * @param {Record<string, unknown>} extraDetail Additional detail fields for listeners.
     * @returns {Record<string, unknown>} Mutable detail, filled in by the host when handled.
     */
    requestSplitViewSolo(extraDetail: Record<string, unknown> = {}): Record<string, unknown> {
        const channel = this.getSplitViewChannel();
        const detail: Record<string, unknown> = {
            handled: false,
            hosted: false,
            ...extraDetail,
        };
        if (!channel) {
            this._log('splitview solo skipped; no channel');
            return detail;
        }
        if (typeof CustomEvent !== 'function') {
            this._log('splitview solo skipped; CustomEvent unavailable');
            return detail;
        }

        channel.dispatchEvent(new CustomEvent('splitview:solo-request', { detail }));
        if (!detail.handled) {
            this._log('splitview solo unhandled', { detail });
        }
        return detail;
    }

    setMinHeight(minHeight: number | null): void {
        this._minHeight = Number.isFinite(minHeight) && minHeight >= 0 ? minHeight : null;
        this._notifySplitViewConstraints();
    }

    setMaxHeight(maxHeight: number | null): void {
        this._maxHeight = Number.isFinite(maxHeight) && maxHeight >= 0 ? maxHeight : null;
        this._notifySplitViewConstraints();
    }

    setMaxWidth(maxWidth: number | null): void {
        this._maxWidth = Number.isFinite(maxWidth) && maxWidth >= 0 ? maxWidth : null;
        this._notifySplitViewConstraints();
    }

    setHeightConstraints({ minHeight = null, maxHeight = null }: ViewBaseHeightConstraints = {}): void {
        this._minHeight = Number.isFinite(minHeight) && minHeight >= 0 ? minHeight : null;
        this._maxHeight = Number.isFinite(maxHeight) && maxHeight >= 0 ? maxHeight : null;
        this._notifySplitViewConstraints();
    }

    setMinWidth(minWidth: number | null): void {
        this._minWidth = Number.isFinite(minWidth) && minWidth >= 0 ? minWidth : null;
        this._notifySplitViewConstraints();
    }

    setSizeConstraints({
        minWidth = null,
        minHeight = null,
        maxWidth = null,
        maxHeight = null,
    }: ViewBaseSizeConstraints = {}): void {
        this._minWidth = Number.isFinite(minWidth) && minWidth >= 0 ? minWidth : null;
        this._minHeight = Number.isFinite(minHeight) && minHeight >= 0 ? minHeight : null;
        this._maxWidth = Number.isFinite(maxWidth) && maxWidth >= 0 ? maxWidth : null;
        this._maxHeight = Number.isFinite(maxHeight) && maxHeight >= 0 ? maxHeight : null;
        this._notifySplitViewConstraints();
    }

    protected _notifySplitViewConstraints(): void {
        const channel = this.getSplitViewChannel();
        if (!channel || typeof CustomEvent !== 'function') {
            return;
        }
        const detail = {
            handled: false,
            hosted: false,
            minWidth: this._minWidth,
            minHeight: this._minHeight,
            maxWidth: this._maxWidth,
            maxHeight: this._maxHeight,
        };
        channel.dispatchEvent(new CustomEvent('splitview:size-constraints', { detail }));
    }

    setDesiredSize({ width = null, height = null }: ViewBaseDesiredSize = {}): void {
        const prevWidth = this._desiredWidth;
        const prevHeight = this._desiredHeight;
        this._desiredWidth = Number.isFinite(width) && width > 0 ? width : null;
        this._desiredHeight = Number.isFinite(height) && height > 0 ? height : null;

        if (prevWidth !== this._desiredWidth || prevHeight !== this._desiredHeight) {
            this._emit(
                'desiredSize',
                new ViewBaseDesiredSizePayload({
                    width: this._desiredWidth,
                    height: this._desiredHeight,
                })
            );
        }
    }

    getDesiredSize(): { width: number | null; height: number | null } {
        return {
            width: this._desiredWidth,
            height: this._desiredHeight,
        };
    }

    on<TPayload extends AppPayload = AppPayload>(
        event: string,
        handler: ((event: AppEvent<TPayload>) => void) | null | undefined
    ): () => void {
        if (typeof handler !== 'function') {
            return () => {};
        }
        const listeners = this._getListenerMap();
        const bucket = listeners.get(event) || new Set<ViewBaseEventHandler>();
        bucket.add(handler as ViewBaseEventHandler);
        listeners.set(event, bucket);
        return () => this.off(event, handler);
    }

    once<TPayload extends AppPayload = AppPayload>(
        event: string,
        handler: (event: AppEvent<TPayload>) => void
    ): () => void {
        const wrapped = (payload: AppEvent<TPayload>) => {
            this.off(event, wrapped);
            handler(payload);
        };
        return this.on(event, wrapped);
    }

    off<TPayload extends AppPayload = AppPayload>(
        event: string,
        handler: (event: AppEvent<TPayload>) => void
    ): void {
        const listeners = this._getListenerMap();
        const bucket = listeners.get(event);
        if (!bucket) {
            return;
        }
        bucket.delete(handler as ViewBaseEventHandler);
        if (bucket.size === 0) {
            listeners.delete(event);
        }
    }

    protected _emit(event: string, payload: AppPayload): void {
        const bucket = this._getListenerMap().get(event);
        if (!bucket) {
            return;
        }

        if (payload instanceof AppEvent) {
            throw new TypeError(
                `${this.constructor.name}._emit expects a payload instance, not AppEvent. Pass AppPayload and let _emit wrap it.`
            );
        }

        if (!(payload instanceof AppPayload)) {
            throw new TypeError(
                `${this.constructor.name}._emit expects payload to be an AppPayload instance.`
            );
        }

        const emitted = new AppEvent(event, payload);

        bucket.forEach((handler) => {
            try {
                handler(emitted);
            } catch (err) {
                this._log('listener error', { event, err });
            }
        });
    }

    protected _log(reason: string, level: LogLevel | unknown = 'debug', ...data: unknown[]): void {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            const { log } = globalThis.__microOtterLog;

            const actualLevel: LogLevel = isLogLevel(level) ? level : 'debug';
            const actualData = isLogLevel(level) ? data : [level, ...data];

            const className = this.constructor.name;

            log(className, reason, actualLevel, ...actualData);
        } else {
            if (typeof this._logger === 'function') {
                this._logger(`[${this.constructor.name}:${this.id}] ${reason}`, level, ...data);
            }
        }
    }

    protected _logEnabled(reason: string, level = 'debug'): boolean {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            return globalThis.__microOtterLog.logEnabled(this.constructor.name, reason, level);
        }
        return false;
    }
}
