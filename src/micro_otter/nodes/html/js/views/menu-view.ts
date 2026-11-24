import { ViewBase } from './view-base.js';
import { IconProvider } from './icon-provider.js';
import { AppPayload } from '../core/app-event.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

export interface MenuViewPosition {
    x: number;
    y: number;
}

export interface MenuViewSeparatorEntry {
    type: 'separator';
}

export interface MenuViewActionEntry {
    id?: string;
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    checked?: boolean;
    [key: string]: unknown;
}

export interface MenuViewSubmenuEntry {
    type: 'menuview';
    /** Row identifier; the rendered row carries an empty `data-item-id` when omitted. */
    id?: string;
    /** Row title; a translation key or a literal, exactly like `MenuViewActionEntry.label`. */
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    /** Menu opened next to this row. Owns its own entries, callbacks and translations. */
    menu: MenuView;
}

export type MenuViewEntry = MenuViewSeparatorEntry | MenuViewActionEntry | MenuViewSubmenuEntry;
export type MenuViewSelectCallback = (item: MenuViewActionEntry) => void;

/**
 * Handle for the side menu a `menuview` row opened.
 */
export interface MenuViewSubmenuHandle {
    /** Root element of the child overlay, exempted from the parent's click-away check. */
    element: HTMLElement | null;
    /** Move keyboard focus into the child menu. */
    focus?: () => void;
    /** Close the child menu. Safe to call twice. */
    close(): void;
    /**
     * Register a callback fired when the child closes on its own (for example because a `mousedown`
     * landed elsewhere in the parent menu). Without it the owning row would keep `aria-expanded="true"`
     * and refuse to re-open the child.
     * @param {Function} listener - Called once per child close.
     */
    onClose?: (listener: () => void) => void;
}

/**
 * Opens the side menu of a `menuview` entry.
 * @param {object} entry - Submenu entry that owns the child menu.
 * @param {HTMLElement} row - Rendered row of that entry, used as the anchor.
 * @returns {object|null} Handle for the opened child, or null when nothing was opened.
 */
export type MenuViewSubmenuOpener = (
    entry: MenuViewSubmenuEntry,
    row: HTMLElement
) => MenuViewSubmenuHandle | null;

/**
 * Called by a nested menu when the user leaves it.
 * `'left'` = ArrowLeft (focus must return to the owning row), `'escape'` = close the whole stack.
 */
export type MenuViewParentHook = (reason: 'left' | 'escape') => void;

/** Hover delay before a `menuview` row opens its side menu. */
const SUBMENU_OPEN_DELAY_MS = 120;

/**
 * Hover delay before an open side menu closes again. The delay lets the pointer travel
 * diagonally from the owning row into the child without the child vanishing on the way.
 */
const SUBMENU_CLOSE_DELAY_MS = 200;

export interface MenuViewOptions extends Omit<ViewBaseOptions, 'title'> {
    items?: MenuViewEntry[];
    position?: MenuViewPosition;
    onSelect?: MenuViewSelectCallback | null;
    /** Container label; translated and applied as `aria-label` on `role="menu"`. */
    title?: string;
    [key: string]: unknown;
}

/**
 * Payload for `select` events emitted by MenuView.
 */
class MenuViewSelectPayload extends AppPayload {
    item: MenuViewActionEntry;

    /**
     * @param {object} params - Aggregated payload members for menu selection.
     * @param {object} params.item - Selected menu item definition delivered to handlers.
     */
    constructor({ item }: { item: MenuViewActionEntry }) {
        super('MenuView.Select.v1');
        this.item = item;
    }
}

/**
 * Whether an entry renders as a plain separator line.
 * @param {object} item - Entry definition.
 * @returns {boolean} True for separator entries.
 */
function isSeparatorEntry(item: MenuViewEntry): item is MenuViewSeparatorEntry {
    return item.type === 'separator';
}

/**
 * Whether an entry renders as a row that opens a nested menu.
 * @param {object} item - Entry definition.
 * @returns {boolean} True for `menuview` entries.
 */
function isSubmenuEntry(item: MenuViewEntry): item is MenuViewSubmenuEntry {
    return (item as { type?: unknown }).type === 'menuview';
}

/**
 * Whether an entry renders as a clickable leaf row.
 * @param {object} item - Entry definition.
 * @returns {boolean} True for action entries (neither separator nor `menuview`).
 */
