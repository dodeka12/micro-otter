import { IconProvider } from './icon-provider.js';
import { AppEvent, AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';

type OverlayLogger = (message: string, payload?: unknown) => void;
type OverlayEventListener<TPayload extends AppPayload = AppPayload> = (
    event: AppEvent<TPayload>
) => void;

interface OverlaySize {
    width: number;
    height: number;
}

interface OverlayPosition {
    x: number;
    y: number;
}

interface OverlayWindowView {
    title?: string;
    icon?: string | null;
    container?: HTMLElement | null;
    attachTo?: (container: HTMLElement) => void;
    detach?: () => void;
    onFocus?: () => void;
    onResize?: (size: OverlaySize) => void;
}

interface OverlayWindowOptions {
    view?: OverlayWindowView | null;
    title?: string;
    icon?: string | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    draggable?: boolean;
    showHeader?: boolean;
    minimizable?: boolean;
    closable?: boolean;
    closeOnOutsideClick?: boolean;
    startMinimized?: boolean;
    center?: boolean;
    logger?: OverlayLogger | null;
}

interface OverlayActionElements {
    minimize: HTMLButtonElement | null;
    close: HTMLButtonElement | null;
    minimizeIcon: HTMLImageElement | null;
    closeIcon: HTMLImageElement | null;
}

/**
 * Payload for `attach` events emitted by OverlayWindow.
 */
class OverlayWindowAttachPayload extends AppPayload {
    container: HTMLElement;
    /**
    * @param {object} params - Aggregated payload members for overlay attach events.
    * @param {HTMLElement} params.container - Host container element where overlay was attached.
     */
    constructor({ container }: { container: HTMLElement }) {
        super('OverlayWindow.Attach.v1');
        this.container = container;
    }
}

/**
 * Payload for `detach` events emitted by OverlayWindow.
 */
class OverlayWindowDetachPayload extends AppPayload {
    constructor() {
        super('OverlayWindow.Detach.v1');
    }
}

/**
 * Payload for `focus` events emitted by OverlayWindow.
 */
class OverlayWindowFocusPayload extends AppPayload {
    zIndex: number;
    /**
    * @param {object} params - Aggregated payload members for focus events.
    * @param {number} params.zIndex - Applied z-index after focus ordering.
     */
    constructor({ zIndex }: { zIndex: number }) {
        super('OverlayWindow.Focus.v1');
        this.zIndex = zIndex;
    }
}

/**
 * Payload for `minimize` events emitted by OverlayWindow.
 */
class OverlayWindowMinimizePayload extends AppPayload {
    constructor() {
        super('OverlayWindow.Minimize.v1');
    }
}

/**
 * Payload for `restore` events emitted by OverlayWindow.
 */
class OverlayWindowRestorePayload extends AppPayload {
    constructor() {
        super('OverlayWindow.Restore.v1');
    }
}

/**
 * Payload for `beforeClose` events emitted by OverlayWindow.
 */
class OverlayWindowBeforeClosePayload extends AppPayload {
    constructor() {
        super('OverlayWindow.BeforeClose.v1');
    }
}

/**
 * Payload for `close` events emitted by OverlayWindow.
 */
class OverlayWindowClosePayload extends AppPayload {
    constructor() {
        super('OverlayWindow.Close.v1');
    }
}

/**
 * Payload for `move` events emitted by OverlayWindow.
 */
class OverlayWindowMovePayload extends AppPayload {
    x: number;
    y: number;
    /**
    * @param {object} params - Aggregated payload members for move events.
    * @param {number} params.x - New window X position in pixels.
    * @param {number} params.y - New window Y position in pixels.
     */
    constructor({ x, y }: { x: number; y: number }) {
        super('OverlayWindow.Move.v1');
        this.x = x;
        this.y = y;
    }
}

/**
 * Payload for `resize` events emitted by OverlayWindow.
 */
class OverlayWindowResizePayload extends AppPayload {
    width: number;
    height: number;
    /**
    * @param {object} params - Aggregated payload members for resize events.
    * @param {number} params.width - New window width in pixels.
    * @param {number} params.height - New window height in pixels.
     */
    constructor({ width, height }: { width: number; height: number }) {
        super('OverlayWindow.Resize.v1');
        this.width = width;
        this.height = height;
    }
}

const defaultLogger: OverlayLogger = (...args: unknown[]) => {
    void args;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * OverlayWindow hosts a single ViewBase descendant inside a draggable/resizable window.
 * The overlay sits above other views, supports focus stacking, optional minimize/close controls,
 * and forwards resize/focus events to the hosted view when appropriate.
 *
 * Typical usage:
 * @example
 * import { OverlayWindow } from './overlay-window.js';
 * import { TextView } from './text-view.js';
 *
 * const overlayLayer = document.getElementById('overlay-layer');
 * const view = new TextView({ text: 'Hello overlay' });
 * const overlay = new OverlayWindow({ view, x: 80, y: 80, width: 360, height: 220 });
 * overlay.attachTo(overlayLayer);
 * overlay.on('close', () => logger.warn('overlay closed'));
 *
 * // Programmatic controls
 * overlay.focus();
 * overlay.toggleMinimize();
 * overlay.setView(new TextView({ text: 'Swapped content' }));
 *
 * Emitted events:
 * - `attach` -> `payloadTypeId: OverlayWindow.Attach.v1` -> `OverlayWindowAttachPayload`
 * - `detach` -> `payloadTypeId: OverlayWindow.Detach.v1` -> `OverlayWindowDetachPayload`
 * - `focus` -> `payloadTypeId: OverlayWindow.Focus.v1` -> `OverlayWindowFocusPayload`
 * - `minimize` -> `payloadTypeId: OverlayWindow.Minimize.v1` -> `OverlayWindowMinimizePayload`
 * - `restore` -> `payloadTypeId: OverlayWindow.Restore.v1` -> `OverlayWindowRestorePayload`
 * - `beforeClose` -> `payloadTypeId: OverlayWindow.BeforeClose.v1` -> `OverlayWindowBeforeClosePayload`
 * - `close` -> `payloadTypeId: OverlayWindow.Close.v1` -> `OverlayWindowClosePayload`
 * - `move` -> `payloadTypeId: OverlayWindow.Move.v1` -> `OverlayWindowMovePayload`
 * - `resize` -> `payloadTypeId: OverlayWindow.Resize.v1` -> `OverlayWindowResizePayload`
 */
export class OverlayWindow extends AppEventEmitter {
    static _zSeed: number | undefined;

    view: OverlayWindowView | null;
    title: string;
    icon: string | null;
    position: OverlayPosition;
    size: OverlaySize;
    minWidth: number;
    minHeight: number;
    resizable: boolean;
    draggable: boolean;
    showHeader: boolean;
    minimizable: boolean;
    closable: boolean;
    closeOnOutsideClick: boolean;
    _center: boolean;

    _isMinimized: boolean;
    _logger: OverlayLogger;
    _host: HTMLDivElement | null;
    _root: HTMLElement | null;
    _headerEl: HTMLDivElement | null;
    _contentEl: HTMLDivElement | null;
    _resizerEl: HTMLDivElement | null;
    _actions: OverlayActionElements;
    _zIndex: number;
    _eventListeners: Map<string, Set<OverlayEventListener>>;
    _outsideClickHandler: ((event: MouseEvent) => void) | null;

    constructor({
        view = null,
        title = 'Overlay',
        icon = null,
        x = 120,
        y = 120,
        width = 420,
        height = 260,
        minWidth = 260,
        minHeight = 160,
        resizable = true,
        draggable = true,
        showHeader = true,
        minimizable = true,
        closable = true,
        closeOnOutsideClick = false,
        startMinimized = false,
        center = false,
        logger = null,
    }: OverlayWindowOptions = {}) {
        super();
        this.view = view;
        this.title = title || view?.title || 'Overlay';
        this.icon = icon ?? view?.icon ?? null;
        this.position = { x, y };
        this.size = { width, height };
        this.minWidth = minWidth;
        this.minHeight = minHeight;
        this.resizable = resizable;
        this.draggable = draggable;
        this.showHeader = showHeader;
        this.minimizable = minimizable;
        this.closable = closable;
        this.closeOnOutsideClick = closeOnOutsideClick;
        this._center = Boolean(center);
        this._isMinimized = Boolean(startMinimized);

        this._logger = logger || defaultLogger;
        this._host = null;
        this._root = null;
        this._headerEl = null;
        this._contentEl = null;
        this._resizerEl = null;
        this._actions = { minimize: null, close: null, minimizeIcon: null, closeIcon: null };
        this._zIndex = OverlayWindow._nextZIndex();
        this._eventListeners = new Map();
        this._outsideClickHandler = null;
    }

    /**
     * Attach the overlay to a host container element and render its chrome + hosted view.
     * Subsequent calls will reparent if the host changes.
     * @param {HTMLElement} container Host element that will contain the overlay window.
     */
    attachTo(container: HTMLElement): void {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('OverlayWindow.attachTo requires a host HTMLElement.');
        }

        if (this._root && this._root !== container) {
            this.detach();
        }

        this._root = container;
        this._ensureHost();
        if (!this._host) {
            return;
        }
        if (!container.contains(this._host)) {
            container.appendChild(this._host);
        }
        this._applyFrame();
        if (this._center) {
            this.center();
        }
        this._attachView();
        this._notifyResize();
        this.focus();
        this._setupOutsideClickHandler();
        this._emit('attach', new OverlayWindowAttachPayload({ container }));
    }

    /**
     * Element that represents this overlay in the DOM.
     * @returns {HTMLElement|null} The window element, or null before the overlay is attached.
     */
    getOverlayElement(): HTMLElement | null {
        return this._host;
    }

    /**
     * Remove overlay DOM from its host and detach the hosted view.
     * Emits a `detach` event after cleanup.
     */
    detach(): void {
        this._removeOutsideClickHandler();
        if (this.view && typeof this.view.detach === 'function') {
            this.view.detach();
        }
        if (this._host && this._host.parentElement) {
            this._host.parentElement.removeChild(this._host);
        }
        this._root = null;
        this._emit('detach', new OverlayWindowDetachPayload());
    }

    /**
     * Close the overlay when a pointer event lands outside its bounds.
     *
     * @private
     * @param {MouseEvent} event - Pointer/mouse event from the document listener.
     */
    _handleOutsideClick(event: MouseEvent): void {
        const target = event.target;
        if (this._host && target instanceof Node && !this._host.contains(target)) {
            this._log('close-on-outside-click', {});
            this.close();
        }
    }

    /**
     * Register the document-level outside-click listener when enabled.
     *
     * Uses the same capture + deferred registration pattern as MenuView's
     * click-away dismissal so the interaction that opened the overlay does not
     * immediately close it again.
     *
     * @private
     */
    _setupOutsideClickHandler(): void {
        if (!this.closeOnOutsideClick || this._outsideClickHandler) {
            return;
        }

        this._outsideClickHandler = this._handleOutsideClick.bind(this);
        setTimeout(() => {
            if (this._outsideClickHandler) {
                document.addEventListener('mousedown', this._outsideClickHandler, true);
            }
        }, 0);
    }

    /**
     * Remove the document-level outside-click listener.
     *
     * @private
     */
    _removeOutsideClickHandler(): void {
        if (!this._outsideClickHandler) {
            return;
        }

        document.removeEventListener('mousedown', this._outsideClickHandler, true);
        this._outsideClickHandler = null;
    }

    /**
     * Swap the hosted view instance; detaches the previous view if present.
     * @param {import('./view-base.js').ViewBase|any} view View instance to host.
     */
    setView(view: OverlayWindowView | null): void {
        if (this.view === view) {
            return;
        }
        if (this.view && typeof this.view.detach === 'function') {
            this.view.detach();
        }
        this.view = view;
        this.icon = this.icon ?? view?.icon ?? null;
        this._attachView();
    }

    /**
     * Bring the overlay to the front, apply focused styling, and notify the hosted view.
     */
    focus(): void {
        if (!this._host) {
            return;
        }
        if (this._host.parentElement) {
            this._host.parentElement
                .querySelectorAll('.overlay-window.is-focused')
                .forEach((node) => {
                    if (node !== this._host) {
                        node.classList.remove('is-focused');
                    }
                });
        }
        this._zIndex = OverlayWindow._nextZIndex();
        this._host.style.zIndex = String(this._zIndex);
        this._host.classList.add('is-focused');
        this._emit('focus', new OverlayWindowFocusPayload({ zIndex: this._zIndex }));
        if (this.view && typeof this.view.onFocus === 'function') {
            this.view.onFocus();
        }
    }

    /**
     * Minimize the overlay, collapsing its content area if minimization is allowed.
     */
    minimize(): void {
        if (!this.minimizable || this._isMinimized) {
            return;
        }
        this._isMinimized = true;
        this._applyCollapsedState();
        this._emit('minimize', new OverlayWindowMinimizePayload());
    }

    /**
     * Restore the overlay from a minimized state and trigger a resize notification.
     */
    restore(): void {
        if (!this._isMinimized) {
            return;
        }
        this._isMinimized = false;
        this._applyCollapsedState();
        this._applyFrame();
        this._emit('restore', new OverlayWindowRestorePayload());
        this._notifyResize();
    }

    /**
     * Toggle between minimized and expanded states.
     */
    toggleMinimize(): void {
        if (this._isMinimized) {
            this.restore();
        } else {
            this.minimize();
        }
        this._updateActionLabels();
    }

    /**
     * Close and detach the overlay, emitting `beforeClose` then `close` events.
     */
    close(): void {
        this._emit('beforeClose', new OverlayWindowBeforeClosePayload());
        this.detach();
        this._emit('close', new OverlayWindowClosePayload());
    }

    /**
     * Move the overlay to an absolute position inside its host layer.
     * No-op before attach; the frame is re-applied (and clamped to the host bounds) when attached.
     * @param {number} x - Left offset in CSS pixels.
     * @param {number} y - Top offset in CSS pixels.
     */
    setPosition(x: number, y: number): void {
        this.position = { x, y };
        this._applyFrame();
    }

    /**
     * Center the overlay inside its host layer.
     *
     * No-op before attach; the position is clamped to the host bounds so an
     * oversized overlay never drifts off-screen. Used by the `center` option and
     * available to callers that want a dialog-style placement.
     */
    center(): void {
        if (!this._host || !this._root) {
            return;
        }
        const width = this.size.width ?? this._host.offsetWidth;
        const height = this.size.height ?? this._host.offsetHeight;
        this.setPosition(
            Math.max(0, Math.floor((this._root.clientWidth - width) / 2)),
            Math.max(0, Math.floor((this._root.clientHeight - height) / 2))
        );
    }

    /**
     * Clamp the overlay inside the current host bounds, reapplying size/position constraints.
     */
    constrainToBounds(): void {
        this._applyFrame();
    }

    /**
     * Subscribe to overlay events.
     * @param {string} event Event name (attach, detach, focus, minimize, restore, move, resize, beforeClose, close).
     * @param {Function} handler Callback invoked with event payload.
     * @returns {Function} Unsubscribe function.
     */
    override on<TPayload extends AppPayload = AppPayload>(
        event: string,
        handler: OverlayEventListener<TPayload>
    ): () => void {
        if (typeof handler !== 'function') {
            return () => {};
        }

        const bucket = this._eventListeners.get(event) || new Set<OverlayEventListener>();
        bucket.add(handler as OverlayEventListener);
        this._eventListeners.set(event, bucket);
        return () => this.off(event, handler);
    }

    /**
     * Remove a specific listener from an overlay event.
     * @param {string} event Event name.
     * @param {Function} handler Handler to remove.
     */
    override off<TPayload extends AppPayload = AppPayload>(
        event: string,
        handler: OverlayEventListener<TPayload>
    ): void {
        const bucket = this._eventListeners.get(event);
        if (!bucket) {
            return;
        }
        bucket.delete(handler as OverlayEventListener);
        if (bucket.size === 0) {
            this._eventListeners.delete(event);
        }
    }

    /** @private Create DOM for the overlay window and controls. */
    _ensureHost(): void {
        if (this._host) {
            return;
        }
        this._host = document.createElement('div');
        this._host.className = 'overlay-window';
        if (!this.showHeader) {
            this._host.classList.add('overlay-window--frameless');
        }
        this._host.tabIndex = 0;
        this._host.style.zIndex = String(this._zIndex);
        this._host.addEventListener('pointerdown', () => this.focus());

        if (this.showHeader) {
            this._headerEl = document.createElement('div');
            this._headerEl.className = 'overlay-window__header';

            if (this.draggable) {
                this._headerEl.addEventListener('pointerdown', (event) => this._beginDrag(event));
            }

            this._headerEl.addEventListener('dblclick', (event) => {
                event.preventDefault();
                this.toggleMinimize();
            });

            const iconEl = document.createElement('div');
            iconEl.className = 'overlay-window__icon';
            if (this.icon) {
                const iconValue = this.icon;
                // The window icon is an image source (inlined `data:` URI or served path) or a
                // text/emoji glyph; `IconProvider` owns that distinction for the whole app.
                const isPathLike =
                    typeof iconValue === 'string' && IconProvider.isImageSource(iconValue);

                if (isPathLike) {
                    const imgEl = document.createElement('img');
                    imgEl.src = iconValue;
                    imgEl.alt = '';
                    imgEl.className = 'overlay-window__icon-img';
                    imgEl.onerror = () => {
                        iconEl.style.display = 'none';
                    };
                    iconEl.appendChild(imgEl);
                } else {
                    iconEl.textContent = iconValue;
                }
            } else {
                iconEl.style.display = 'none';
            }

            const titleEl = document.createElement('div');
            titleEl.className = 'overlay-window__title';
            titleEl.textContent = this.title;

            const actions = document.createElement('div');
            actions.className = 'overlay-window__actions';

            if (this.minimizable) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'overlay-window__btn overlay-window__btn--minimize';
                btn.title = 'Minimize overlay';
                const iconImg = document.createElement('img');
                iconImg.src = IconProvider.arrowDropUp;
                iconImg.alt = '';
                iconImg.className = 'overlay-window__btn-icon overlay-window__btn-icon--toggle';
                btn.appendChild(iconImg);
                btn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.toggleMinimize();
                });
                actions.appendChild(btn);
                this._actions.minimize = btn;
                this._actions.minimizeIcon = iconImg;
            }

            if (this.closable) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'overlay-window__btn overlay-window__btn--close';
                btn.title = 'Close overlay';
                const iconImg = document.createElement('img');
                iconImg.src = IconProvider.close;
                iconImg.alt = '';
                iconImg.className = 'overlay-window__btn-icon overlay-window__btn-icon--close';
                btn.appendChild(iconImg);
                btn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.close();
                });
                actions.appendChild(btn);
                this._actions.close = btn;
                this._actions.closeIcon = iconImg;
            }

            this._headerEl.appendChild(iconEl);
            this._headerEl.appendChild(titleEl);
            this._headerEl.appendChild(actions);
        }

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'overlay-window__body';

        if (this._headerEl) {
            this._host.appendChild(this._headerEl);
        }
        this._host.appendChild(this._contentEl);

        if (this.resizable) {
            this._resizerEl = document.createElement('div');
            this._resizerEl.className = 'overlay-window__resizer';
            this._resizerEl.title = 'Resize overlay';
            this._resizerEl.addEventListener('pointerdown', (event) => this._beginResize(event));
            this._host.appendChild(this._resizerEl);
        }

        this._applyCollapsedState();
    }

    /** @private Apply size/position clamps and emit move/resize events. */
    _applyFrame(): void {
        if (!this._host || !this._root) {
            return;
        }
        const clampedSize = this._clampSize(this.size.width, this.size.height);
        const effectiveHeight = this._isMinimized
            ? this._headerEl?.offsetHeight || clampedSize.height
            : clampedSize.height;
        const clampedPos = this._clampPosition(
            this.position.x,
            this.position.y,
            clampedSize.width,
            effectiveHeight
        );

        this.size = { width: clampedSize.width, height: clampedSize.height };
        this.position = { x: clampedPos.x, y: clampedPos.y };

        this._host.style.minWidth = `${this.minWidth}px`;
        this._host.style.minHeight = `${this.minHeight}px`;

        this._host.style.width = `${clampedSize.width}px`;
        this._host.style.left = `${clampedPos.x}px`;
        this._host.style.top = `${clampedPos.y}px`;
        if (!this._isMinimized) {
            this._host.style.height = `${clampedSize.height}px`;
        }
        this._emit('move', new OverlayWindowMovePayload({ x: clampedPos.x, y: clampedPos.y }));
        if (!this._isMinimized) {
            this._emit(
                'resize',
                new OverlayWindowResizePayload({
                    width: clampedSize.width,
                    height: clampedSize.height,
                })
            );
            this._notifyResize();
        }
    }

    /** @private Clamp size against host bounds. */
    _clampSize(width: number, height: number): OverlaySize {
        const hostWidth = this._root?.clientWidth ?? width ?? this.minWidth;
        const hostHeight = this._root?.clientHeight ?? height ?? this.minHeight;
        const clampedWidth = clamp(
            width ?? hostWidth,
            this.minWidth,
            Math.max(this.minWidth, hostWidth)
        );
        const clampedHeight = clamp(
            height ?? hostHeight,
            this.minHeight,
            Math.max(this.minHeight, hostHeight)
        );
        return { width: clampedWidth, height: clampedHeight };
    }

    /** @private Clamp position against host bounds. */
    _clampPosition(x: number, y: number, width: number, height: number): OverlayPosition {
        const hostWidth = this._root?.clientWidth ?? width;
        const hostHeight = this._root?.clientHeight ?? height;
        const maxX = Math.max(0, hostWidth - width);
        const maxY = Math.max(0, hostHeight - height);
        return {
            x: clamp(x ?? 0, 0, maxX),
            y: clamp(y ?? 0, 0, maxY),
        };
    }

    /** @private Toggle DOM state for minimized/expanded modes and update controls. */
    _applyCollapsedState(): void {
        if (!this._host) {
            return;
        }
        if (this._isMinimized) {
            this._host.classList.add('is-minimized');
            if (this._contentEl) {
                this._contentEl.style.display = 'none';
            }
            if (this._resizerEl) {
                this._resizerEl.style.display = 'none';
            }
        } else {
            this._host.classList.remove('is-minimized');
            if (this._contentEl) {
                this._contentEl.style.display = 'flex';
            }
            if (this._resizerEl && this.resizable) {
                this._resizerEl.style.display = 'block';
            }
        }
        this._updateActionLabels();
    }

    /** @private Mount the hosted view into the overlay body. */
    _attachView(): void {
        if (!this._contentEl) {
            return;
        }
        this._contentEl.replaceChildren();
        if (this.view && typeof this.view.attachTo === 'function') {
            this.view.attachTo(this._contentEl);
        }
    }

    /** @private Begin a drag gesture for moving the overlay. */
    _beginDrag(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        if (event.target instanceof Element && event.target.closest('.overlay-window__btn')) {
            return;
        }
        event.preventDefault();
        this.focus();
        const startX = event.clientX;
        const startY = event.clientY;
        const origin = { ...this.position };
        const onMove = (moveEvent: PointerEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;
            const nextPos = this._clampPosition(
                origin.x + deltaX,
                origin.y + deltaY,
                this.size.width,
                this._isMinimized
                    ? this._headerEl?.offsetHeight || this.size.height
                    : this.size.height
            );
            this.position = nextPos;
            this._applyFrame();
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    /** @private Begin a resize gesture for the overlay. */
    _beginResize(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const originSize = { ...this.size };
        const originPos = { ...this.position };
        const onMove = (moveEvent: PointerEvent) => {
            const nextWidth = originSize.width + (moveEvent.clientX - startX);
            const nextHeight = originSize.height + (moveEvent.clientY - startY);
            const clampedSize = this._clampSize(nextWidth, nextHeight);
            const clampedPos = this._clampPosition(
                originPos.x,
                originPos.y,
                clampedSize.width,
                clampedSize.height
            );
            this.size = clampedSize;
            this.position = clampedPos;
            this._applyFrame();
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    /** @private Update minimize button label/title based on state. */
    _updateActionLabels(): void {
        if (this._actions.minimize) {
            this._actions.minimize.title = this._isMinimized
                ? 'Restore overlay'
                : 'Minimize overlay';
            if (this._actions.minimizeIcon) {
                this._actions.minimizeIcon.style.transform = this._isMinimized
                    ? 'rotate(180deg)'
                    : 'rotate(0deg)';
            }
        }
    }

    /** @private Notify hosted view about overlay resize when visible and attached. */
    _notifyResize(): void {
        if (
            this.view &&
            typeof this.view.onResize === 'function' &&
            this.view.container &&
            !this._isMinimized
        ) {
            this.view.onResize({ width: this.size.width, height: this.size.height });
        }
    }

    /** @private Emit an overlay event to registered listeners. */
    _emit(event: string, payload: AppPayload): void {
        const bucket = this._eventListeners.get(event);
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
            } catch (error) {
                this._log('listener error', { event, error });
            }
        });
    }

    /** @private Structured logging helper. */
    _log(event: string, payload: unknown): void {
        if (typeof this._logger === 'function') {
            this._logger(`[OverlayWindow] ${event}`, payload);
        }
    }

    /** @private Increment and return the next stacking z-index seed. */
    static _nextZIndex(): number {
        OverlayWindow._zSeed = (OverlayWindow._zSeed || 4000) + 1;
        return OverlayWindow._zSeed;
    }
}
