// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * MenuWindow is a convenience wrapper that combines MenuView with OverlayWindow.
 * It automatically creates a menu view, wraps it in a floating window, and handles
 * lifecycle events to ensure proper cleanup when the menu closes.
 *
 * This simplifies the common pattern of showing popup menus by encapsulating the
 * two-layer structure (menu interior + window chrome) into a single class.
 *
 * Features:
 * - Auto-sizing based on menu content
 * - Automatic cleanup when menu detaches
 * - Frameless window optimized for menus (no header, not draggable/resizable)
 * - Delegates menu events to callbacks
 * - Opens nested `menuview` rows as a side-opening child window (`anchor` option)
 *
 * Nested menus:
 * The window registers a submenu opener on its menu in the constructor, so `menuview` rows become
 * interactive. A child window attaches to the *same overlay layer element* as its parent (paint order
 * follows DOM order plus the overlay z-index counter), it is **not** registered with the overlay
 * manager, and its lifetime is owned by the parent window: `detach()` closes the child first.
 *
 * Click-away is split on purpose, and that split is easy to mistake for a bug: the parent menu
 * exempts the child element from its own click-away check, while the child does **not** exempt the
 * parent, so a `mousedown` anywhere in the parent closes the open child. That covers both "click
 * another row" and "click outside"; clicking the owning row again re-opens the child immediately
 * through the row's `click` handler.
 *
 * Typical usage:
 * @example
 * import { MenuWindow } from './menu-window.js';
 *
 * const menuWindow = new MenuWindow({
 *     items: [
 *         { id: 'copy', label: 'Copy', icon: '📋', shortcut: 'Ctrl+C' },
 *         { id: 'paste', label: 'Paste', icon: '📄', shortcut: 'Ctrl+V' },
 *         { type: 'separator' },
 *         { id: 'delete', label: 'Delete', icon: '🗑️' }
 *     ],
 *     onSelect: (item) => logger.info('Selected', item.id),
 *     x: event.clientX,
 *     y: event.clientY
 * });
 *
 * viewManager.addOverlay(menuWindow);
 *
 * Emitted Events:
 * - `select` -> `payloadTypeId: MenuWindow.Select.v1` -> `MenuWindowSelectPayload`
 */

import { OverlayWindow } from './overlay-window.js';
import { MenuView } from './menu-view.js';
import type {
    MenuViewActionEntry,
    MenuViewSubmenuEntry,
    MenuViewSubmenuHandle,
} from './menu-view.js';
import { computeAnchoredPosition } from './overlay-position.js';
import type { AnchorRectLike } from './overlay-position.js';
import { AppEvent, AppPayload, assertAppEventPayloadType } from '../core/app-event.js';

type OverlayWindowOptions = NonNullable<ConstructorParameters<typeof OverlayWindow>[0]>;
type OverlayWindowI18n =
    OverlayWindowOptions extends { i18nService?: infer T } ? T : unknown;

type MenuItemData = Record<string, unknown>;

type MenuWindowEntry =
    | { type: 'separator'; [key: string]: unknown }
    | ({ type?: string; label?: string } & MenuItemData);

interface MenuWindowOptions {
    items?: MenuWindowEntry[];
    /** Pre-built menu instance, used instead of `items`. */
    menu?: MenuView | null;
    /** Container label; forwarded to the internally built `MenuView` and used as the window title. */
    title?: string;
    /** Anchor rectangle (e.g. a menu row) the window opens beside instead of at `x`/`y`. */
    anchor?: AnchorRectLike | null;
    onSelect?: ((item: MenuItemData) => void) | null;
    x?: number;
    y?: number;
    enableClickAway?: boolean;
    enableKeyboard?: boolean;
    i18nService?: OverlayWindowI18n;
    logger?: OverlayWindowOptions extends { logger?: infer T } ? T : unknown;
    [key: string]: unknown;
}

/**
 * Payload for `select` events emitted by MenuWindow.
 */
class MenuWindowSelectPayload extends AppPayload {
    item: MenuItemData;

    /**
    * @param {object} params - Aggregated payload members for menu-window selection.
    * @param {object} params.item - Selected menu item definition relayed to listeners.
     */
    constructor({ item }: { item: MenuItemData }) {
        super('MenuWindow.Select.v1');
        this.item = item;
    }
}

export class MenuWindow extends OverlayWindow {
    menu: MenuView;

    /** Child menu window of the currently open `menuview` row, if any. */
    private _childWindow: MenuWindow | null = null;