function isActionEntry(item: MenuViewEntry): item is MenuViewActionEntry {
    return !isSeparatorEntry(item) && !isSubmenuEntry(item);
}

/**
 * Whether an entry can hold the keyboard selection.
 * Only separators and rows flagged `disabled` are skipped.
 * @param {object} item - Entry definition.
 * @returns {boolean} True for rows that can be selected.
 */
function isSelectableEntry(
    item: MenuViewEntry
): item is MenuViewActionEntry | MenuViewSubmenuEntry {
    return !isSeparatorEntry(item) && item.disabled !== true;
}

/**
 * MenuView - Reusable Menu component.
 *
 * Built as a specialized view that:
 * - Shows at specified screen position
 * - Auto-positions to stay within viewport
 * - Dismisses on Esc or click-away
 * - Returns selected item via callback or event
 * - Renders `menuview` entries as rows that open a nested `MenuView` (see `setSubmenuOpener()`)
 *
 * Usage:
 *   const menu = new MenuView({
 *       items: [
 *           { id: 'copy', label: 'Copy', icon: '📋', shortcut: 'Ctrl+C' },
 *           { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: true },
 *           { type: 'separator' },
 *           {
 *               type: 'menuview',
 *               label: 'More',
 *               menu: new MenuView({
 *                   title: 'More',
 *                   items: [{ id: 'delete', label: 'Delete', icon: '🗑️', shortcut: 'Del' }]
 *               })
 *           }
 *       ],
 *       position: { x: event.clientX, y: event.clientY },
 *       onSelect: (item) => { logger.info('Selected', item.id); }
 *   });
 *
 *   // Attach to the overlay layer via ViewManager
 *   viewManager.addOverlay(new MenuWindow({ menu }));
 *
 * Nested menus (`menuview` rows):
 * - A `menuview` row carries its own `MenuView` instance and never selects anything itself.
 * - The row asks the installed submenu opener for a child window. `MenuWindow` registers that opener
 *   in its constructor, so rows are only interactive inside a `MenuWindow`. A bare `MenuView`
 *   renders `menuview` rows disabled; calling `setSubmenuOpener()` after the menu is attached
 *   requires a re-render to update the rows.
 * - The child is a sibling overlay on the same layer element as its parent (paint order follows DOM
 *   order plus the overlay z-index counter). It is *not* added to `ViewManager._overlays`, and its
 *   lifetime belongs to the owning `MenuWindow`, which closes it before detaching itself.
 * - A nested menu reports ArrowLeft/Escape through the hook installed by `setParentHook()` (again by
 *   `MenuWindow`), which moves focus back to the owning row or closes the whole stack.
 *
 * Emitted Events:
 * - `select` -> `payloadTypeId: MenuView.Select.v1` -> `MenuViewSelectPayload`
 */
export class MenuView extends ViewBase {
    items: MenuViewEntry[];
    position: MenuViewPosition;
    onSelectCallback: MenuViewSelectCallback | null;

    private _selectedIndex: number;
    private _menuElement: HTMLDivElement | null;
    private _clickAwayHandler: ((event: MouseEvent) => void) | null;
    private _keydownHandler: ((event: KeyboardEvent) => void) | null;

    /** Installed by `MenuWindow`; without it `menuview` rows render disabled. */
    #submenuOpener: MenuViewSubmenuOpener | null;
    /** Hook a nested menu uses to hand ArrowLeft/Escape back to its owner. */
    #parentHook: MenuViewParentHook | null;
    /** Currently open side menu of this menu, if any. */
    #openSubmenu: {
        entry: MenuViewSubmenuEntry;
        row: HTMLElement;
        handle: MenuViewSubmenuHandle;
    } | null;
    #submenuOpenTimer: number | null;
    #submenuCloseTimer: number | null;
    /** Removes the hover listeners registered on the open child element. */
    #childHoverCleanup: (() => void) | null;

    /**
     * Create a Menu view.
     * @param {object} options - Configuration options
     * @param {Array} options.items - Menu items array
     * @param {object} options.position - { x, y } screen position
     * @param {Function} [options.onSelect=null] - Selection callback
     * @param {object} [options.i18nService=null] - I18n service for translations
     * @param {Function} [options.logger=null] - Logger function
     * @param {string} [options.title='Menu'] - Translation key or literal used as the `aria-label` of `role="menu"`
     */
    constructor({
        items = [],
        position = { x: 0, y: 0 },
        onSelect = null,
        i18nService = null,
        logger = null,
        title = 'Menu',
        ...rest
    }: MenuViewOptions = {}) {
        super({
            title,
            i18nService,
            logger,
            ...rest,
        });

        this.items = items;
        this.position = position;
        this.onSelectCallback = onSelect;
        this._selectedIndex = 0;
        this._menuElement = null;
        this._clickAwayHandler = null;
        this._keydownHandler = null;
        this.#submenuOpener = null;
        this.#parentHook = null;
        this.#openSubmenu = null;
        this.#submenuOpenTimer = null;
        this.#submenuCloseTimer = null;
        this.#childHoverCleanup = null;
    }

    /**
     * Register the opener for `menuview` rows.
     * Call before the menu is attached: rows are created at attach time and pick up the flag then.
     * @param {Function|null} opener - Opens the child menu of a row, or null to make rows inert.
     */
    setSubmenuOpener(opener: MenuViewSubmenuOpener | null): void {
        this.#submenuOpener = opener;
    }

    /**
     * Register the hook this (nested) menu calls when the user leaves it with ArrowLeft or Escape.
     * @param {Function|null} hook - Receives `'left'` or `'escape'`, or null to clear it.
     */
    setParentHook(hook: MenuViewParentHook | null): void {
        this.#parentHook = hook;
    }

    /**
     * Rows that keyboard navigation can reach, in DOM order.
     * The rendered rows are the single source of truth: an entry is skipped when it is disabled or
     * when it is a `menuview` row without an opener (the row is marked disabled then).
     * @returns {HTMLElement[]} Selectable row elements.
     */
    private _getSelectableRows(): HTMLElement[] {
        if (!this._menuElement) {
            return [];
        }

        const rows = this._menuElement.querySelectorAll('.menu__item:not(.menu__item--disabled)');
        return Array.from(rows).filter((row): row is HTMLElement => row instanceof HTMLElement);
    }

    /**
     * Entry rendered by `row`.
     * @param {HTMLElement} row - Rendered menu row.
     * @returns {object|null} The entry, or null when the row has no matching entry.
     */
    private _getEntryForRow(row: HTMLElement): MenuViewEntry | null {
        const index = Number(row.dataset.index);
        return Number.isInteger(index) ? (this.items[index] ?? null) : null;
    }

    /**
     * Focus the first selectable row.
     * @returns {boolean} True when a row received focus.
     */
    focusFirstItem(): boolean {
        const firstItem = this._getSelectableRows()[0];
        if (!firstItem) {
            return false;
        }

        firstItem.focus();
        return true;
    }

    /**
     * Focus the row of the given entry.
     * @param {object} entry - Entry whose row should receive focus.
     * @returns {boolean} True when the row was found and focused.
     */
    focusRowFor(entry: MenuViewEntry): boolean {
        const row = this._getRowElement(entry);
        if (!row || row.classList.contains('menu__item--disabled')) {
            return false;
        }

        this._selectedIndex = this._getSelectableItemIndex(this.items.indexOf(entry));
        this._updateSelection();
        this._scrollSelectedIntoView();
        row.focus();
        return true;
    }

    /**
     * Treat `item` as if it had been selected in this menu (bubbling from a child menu).
     * The owning callback and `select` event fire, and this menu detaches, which cascades the
     * child menu closed.
     * @param {object} item - Selected entry of the child menu.
     */
    acceptSelectionFromSubmenu(item: MenuViewActionEntry): void {
        this._selectItem(item);
    }

    /**
     * Compute preferred width/height of the menu by rendering a hidden copy to the DOM.
     * Useful for containers (like OverlayWindow) that need to size around the menu.
     * @returns {{ width: number, height: number }} preferred dimensions in pixels
     */
    getPreferredSize(): { width: number; height: number } {
        const tempMenu = document.createElement('div');
        tempMenu.className = 'menu';
        tempMenu.style.visibility = 'hidden';
        tempMenu.style.position = 'fixed';
        tempMenu.style.left = '-9999px';
        tempMenu.style.top = '0';

        this._appendRows(tempMenu);

        document.body.appendChild(tempMenu);
        const rect = tempMenu.getBoundingClientRect();
        document.body.removeChild(tempMenu);

        return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    }

    /**
     * Render the Menu.
     * @param {HTMLElement} container - Container element (typically document.body)
     */
    render(container: HTMLElement): void {
        this._menuElement = document.createElement('div');
        this._menuElement.className = 'menu';
        this._menuElement.setAttribute('role', 'menu');
        this._menuElement.setAttribute('aria-label', this.t(this.title));

        // Prevent browser's Menu on this menu
        this._menuElement.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Create menu items
        this._appendRows(this._menuElement);

        // Position menu (adjusted to stay in viewport)
        // If position is (0, 0), assume we're inside a positioned container (e.g., OverlayWindow)
        // and use static positioning instead of fixed
        if (this.position.x === 0 && this.position.y === 0) {
            // Let container handle positioning
            this._menuElement.style.position = 'static';
        } else {
            // Position at specific screen coordinates
            const adjustedPos = this._adjustPosition(this.position);
            this._menuElement.style.position = 'fixed';
            this._menuElement.style.left = `${adjustedPos.x}px`;
            this._menuElement.style.top = `${adjustedPos.y}px`;
            this._menuElement.style.zIndex = '10000';
        }

        container.appendChild(this._menuElement);
    }

    /**
     * Append all entry rows (and separators) to a menu container.
     * Single source of row markup for `render()`, `getPreferredSize()` and `_adjustPosition()`.
     * @param {HTMLElement} parent - Menu container to fill
     */
    private _appendRows(parent: HTMLElement): void {
        this.items.forEach((item, index) => {
            if (isSeparatorEntry(item)) {
                parent.appendChild(this._createSeparator());
            } else {
                parent.appendChild(this._createRow(item, index));
            }
        });
    }

    /**
     * Create a separator element.
     * @returns {HTMLDivElement} Separator row
     */
    private _createSeparator(): HTMLDivElement {
        const separator = document.createElement('div');
        separator.className = 'menu__separator';
        separator.setAttribute('role', 'separator');
        return separator;
    }

    /**
     * Create the row element for a non-separator entry.
     * @param {object} item - Entry definition
     * @param {number} index - Entry index in `items`
     * @returns {HTMLDivElement} Row element
     */
    private _createRow(
        item: MenuViewActionEntry | MenuViewSubmenuEntry,
        index: number
    ): HTMLDivElement {
        if (isSubmenuEntry(item)) {
            return this._createSubmenuItem(item, index);
        }
        return this._createMenuItem(item, index);
    }

    /**
     * Whether an entry's row is rendered disabled.
     * Separators count as disabled because they can never hold the keyboard selection.
     * @param {object} item - Entry definition
     * @returns {boolean} True when the row is not selectable
     */
    private _isEntryDisabled(item: MenuViewEntry): boolean {
        if (!isSelectableEntry(item)) {
            return true;
        }
        return item.disabled === true;
    }

    /**
     * Create a single menu item element.
     * @param {object} item - Menu item definition
     * @param {number} index - Item index
     * @returns {HTMLElement}
     */
    private _createMenuItem(item: MenuViewActionEntry, index: number): HTMLDivElement {
        const disabled = this._isEntryDisabled(item);
        const menuItem = document.createElement('div');
        menuItem.className = 'menu__item';
        menuItem.dataset.index = String(index);
        menuItem.dataset.itemId = item.id || '';
        menuItem.setAttribute('role', 'menuitem');
        menuItem.setAttribute('tabindex', disabled ? '-1' : '0');

        if (disabled) {
            menuItem.classList.add('menu__item--disabled');
            menuItem.setAttribute('aria-disabled', 'true');
        }

        // Checkbox indicator (optional, displayed before icon)
        if (item.checked !== undefined) {
            const checkbox = document.createElement('span');
            checkbox.className = 'menu__checkbox';
            checkbox.setAttribute('aria-hidden', 'true');
            checkbox.textContent = item.checked ? '☑' : '☐';
            menuItem.appendChild(checkbox);
        }

        // Icon (optional)
        this.#appendIcon(menuItem, item.icon);

        // Label (translated)
        const label = document.createElement('span');
        label.className = 'menu__label';
        label.textContent = this.t(item.label);
        menuItem.appendChild(label);

        // Keyboard shortcut (optional)
        if (item.shortcut) {
            const shortcut = document.createElement('span');
            shortcut.className = 'menu__shortcut';
            shortcut.textContent = item.shortcut;
            shortcut.setAttribute('aria-hidden', 'true');
            menuItem.appendChild(shortcut);
        }

        // Click handler
        if (!disabled) {
            menuItem.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                this._selectItem(item);
            });

            menuItem.addEventListener('mouseenter', () => {
                this._selectedIndex = this._getSelectableItemIndex(index);
                this._updateSelection();
                // Hovering an action row means the pointer left the owning row of an open child.
                this._scheduleSubmenuClose();
            });
        }

        return menuItem;
    }

    /**
     * Append an entry icon to a row element, choosing between inline SVG, image and text.
     * @param {HTMLElement} parent - Row element to append the icon to
     * @param {string} [icon] - Icon definition; omitted means "no icon"
     */
    #appendIcon(parent: HTMLElement, icon?: string): void {
        if (!icon) {
            return;
        }

        const iconElement = document.createElement('span');
        iconElement.className = 'menu__icon';
        iconElement.setAttribute('aria-hidden', 'true');

        if (icon.startsWith('<svg')) {
            iconElement.innerHTML = icon;
        } else if (IconProvider.isImageSource(icon)) {
            const img = document.createElement('img');
            img.className = 'menu__icon-img';
            img.src = icon;
            img.alt = '';
            iconElement.appendChild(img);
        } else {
            iconElement.textContent = icon;
        }

        parent.appendChild(iconElement);
    }

    /**
     * Create a row that opens a nested menu.
     * The row itself selects nothing; it asks the installed submenu opener for a child menu.
     * @param {object} item - `menuview` entry definition
     * @param {number} index - Entry index in `items`
     * @returns {HTMLDivElement} Row element
     */
    private _createSubmenuItem(item: MenuViewSubmenuEntry, index: number): HTMLDivElement {
        const disabled = this._isEntryDisabled(item) || !this.#submenuOpener;
        const menuItem = document.createElement('div');
        menuItem.className = 'menu__item menu__item--submenu';
        menuItem.dataset.index = String(index);
        menuItem.dataset.itemId = item.id || '';
        menuItem.setAttribute('role', 'menuitem');
        menuItem.setAttribute('aria-haspopup', 'menu');
        menuItem.setAttribute('aria-expanded', 'false');
        menuItem.setAttribute('tabindex', disabled ? '-1' : '0');

        if (disabled) {
            menuItem.classList.add('menu__item--disabled');
            menuItem.setAttribute('aria-disabled', 'true');
        }

        this.#appendIcon(menuItem, item.icon);

        const label = document.createElement('span');
        label.className = 'menu__label';
        label.textContent = this.t(item.label);
        menuItem.appendChild(label);

        const arrow = document.createElement('span');
        arrow.className = 'menu__submenu-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '▸';
        menuItem.appendChild(arrow);

        if (item.shortcut) {
            const shortcut = document.createElement('span');
            shortcut.className = 'menu__shortcut';
            shortcut.textContent = item.shortcut;
            shortcut.setAttribute('aria-hidden', 'true');
            menuItem.appendChild(shortcut);
        }

        if (!disabled) {
            menuItem.addEventListener('mouseenter', () => {
                this._selectedIndex = this._getSelectableItemIndex(index);
                this._updateSelection();
                this._scheduleSubmenuOpen(item, menuItem);
            });

            menuItem.addEventListener('mouseleave', () => {
                this._scheduleSubmenuClose();
            });

            menuItem.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                this._cancelSubmenuTimers();
                this._openSubmenu(item, menuItem);
            });
        }

        return menuItem;
    }

    /**
     * Find the rendered row of an entry.
     * @param {object} entry - Entry to locate.
     * @returns {HTMLElement|null} Row element, or null when the menu is not rendered.
     */
    private _getRowElement(entry: MenuViewEntry): HTMLElement | null {
        const index = this.items.indexOf(entry);
        const row = this._menuElement?.querySelector(`[data-index="${index}"]`);
        return row instanceof HTMLElement ? row : null;
    }

    /**
     * Open the child menu of a `menuview` row.
     * @param {object} entry - Submenu entry that owns the child menu.
     * @param {HTMLElement|null} row - Rendered row of that entry (anchor of the child).
     * @returns {boolean} True when a child menu is open for this entry after the call.
     */
    private _openSubmenu(entry: MenuViewSubmenuEntry, row: HTMLElement | null): boolean {
        this._cancelSubmenuTimers();

        if (this.#openSubmenu?.entry === entry) {
            return true;
        }

        if (!row) {
            return false;
        }

        this._closeSubmenu();

        const handle = this.#submenuOpener ? this.#submenuOpener(entry, row) : null;
        if (!handle) {
            return false;
        }

        this.#openSubmenu = { entry, row, handle };
        row.setAttribute('aria-expanded', 'true');
        this._watchChildHover(handle.element);
        // A child can close itself (click-away inside the parent); that must reset this row.
        handle.onClose?.(() => this._handleSubmenuClosed(entry));
        this._selectedIndex = this._getSelectableItemIndex(this.items.indexOf(entry));
        this._updateSelection();
        return true;
    }

    /**
     * Forget the open child of `entry` after the child closed itself.
     * Does nothing when the entry is not the one tracked as open (close already handled here).
     * @param {object} entry - Submenu entry whose child closed.
     */
    private _handleSubmenuClosed(entry: MenuViewSubmenuEntry): void {
        const current = this.#openSubmenu;
        if (!current || current.entry !== entry) {
            return;
        }

        this.#openSubmenu = null;
        this.#childHoverCleanup?.();
        this.#childHoverCleanup = null;
        current.row.setAttribute('aria-expanded', 'false');
        this._updateSelection();
    }

    /**
     * Close the currently open child menu, if any. Safe to call when nothing is open.
     */
    private _closeSubmenu(): void {
        this._cancelSubmenuTimers();

        const current = this.#openSubmenu;
        if (!current) {
            return;
        }

        this.#openSubmenu = null;
        this.#childHoverCleanup?.();
        this.#childHoverCleanup = null;
        current.row.setAttribute('aria-expanded', 'false');
        current.handle.close();
        this._updateSelection();
    }

    /**
     * Keep the child menu open while the pointer is inside it.
     * Entering the child cancels the pending close that the owning row's `mouseleave` scheduled;
     * leaving it schedules the close again.
     * @param {HTMLElement|null} element - Root element of the child overlay.
     */
    private _watchChildHover(element: HTMLElement | null): void {
        if (!element) {
            return;
        }

        const onEnter = () => this._cancelSubmenuTimers();
        const onLeave = () => this._scheduleSubmenuClose();

        element.addEventListener('mouseenter', onEnter);
        element.addEventListener('mouseleave', onLeave);
        this.#childHoverCleanup = () => {
            element.removeEventListener('mouseenter', onEnter);
            element.removeEventListener('mouseleave', onLeave);
        };
    }

    /**
     * Open the side menu of `entry` after the hover delay.
     * @param {object} entry - Submenu entry to open.
     * @param {HTMLElement} row - Rendered row of that entry.
     */
    private _scheduleSubmenuOpen(entry: MenuViewSubmenuEntry, row: HTMLElement): void {
        this._cancelSubmenuTimers();
        this.#submenuOpenTimer = window.setTimeout(() => {
            this.#submenuOpenTimer = null;
            this._openSubmenu(entry, row);
        }, SUBMENU_OPEN_DELAY_MS);
    }

    /**
     * Close the open side menu after the hover delay.
     * Cancels a pending open: the pointer moved on before the child appeared.
     */
    private _scheduleSubmenuClose(): void {
        this._cancelSubmenuOpenTimer();
        if (!this.#openSubmenu) {
            return;
        }

        this._cancelSubmenuCloseTimer();
        this.#submenuCloseTimer = window.setTimeout(() => {
            this.#submenuCloseTimer = null;
            this._closeSubmenu();
        }, SUBMENU_CLOSE_DELAY_MS);
    }

    /**
     * Cancel both pending submenu timers.
     */
    private _cancelSubmenuTimers(): void {
        this._cancelSubmenuOpenTimer();
        this._cancelSubmenuCloseTimer();
    }

    /**
     * Cancel a pending submenu open.
     */
    private _cancelSubmenuOpenTimer(): void {
        if (this.#submenuOpenTimer !== null) {
            window.clearTimeout(this.#submenuOpenTimer);
            this.#submenuOpenTimer = null;
        }
    }

    /**
     * Cancel a pending submenu close.
     */
    private _cancelSubmenuCloseTimer(): void {
        if (this.#submenuCloseTimer !== null) {
            window.clearTimeout(this.#submenuCloseTimer);
            this.#submenuCloseTimer = null;
        }
    }

    /**
     * Get the index in the selectable rows for a given item index.
     * @param {number} itemIndex - Original item index (including separators and disabled rows)
     * @returns {number} Index of the row among the selectable rows, or 0 when it is not selectable
     */
    private _getSelectableItemIndex(itemIndex: number): number {
        const position = this._getSelectableRows().findIndex(
            (row) => Number(row.dataset.index) === itemIndex
        );
        return position === -1 ? 0 : position;
    }

    /**
     * Adjust menu position to stay within viewport.
     * @param {object} pos - { x, y } screen position
     * @returns {object} Adjusted { x, y }
     */
    private _adjustPosition(pos: MenuViewPosition): MenuViewPosition {
        // Create temporary menu to measure size
        const tempMenu = document.createElement('div');
        tempMenu.className = 'menu';
        tempMenu.style.visibility = 'hidden';
        tempMenu.style.position = 'fixed';
        tempMenu.style.left = '-9999px';

        // Add items to measure
        this._appendRows(tempMenu);

        document.body.appendChild(tempMenu);
        const rect = tempMenu.getBoundingClientRect();
        document.body.removeChild(tempMenu);

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = pos.x;
        let y = pos.y;

        // Adjust horizontal position
        if (x + rect.width > viewportWidth) {
            x = Math.max(0, viewportWidth - rect.width - 10);
        }

        // Adjust vertical position
        if (y + rect.height > viewportHeight) {
            y = Math.max(0, viewportHeight - rect.height - 10);
        }

        return { x, y };
    }

    /**
     * Update visual selection state.
     */
    private _updateSelection(): void {
        if (!this._menuElement) {
            return;
        }

        const items = this._menuElement.querySelectorAll('.menu__item:not(.menu__item--disabled)');

        items.forEach((item, index) => {
            const isSelected = index === this._selectedIndex;
            item.classList.toggle('menu__item--selected', isSelected);
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }

    /**
     * Select an item and close menu.
     * @param {object} item - Selected item
     */
    private _selectItem(item: MenuViewActionEntry): void {
        this._log('menu-item-selected', { itemId: item.id });

        if (this.onSelectCallback) {
            this.onSelectCallback(item);
        }

        this._emit('select', new MenuViewSelectPayload({ item }));
        this.detach();
    }

    /**
     * Decide whether a key event belongs to this menu.
     * Nested menus share the `document` with their ancestors, so the guards below (and not
     * `stopPropagation()`, which does not stop same-node listeners) keep keys in one menu.
     * @param {KeyboardEvent} e - Keyboard event
     * @returns {boolean} True when this menu should act on the event
     */
    private _ownsKeyboardEvent(e: KeyboardEvent): boolean {
        const target = e.target;
        if (!(target instanceof Node)) {
            // Synthetic events without a target still drive the top-level menu.
            return !this.#parentHook;
        }

        // Keys pressed inside an open child belong to that child, never to this menu.
        const childElement = this.#openSubmenu?.handle.element ?? null;
        if (childElement && childElement.contains(target)) {
            return false;
        }

        // A nested menu is only driven while it holds the focus; otherwise the root menu handles it.
        if (this.#parentHook) {
            return this._menuElement?.contains(target) === true;
        }

        return true;
    }

    /**
     * Handle keyboard navigation.
     * @param {KeyboardEvent} e - Keyboard event
     */
    private _handleKeyDown(e: KeyboardEvent): void {
        if (!this._ownsKeyboardEvent(e)) {
            return;
        }

        const selectableItems = this._getSelectableRows();
        if (selectableItems.length === 0) {
            return;
        }

        const selectedRow = selectableItems[this._selectedIndex] ?? null;
        const selected = selectedRow ? this._getEntryForRow(selectedRow) : null;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this._selectedIndex = (this._selectedIndex + 1) % selectableItems.length;
                this._updateSelection();
                this._scrollSelectedIntoView();
                break;

            case 'ArrowUp':
                e.preventDefault();
                this._selectedIndex =
                    (this._selectedIndex - 1 + selectableItems.length) % selectableItems.length;
                this._updateSelection();
                this._scrollSelectedIntoView();
                break;

            case 'ArrowRight':
                e.preventDefault();
                e.stopPropagation();
                if (selected && isSubmenuEntry(selected)) {
                    // _openSubmenu() returns true also when the child is already open, so the key
                    // always ends with the focus inside the child.
                    if (this._openSubmenu(selected, this._getRowElement(selected))) {
                        this.#openSubmenu?.handle.focus?.();
                    }
                } else {
                    // ArrowRight never walks into a child that belongs to another row.
                    this._closeSubmenu();
                }
                break;

            case 'ArrowLeft':
                if (this.#parentHook) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.#parentHook('left');
                }
                break;

            case 'Enter':
            case ' ':
                e.preventDefault();
                if (selected && isSubmenuEntry(selected)) {
                    if (this._openSubmenu(selected, this._getRowElement(selected))) {
                        this.#openSubmenu?.handle.focus?.();
                    }
                } else if (selected && isActionEntry(selected)) {
                    this._selectItem(selected);
                }
                break;

            case 'Escape':
                e.preventDefault();
                if (this.#parentHook) {
                    // Close the whole stack, not just this child.
                    this.#parentHook('escape');
                } else {
                    this.detach();
                }
                break;

            case 'Home':
                e.preventDefault();
                this._selectedIndex = 0;
                this._updateSelection();
                this._scrollSelectedIntoView();
                break;

            case 'End':
                e.preventDefault();
                this._selectedIndex = selectableItems.length - 1;
                this._updateSelection();
                this._scrollSelectedIntoView();
                break;
        }
    }

    /**
     * Scroll selected item into view if needed.
     */
    private _scrollSelectedIntoView(): void {
        if (!this._menuElement) {
            return;
        }

        const selectedItem = this._menuElement.querySelector('.menu__item--selected');
        if (selectedItem && typeof selectedItem.scrollIntoView === 'function') {
            selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Handle click-away to close menu.
     * @param {MouseEvent} e - Mouse event
     */
    private _handleClickAway(e: MouseEvent): void {
        if (!this._menuElement || !(e.target instanceof Node)) {
            return;
        }

        if (this._menuElement.contains(e.target)) {
            return;
        }

        // The open child menu lives in a sibling overlay, so it is not inside this menu element.
        const childElement = this.#openSubmenu?.handle.element ?? null;
        if (childElement && childElement.contains(e.target)) {
            return;
        }

        this._log('menu-click-away');
        this.detach();
    }

    /**
     * After attach - setup event listeners.
     */
    afterAttach(): void {
        super.afterAttach();

        // Setup keyboard navigation
        this._keydownHandler = this._handleKeyDown.bind(this);
        document.addEventListener('keydown', this._keydownHandler, true);

        // Setup click-away handler (delay to avoid immediate trigger)
        this._clickAwayHandler = this._handleClickAway.bind(this);
        setTimeout(() => {
            if (this._clickAwayHandler) {
                document.addEventListener('mousedown', this._clickAwayHandler, true);
            }
        }, 0);

        // Initial selection state
        this._updateSelection();

        // Focus first item for keyboard navigation
        this.focusFirstItem();
    }

    /**
     * Before detach - cleanup event listeners.
     */
    beforeDetach(): void {
        // The child menu window is owned by this menu, so it must go with it.
        this._closeSubmenu();

        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler, true);
            this._keydownHandler = null;
        }

        if (this._clickAwayHandler) {
            document.removeEventListener('mousedown', this._clickAwayHandler, true);
            this._clickAwayHandler = null;
        }

        super.beforeDetach();
    }

    /**
     * Translate a key using i18n service.
     * @param {string} key - Translation key
     * @param {object} [params] - Optional parameters for interpolation
     * @returns {string} Translated string
     */
    t(key: string, params?: Record<string, unknown>): string {
        if (this._i18nService && typeof this._i18nService.t === 'function') {
            return this._i18nService.t(key, params);
        }
        return key;
    }
}