    /**
     * Create a new MenuWindow instance.
     * @param {object} options - Configuration options
     * @param {Array} [options.items] - Menu items array, ignored when `menu` is given
     * @param {object} [options.menu=null] - Pre-built MenuView instance to host
     * @param {string} [options.title='Menu'] - Container label and window title
     * @param {object} [options.anchor=null] - Row rectangle the window opens beside
     * @param {Function} [options.onSelect=null] - Selection callback
     * @param {number} [options.x=0] - X position for the window
     * @param {number} [options.y=0] - Y position for the window
     * @param {boolean} [options.enableClickAway=true] - Enable click-away detection
     * @param {boolean} [options.enableKeyboard=true] - Enable keyboard navigation
     * @param {object} [options.i18nService=null] - I18n service for translations
     * @param {Function} [options.logger=null] - Logger function
     * @param {object} [options.overlayOptions={}] - Additional OverlayWindow options to override defaults
     */
    constructor({
        items = [],
        menu: providedMenu = null,
        title = 'Menu',
        anchor = null,
        onSelect = null,
        x = 0,
        y = 0,
        enableClickAway = true,
        enableKeyboard = true,
        i18nService = null,
        logger = null,
        ...overlayOptions
    }: MenuWindowOptions = {}) {
        void enableClickAway;
        void enableKeyboard;

        const menu =
            providedMenu ??
            new MenuView({
                items: items as ConstructorParameters<typeof MenuView>[0]['items'],
                position: { x: 0, y: 0 },
                onSelect,
                i18nService: i18nService as any,
                logger,
                title,
            });

        if (providedMenu && typeof onSelect === 'function') {
            // Bubble point for selections that arrive from a child menu.
            providedMenu.onSelectCallback = onSelect;
        }

        const preferred = menu.getPreferredSize();
        const placed = anchor ? computeAnchoredPosition(anchor, preferred) : { x, y };

        super({
            view: menu,
            title: menu.title || title,
            x: placed.x,
            y: placed.y,
            width: preferred.width,
            height: preferred.height,
            minWidth: preferred.width,
            minHeight: preferred.height,
            showHeader: false,
            draggable: false,
            resizable: false,
            minimizable: false,
            closable: false,
            logger,
            ...overlayOptions,
        });

        this.menu = menu;
        this.menu.setSubmenuOpener((entry, row) => this._openChildMenu(entry, row));
        this._setupMenuLifecycle();
    }

    /**
     * Get the hosted MenuView instance.
     * @returns {MenuView} The menu view instance
     */
    getMenu(): MenuView {
        return this.menu;
    }

    /**
     * Open the child menu of a `menuview` row inside the parent's overlay layer.
     * The child is a sibling overlay: it is not registered with the overlay manager and lives
     * exactly as long as this window.
     * @param {object} entry - Submenu entry that owns the child menu.
     * @param {HTMLElement} row - Rendered parent row (anchor).
     * @returns {object|null} Handle for the opened child, or null when it could not be opened.
     * @private
     */
    _openChildMenu(entry: MenuViewSubmenuEntry, row: HTMLElement): MenuViewSubmenuHandle | null {
        this._closeChildMenu();

        // Overlay layer captured by attachTo().
        const layer = this._root;
        if (!layer) {
            return null;
        }

        entry.menu.setParentHook((reason) => {
            if (reason === 'escape') {
                // Close the whole stack, not just this level.
                this.menu.detach();
                return;
            }
            this._closeChildMenu();
            this.menu.focusRowFor(entry);
        });

        const child = new MenuWindow({
            menu: entry.menu,
            anchor: row.getBoundingClientRect(),
            onSelect: (item) => this.menu.acceptSelectionFromSubmenu(item as MenuViewActionEntry),
            logger: this._logger,
        });
        child.attachTo(layer);
        this._childWindow = child;
        child.on('close', () => {
            if (this._childWindow === child) {
                this._childWindow = null;
            }
        });

        return {
            element: child.getOverlayElement(),
            focus: () => {
                entry.menu.focusFirstItem();
            },
            close: () => {
                this._closeChildMenu();
            },
            onClose: (listener) => {
                child.on('close', listener);
            },
        };
    }

    /**
     * Close the tracked child menu window, if any. Safe to call twice.
     * @private
     */
    _closeChildMenu(): void {
        const child = this._childWindow;
        if (!child) {
            return;
        }

        this._childWindow = null;
        child.close();
    }

    /**
     * Detach the window; the child menu window is closed first so it can never be orphaned.
     */
    override detach(): void {
        this._closeChildMenu();
        super.detach();
    }

    /**
     * Setup event handlers to coordinate menu and overlay lifecycles.
     * When the menu detaches (e.g., user clicks outside or selects an item),
     * the overlay window should also close.
     * @private
     */
    private _setupMenuLifecycle(): void {
        this.menu.on('detach', (event: AppEvent) => {
            assertAppEventPayloadType(
                event,
                'ViewBase.Detach.v1',
                [{ name: 'container', validate: (value: unknown) => value instanceof HTMLElement }],
                'MenuWindow.menuDetachListener'
            );

            if (typeof this.close === 'function') {
                this.close();
            }
        });

        this.menu.on('select', (event: AppEvent) => {
            const validated = assertAppEventPayloadType(
                event,
                'MenuView.Select.v1',
                [{ name: 'item', validate: (value: unknown) => Boolean(value) && typeof value === 'object' }],
                'MenuWindow.menuSelectListener'
            );

            this._emit('select', new MenuWindowSelectPayload({ item: validated.detail.item as MenuItemData }));
        });
    }

    /**
     * Override _emit to handle both menu and overlay events.
     * @param {string} event - Event name
     * @param {*} payload - Event payload
     * @private
     */
    _emit(event: string, payload: AppPayload): void {
        if (super._emit) {
            super._emit(event, payload);
        }
    }
}
