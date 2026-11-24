// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Reusable searchable Material Design Icons picker control.
 *
 * One labelled text field plus an anchored popover: the field doubles as the search filter and
 * as the value (`mdi:<name>`), the popover shows a paged grid of glyphs ranked by
 * `js/data/mdi-icons.ts` (names *and* MDI aliases), and the footer reports
 * "300 of 7447 icons" with a `Show more`/`Clear` pair.
 *
 * Free text is never rejected: a value outside the bundled MDI release keeps its text and
 * only produces a hint. The index loads lazily on first open, and a failed load degrades to a
 * plain text field.
 *
 * The popover lives either in `document.body` (`portal: 'body'`, for settings panels) or inside
 * the control wrapper (`portal: 'inline'`, for hosts such as the node editor whose click-away
 * handler closes the owner for any click outside it). The picker surface itself — popover,
 * grid, tiles, glyphs, footer and hint — reuses the `.icon-control__*` classes from
 * `styles/standard/controls/icon-control.css`; only the labelled input row and the two portal
 * modes are host-level styling.
 *
 * A host that already renders its own field mounts the picker with `render(wrapper,
 * { input })`: the picker then adopts that field as its filter, adds the popover and the
 * keyboard/blur map, and reports the end of the session through `onDismiss` instead of
 * committing — the node editor's `IconControlUi` is such a host.
 *
 * @module views/controls/mdi-icon-picker-control
 */

import { ViewBase } from '../view-base.js';
import {
    EMPTY_MDI_INDEX,
    MDI_SEARCH_DEFAULT_LIMIT,
    MDI_SET,
    formatIconValue,
    getMdiIndexState,
    getMdiIndexVersion,
    loadMdiIconIndex,
    mdiGlyphFromCodepoint,
    parseIconValue,
    preloadMdiIconIndex,
    resolveMdiGlyph,
    resolveMdiIconName,
    searchMdiIconPage,
} from '../../data/mdi-icons.js';
import type { MdiIconIndex, MdiSearchHit } from '../../data/mdi-icons.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;

/** Which DOM parent owns the picker popover. */
export type MdiIconPickerPortal = 'body' | 'inline';

/** Callback invoked whenever the picker value changes. */
export type MdiIconPickerChangeHandler = (value: string) => void;

/** Callback invoked when a host-owned editing session ends without a picker commit. */
export type MdiIconPickerDismissHandler = () => void;

/** Translation lookup for the picker strings; `null` uses the view's i18n service. */
export type MdiIconPickerTranslate = (key: string, params?: Record<string, unknown>) => string;

export interface MdiIconPickerControlOptions {
    /** Visible title rendered to the left of the field; omitted leaves the field title-less. */
    label?: string;
    /** Initial value, e.g. `mdi:thermometer` or free text. */
    value?: string;
    /** Placeholder shown while the filter is empty; defaults to the picker hint string. */
    placeholder?: string;
    disabled?: boolean;
    /** `body` (default) renders the popover as a fixed layer; `inline` keeps it in the wrapper. */
    portal?: MdiIconPickerPortal;
    onChange?: MdiIconPickerChangeHandler | null;
    /**
     * Called instead of committing when the editing session ends (Enter, Escape on a closed
     * popover, focus-out). A host that owns the field and its commit path sets this; the picker
     * then only reports that the user is done. `null` (default) commits the typed value.
     */
    onDismiss?: MdiIconPickerDismissHandler | null;
    /** Translation override for the picker strings; defaults to the i18n service of the view. */
    translate?: MdiIconPickerTranslate | null;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerLike | null;
}

/** Host-specific mounting of the picker. */
export interface MdiIconPickerRenderOptions {
    /**
     * Field the host rendered itself; the picker uses it as its search field and mounts the
     * popover into `container`. Omitted → the picker renders its own labelled row.
     */
    input?: HTMLInputElement | null;
}

/** Popover height ceiling in pixels; the grid scrolls beyond it. */
const POPOVER_MAX_HEIGHT = 320;

/** Space kept between the popover and the viewport edge. */
const VIEWPORT_MARGIN = 8;

/** Room needed below the field before the popover flips above it. */
const POPOVER_MIN_HEIGHT = 140;

/** Gap between the field and the popover. */
const POPOVER_GAP = 4;

/**
 * Searchable MDI icon picker: a labelled text field with an anchored tile grid.
 *
 * Extends ViewBase for the shared lifecycle, i18n and logging plumbing.
 */
export class MdiIconPickerControl extends ViewBase {
    private _label: string;
    private _value: string;
    private _placeholder: string;
    private _portal: MdiIconPickerPortal;
    private _disabled: boolean;
    private _onChange: MdiIconPickerChangeHandler | null;
    private _onDismiss: MdiIconPickerDismissHandler | null;
    private _translateOption: MdiIconPickerTranslate | null;

    private _rootElement: HTMLElement | null;
    private _inputElement: HTMLInputElement | null;
    private _popoverElement: HTMLDivElement | null;
    private _gridElement: HTMLDivElement | null;
    private _statusElement: HTMLSpanElement | null;
    private _hintElement: HTMLDivElement | null;
    private _previewElement: HTMLSpanElement | null;
    private _clearButton: HTMLButtonElement | null;
    private _moreButton: HTMLButtonElement | null;

    private _tiles: HTMLButtonElement[];
    private _hits: MdiSearchHit[];
    private _query: string;
    private _total: number;
    private _activeIndex: number;
    private _activeFromKeys: boolean;
    private _index: MdiIconIndex;
    private _indexRequested: boolean;
    private _isOpen: boolean;
    private _hostField: boolean;

    private _boundHandleClickOutside: (event: MouseEvent) => void;
    private _boundHandleKeyDown: (event: KeyboardEvent) => void;
    private _boundHandleResize: () => void;
    private _boundHandleInputBlur: (event: FocusEvent) => void;
    private _boundHandleOpen: () => void;
    private _boundHandleInput: () => void;

    constructor({
        label = '',
        value = '',
        placeholder = '',
        disabled = false,
        portal = 'body',
        onChange = null,
        onDismiss = null,
        translate = null,
        i18nService = null,
        logger = null,
    }: MdiIconPickerControlOptions = {}) {
        super({
            title: 'MDI Icon Picker',
            i18nService,
            logger,
        });

        this._label = label;
        this._value = value == null ? '' : String(value);
        this._placeholder = placeholder;
        this._portal = portal === 'inline' ? 'inline' : 'body';
        this._disabled = !!disabled;
        this._onChange = onChange;
        this._onDismiss = onDismiss;
        this._translateOption = translate;

        this._rootElement = null;
        this._inputElement = null;
        this._popoverElement = null;
        this._gridElement = null;
        this._statusElement = null;
        this._hintElement = null;
        this._previewElement = null;
        this._clearButton = null;
        this._moreButton = null;

        this._tiles = [];
        this._hits = [];
        this._query = '';
        this._total = 0;
        this._activeIndex = 0;
        this._activeFromKeys = false;
        this._index = EMPTY_MDI_INDEX;
        this._indexRequested = false;
        this._isOpen = false;
        this._hostField = false;

        this._boundHandleClickOutside = (event: MouseEvent) => this._handleClickOutside(event);
        this._boundHandleKeyDown = (event: KeyboardEvent) => this._handleKeyDown(event);
        this._boundHandleResize = () => {
            if (!this._isOpen) {
                return;
            }
            this._positionPopover();
        };
        this._boundHandleInputBlur = (event: FocusEvent) => this._handleInputBlur(event);
        this._boundHandleOpen = () => this.open();
        this._boundHandleInput = () => {
            this.open();
            this._renderResults();
        };
    }

    /**
     * Render the picker into a host element.
     *
     * Without options the control renders its own labelled row and wires its own field; with
     * `options.input` it adopts a field the host already rendered and only adds the combobox
     * semantics, the popover and the keyboard/blur map. The host keeps ownership of the markup,
     * the placeholder and the value, which is what a node control editor needs.
     * @param container - Host element that receives the control wrapper, or the host wrapper.
     * @param options - Host mounting options; `input` selects the host-field mode.
     */
    render(container: HTMLElement, options: MdiIconPickerRenderOptions = {}): void {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('MdiIconPickerControl.render requires a container HTMLElement.');
        }

        const { input: hostInput = null } = options;
        if (hostInput) {
            this._renderHostField(container, hostInput);
            return;
        }

        this._hostField = false;
        const root = document.createElement('div');
        root.className = 'mdi-icon-picker icon-control';
        this._rootElement = root;

        if (this._label) {
            const label = document.createElement('span');
            label.className = 'mdi-icon-picker__label';
            label.id = `${this.id}-label`;
            label.textContent = this._text(this._label);
            root.appendChild(label);
            root.classList.add('mdi-icon-picker--labeled');
        }

        const input = this._renderInput();

        // The field and the glyph preview share a wrapper so the preview can sit inside the
        // input's right edge without the host needing to position it.
        const field = document.createElement('div');
        field.className = 'mdi-icon-picker__field';
        field.appendChild(input);

        const preview = document.createElement('span');
        preview.className = 'mdi-icon-picker__preview';
        preview.setAttribute('aria-hidden', 'true');
        preview.hidden = true;
        this._previewElement = preview;
        field.appendChild(preview);

        root.appendChild(field);

        const popover = this._renderPopover();
        if (this._portal === 'inline') {
            root.appendChild(popover);
        } else {
            document.body.appendChild(popover);
        }

        container.appendChild(root);

        this._applyDisabledState();
        this._renderResults();
        this._adoptLoadedIndex();
    }

    /**
     * Current value; free text and foreign icon sets are returned unchanged.
     * @returns The stored value.
     */
    getValue(): string {
        return this._value;
    }

    /**
     * Replace the value from outside (undo, inspector, host refresh).
     * @param value - New value; `null`/`undefined` clears the field.
     */
    setValue(value: string | null | undefined): void {
        this._value = value == null ? '' : String(value);
        if (this._inputElement) {
            this._inputElement.value = this._value;
        }
        this._renderResults();
    }

    /**
     * Enable or disable the field; disabling closes an open popover.
     * @param disabled - Whether the control accepts input.
     */
    setDisabled(disabled: boolean): void {
        this._disabled = !!disabled;
        if (this._disabled) {
            this.close();
        }
        this._applyDisabledState();
    }

    /**
     * Register the change callback after construction.
     * @param callback - Receives every committed value.
     */
    onChange(callback: MdiIconPickerChangeHandler | null): void {
        this._onChange = callback;
    }

    /**
     * Reveal the popover and start the lazy index load.
     */
    open(): void {
        if (this._disabled || this._isOpen || !this._rootElement || !this._popoverElement) {
            return;
        }

        preloadMdiIconIndex();
        this._ensureIndex();

        this._isOpen = true;
        this._renderResults();
        this._popoverElement.hidden = false;
        this._inputElement?.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', this._boundHandleClickOutside, true);
        if (typeof globalThis.addEventListener === 'function') {
            globalThis.addEventListener('resize', this._boundHandleResize);
        }
        this._positionPopover();
    }

    /**
     * Whether the popover is currently shown; a host uses it to mirror the editor state.
     * @returns `true` while the tile grid is visible.
     */
    get isOpen(): boolean {
        return this._isOpen;
    }

    /**
     * Hide the popover. Rendered tiles are kept, so re-opening shows the same page.
     */
    close(): void {
        if (!this._isOpen) {
            return;
        }

        this._isOpen = false;
        if (this._popoverElement) {
            this._popoverElement.hidden = true;
        }
        this._inputElement?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', this._boundHandleClickOutside, true);
        if (typeof globalThis.removeEventListener === 'function') {
            globalThis.removeEventListener('resize', this._boundHandleResize);
        }
    }

    /**
     * Release a host-field mount together with its listeners.
     *
     * Host-field mode renders into the host's own wrapper, so the inherited `detach()` —
     * which empties its container — would wipe the host's label and field. Everything the
     * picker added is removed by `beforeDetach()`; nothing else needs unwinding, because a
     * host mount never registers a container.
     */
    detach(): void {
        if (this._hostField) {
            this.beforeDetach();
            return;
        }

        super.detach();
    }

    /**
     * Remove the portal popover and every listener before the base teardown empties the host.
     */
    beforeDetach(): void {
        this.close();
        this._inputElement?.removeEventListener('focus', this._boundHandleOpen);
        this._inputElement?.removeEventListener('click', this._boundHandleOpen);
        this._inputElement?.removeEventListener('input', this._boundHandleInput);
        this._inputElement?.removeEventListener('blur', this._boundHandleInputBlur);
        this._inputElement?.removeEventListener('keydown', this._boundHandleKeyDown);
        this._popoverElement?.removeEventListener('keydown', this._boundHandleKeyDown);

        if (this._popoverElement?.parentNode) {
            this._popoverElement.parentNode.removeChild(this._popoverElement);
        }

        this._rootElement = null;
        this._inputElement = null;
        this._popoverElement = null;
        this._gridElement = null;
        this._statusElement = null;
        this._hintElement = null;
        this._previewElement = null;
        this._clearButton = null;
        this._moreButton = null;
        this._tiles = [];
        this._hits = [];
        this._query = '';
        this._total = 0;
        this._activeIndex = 0;
        this._activeFromKeys = false;
        this._hostField = false;

        super.beforeDetach();
    }

    /**
     * Build the labelled text field that doubles as the search filter.
     * @returns The input element.
     */
    private _renderInput(): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mdi-icon-picker__input';
        input.id = `${this.id}-input`;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = this._placeholder || this._text('controls.iconPicker.hint');
        input.value = this._value;
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', `${this.id}-popover`);
        if (this._label) {
            input.setAttribute('aria-labelledby', `${this.id}-label`);
        }

        input.addEventListener('focus', this._boundHandleOpen);
        input.addEventListener('click', this._boundHandleOpen);
        input.addEventListener('input', this._boundHandleInput);
        input.addEventListener('blur', this._boundHandleInputBlur);
        input.addEventListener('keydown', this._boundHandleKeyDown);

        this._inputElement = input;
        return input;
    }

    /**
     * Adopt a field the host rendered and mount the popover into the host wrapper.
     *
     * The wrapper becomes the popover's containing block and the `'inline'` portal parent, so a
     * click inside the popover stays inside the host's editor — hosts such as the node editor
     * close themselves for any click outside them. The host keeps its own `input` listener for
     * live value tracking; the picker adds the open/filter/blur/keyboard map on top.
     * @param container - Host wrapper that becomes the picker's root.
     * @param input - Host-rendered text field that doubles as the search filter.
     */
    private _renderHostField(container: HTMLElement, input: HTMLInputElement): void {
        this._hostField = true;
        this._rootElement = container;
        this._inputElement = input;
        this._value = input.value;

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-expanded', 'false');

        const popover = this._renderPopover();
        container.appendChild(popover);
        input.setAttribute('aria-controls', popover.id);

        input.addEventListener('focus', this._boundHandleOpen);
        input.addEventListener('click', this._boundHandleOpen);
        input.addEventListener('input', this._boundHandleInput);
        input.addEventListener('blur', this._boundHandleInputBlur);
        input.addEventListener('keydown', this._boundHandleKeyDown);

        this._renderResults();
    }

    /**
     * Build the popover surface: hint row, tile grid, footer and the footer's actions.
     * @returns The popover element, still hidden.
     */
    private _renderPopover(): HTMLDivElement {
        const popover = document.createElement('div');
        popover.className = 'icon-control__popover mdi-icon-picker__popover';
        popover.id = `${this.id}-popover`;
        popover.hidden = true;
        popover.setAttribute('role', 'listbox');
        popover.setAttribute('aria-label', this._text('controls.iconPicker.hint'));

        const hint = document.createElement('div');
        hint.className = 'icon-control__hint';
        hint.hidden = true;
        popover.appendChild(hint);

        const grid = document.createElement('div');
        grid.className = 'icon-control__grid';
        popover.appendChild(grid);

        const footer = document.createElement('div');
        footer.className = 'icon-control__footer';

        const status = document.createElement('span');
        status.className = 'icon-control__status';
        footer.appendChild(status);

        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'icon-control__more';
        more.hidden = true;
        more.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            this._renderResults({ append: true });
        });
        footer.appendChild(more);

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'icon-control__clear';
        clear.hidden = true;
        clear.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            this._applyValue('');
            this.open();
        });
        footer.appendChild(clear);

        popover.appendChild(footer);

        // Keep the field focused: a blur would close the popover before the tile click lands.
        popover.addEventListener('mousedown', (event: MouseEvent) => event.preventDefault());
        popover.addEventListener('keydown', this._boundHandleKeyDown);

        this._popoverElement = popover;
        this._gridElement = grid;
        this._statusElement = status;
        this._hintElement = hint;
        this._clearButton = clear;
        this._moreButton = more;

        return popover;
    }

    /**
     * Mirror the disabled flag onto the field and the wrapper class.
     */
    private _applyDisabledState(): void {
        if (this._inputElement) {
            this._inputElement.disabled = this._disabled;
        }
        this._rootElement?.classList.toggle('mdi-icon-picker--disabled', this._disabled);
    }

    /**
     * Load the index once per control, then refresh the grid with the real entries.
     *
     * The load starts on first open and is cached by the data module, so every later picker
     * finds the index already loaded. A failed load leaves the field usable as plain text.
     */
    private _ensureIndex(): void {
        if (this._indexRequested || this._index.version) {
            return;
        }

        this._indexRequested = true;
        void loadMdiIconIndex().then((index) => {
            this._index = index;
            this._renderResults();
        });
    }

    /**
     * Adopt an index that a previous picker already loaded, without triggering a fetch.
     *
     * The preview glyph needs the index even when this picker is rendered but never opened;
     * a cached, ready index resolves that immediately. A fresh session has no cached index,
     * so this stays a no-op and the preview appears after the first open.
     */
    private _adoptLoadedIndex(): void {
        if (this._index.version || getMdiIndexState() !== 'ready') {
            return;
        }

        void loadMdiIconIndex().then((index) => {
            this._index = index;
            this._updatePreview();
        });
    }

    /**
     * Mirror the stored value into the field's glyph preview.
     *
     * Only a resolvable MDI value paints a glyph; free text, a foreign set or an empty value
     * hide the preview so the field keeps showing the plain text.
     */
    private _updatePreview(): void {
        if (!this._previewElement) {
            return;
        }

        const glyph = resolveMdiGlyph(this._value, this._index);
        this._previewElement.textContent = glyph ?? '';
        this._previewElement.hidden = !glyph;
    }

    /**
     * Rebuild the tile grid for the current input text.
     *
     * The input doubles as the filter, so typing narrows the grid; the status line keeps the
     * user oriented ("300 of 7447") and `Show more` pages through the remaining hits, so every
     * bundled icon is reachable without rendering thousands of tiles at once. While the index
     * is loading or after it failed, the grid stays empty and the status line explains why —
     * free text is always allowed, the picker is advisory.
     * @param options - `append` continues the list of the query that is currently rendered.
     */
    private _renderResults(options: { append?: boolean } = {}): void {
        this._updatePreview();

        const grid = this._gridElement;
        const status = this._statusElement;
        if (!grid || !status) {
            return;
        }

        const currentValue = this._value;
        const query = this._inputElement ? this._inputElement.value : currentValue;

        this._updateClearButton(currentValue);
        this._updateHint(currentValue);

        const state = getMdiIndexState();
        if (state === 'failed') {
            this._resetResults();
            status.textContent = this._text('controls.iconPicker.unavailable');
            return;
        }

        if (state !== 'ready') {
            this._resetResults();
            status.textContent = this._text('controls.iconPicker.loading');
            return;
        }

        // Paging only ever continues the list the tiles currently show.
        const append = Boolean(options.append) && query === this._query && this._hits.length > 0;
        if (!append) {
            this._resetResults();
        }

        const page = searchMdiIconPage(this._index, query, {
            limit: MDI_SEARCH_DEFAULT_LIMIT,
            offset: this._hits.length,
        });
        const selectedName = this._selectedName(currentValue);

        this._query = query;
        this._total = page.total;

        const fragment = document.createDocumentFragment();
        page.hits.forEach((hit) => {
            const index = this._hits.length;
            const tile = this._createTile(hit, index === this._activeIndex, hit.name === selectedName);
            fragment.appendChild(tile);
            this._hits.push(hit);
            this._tiles.push(tile);
        });

        if (append) {
            grid.appendChild(fragment);
        } else {
            grid.replaceChildren(fragment);
        }

        this._updateMoreButton();

        if (!this._hits.length) {
            status.textContent = this._text('controls.iconPicker.noMatches', {
                query: query.trim(),
            });
            return;
        }

        status.textContent = this._text('controls.iconPicker.count', {
            shown: this._hits.length,
            total: this._total,
        });
    }

    /**
     * Drop the rendered results together with the paging state.
     */
    private _resetResults(): void {
        this._gridElement?.replaceChildren();
        this._hits = [];
        this._tiles = [];
        this._query = '';
        this._total = 0;
        this._activeIndex = 0;
        this._activeFromKeys = false;
        this._updateMoreButton();
    }

    /**
     * Offer the next page while the rendered query still has hits the grid does not show.
     */
    private _updateMoreButton(): void {
        if (!this._moreButton) {
            return;
        }

        const remaining = Math.max(this._total - this._hits.length, 0);
        this._moreButton.hidden = remaining === 0;
        if (remaining > 0) {
            this._moreButton.textContent = this._text('controls.iconPicker.showMore', {
                count: Math.min(remaining, MDI_SEARCH_DEFAULT_LIMIT),
            });
        }
    }

    /**
     * Resolve the current value to the canonical MDI name, for tile highlighting.
     * @param value - The current control value.
     * @returns The canonical icon name, or `''` for free text/foreign sets.
     */
    private _selectedName(value: string): string {
        const parsed = parseIconValue(value);
        if (!parsed || parsed.set !== MDI_SET) {
            return '';
        }

        return resolveMdiIconName(this._index, parsed.name) ?? '';
    }

    /**
     * Create one clickable tile.
     * @param hit - Search hit to render.
     * @param isActive - Whether the tile currently owns keyboard focus in the grid.
     * @param isSelected - Whether the tile matches the current control value.
     * @returns The tile button.
     */
    private _createTile(
        hit: MdiSearchHit,
        isActive: boolean,
        isSelected: boolean
    ): HTMLButtonElement {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'icon-control__tile';
        tile.setAttribute('role', 'option');
        tile.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tile.tabIndex = isActive ? 0 : -1;
        tile.dataset.iconName = hit.name;

        const label = hit.alias ? `mdi:${hit.name} (alias: ${hit.alias})` : `mdi:${hit.name}`;
        tile.title = label;
        tile.setAttribute('aria-label', label);

        const glyph = document.createElement('span');
        glyph.className = 'icon-control__glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = mdiGlyphFromCodepoint(hit.codepoint);
        tile.appendChild(glyph);

        tile.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            this._selectHit(hit);
        });

        return tile;
    }

    /**
     * Show the "Clear" affordance only for non-empty values.
     * @param value - The current control value.
     */
    private _updateClearButton(value: string): void {
        if (!this._clearButton) {
            return;
        }

        this._clearButton.hidden = !value.trim();
    }

    /**
     * Warn about an MDI name the bundled release does not know — the value is still kept.
     * @param value - The current control value.
     */
    private _updateHint(value: string): void {
        if (!this._hintElement) {
            return;
        }

        const parsed = parseIconValue(value);
        const isMdiValue = Boolean(parsed) && parsed!.set === MDI_SET;
        const version = getMdiIndexVersion() || this._index.version;
        const isUnknown =
            isMdiValue &&
            Boolean(version) &&
            Boolean(this._index.version) &&
            !resolveMdiIconName(this._index, parsed!.name);

        this._hintElement.hidden = !isUnknown;
        this._hintElement.textContent = isUnknown
            ? this._text('controls.iconPicker.unknown', { version })
            : '';
    }

    /**
     * Move the keyboard selection inside the grid.
     *
     * Touching the arrow keys makes the highlight a choice, so `Enter` takes the highlighted
     * tile instead of the typed text. A grid with a single match offers nothing to choose, so
     * there the typed text stays in charge.
     * @param delta - `1` for the next tile, `-1` for the previous one.
     */
    private _moveActive(delta: number): void {
        if (!this._tiles.length) {
            return;
        }

        const next = Math.min(Math.max(this._activeIndex + delta, 0), this._tiles.length - 1);
        this._activeFromKeys = this._tiles.length > 1;
        this._setActiveIndex(next);
    }

    /**
     * Mark one tile as the roving-tabindex owner and scroll it into view.
     * @param index - Index of the tile to activate.
     */
    private _setActiveIndex(index: number): void {
        this._activeIndex = index;
        this._tiles.forEach((tile, tileIndex) => {
            tile.tabIndex = tileIndex === index ? 0 : -1;
        });

        const activeTile = this._tiles[index];
        if (activeTile && typeof activeTile.scrollIntoView === 'function') {
            activeTile.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Push the typed value into the control, but only when it actually changed.
     */
    private _commitInputValue(): void {
        if (!this._inputElement) {
            return;
        }

        const next = this._inputElement.value;
        if (next === this._value) {
            return;
        }

        this._notifyChange(next);
        this._renderResults();
    }

    /**
     * Select an icon from the grid: set `mdi:<name>` and keep the popover open.
     * @param hit - The clicked or arrow-keyed search hit.
     */
    private _selectHit(hit: MdiSearchHit | undefined): void {
        if (!hit) {
            return;
        }

        this._applyValue(formatIconValue(hit.name));
        this.open();
    }

    /**
     * Write a value into the field, the control and the grid.
     * @param value - The new control value.
     */
    private _applyValue(value: string): void {
        if (this._inputElement) {
            this._inputElement.value = value;
        }

        this._notifyChange(value);
        this._renderResults();
    }

    /**
     * Store a committed value and notify the host.
     * @param value - The new control value.
     */
    private _notifyChange(value: string): void {
        this._value = value;
        if (typeof this._onChange === 'function') {
            this._onChange(value);
        }
    }

    /**
     * Anchor the popover to the field: below it by default, above it when there is no room
     * left below, and shifted left when it would overflow the viewport.
     *
     * `portal: 'inline'` positions it against the control wrapper (the containing block);
     * `portal: 'body'` uses fixed viewport coordinates taken from the field.
     */
    private _positionPopover(): void {
        const popover = this._popoverElement;
        const root = this._rootElement;
        const input = this._inputElement;
        if (!popover || !root || !input || popover.hidden) {
            return;
        }

        popover.style.left = '0px';
        popover.style.top = 'auto';
        popover.style.bottom = 'auto';
        popover.style.maxHeight = '';

        const inputRect = input.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const viewportWidth = Number(globalThis.innerWidth) || 0;
        const viewportHeight = Number(globalThis.innerHeight) || 0;
        const popoverWidth = popover.offsetWidth || rootRect.width || 328;
        const anchorHeight = rootRect.height || inputRect.height || 0;
        const anchorTop = this._portal === 'inline' ? rootRect.top : inputRect.top;
        const anchorBottom = this._portal === 'inline' ? rootRect.bottom : inputRect.bottom;
        const anchorLeft = this._portal === 'inline' ? 0 : inputRect.left;

        const spaceBelow = viewportHeight
            ? viewportHeight - anchorBottom - VIEWPORT_MARGIN
            : POPOVER_MAX_HEIGHT;
        const spaceAbove = viewportHeight ? anchorTop - VIEWPORT_MARGIN : POPOVER_MAX_HEIGHT;
        const openAbove = spaceBelow < POPOVER_MIN_HEIGHT && spaceAbove > spaceBelow;

        if (this._portal === 'inline') {
            popover.style.position = 'absolute';
            popover.style.left = '0px';
        } else {
            popover.style.position = 'fixed';
            popover.style.left = `${anchorLeft}px`;
        }

        if (openAbove) {
            popover.style.top = 'auto';
            // Inline anchors against the wrapper (absolute); body anchors against the viewport
            // (fixed), so "above" is the field's top measured from the viewport bottom.
            popover.style.bottom =
                this._portal === 'inline'
                    ? `${anchorHeight + POPOVER_GAP}px`
                    : `${viewportHeight - anchorTop + POPOVER_GAP}px`;
        } else {
            popover.style.bottom = 'auto';
            // Inline: below the wrapper. Body: below the field, in viewport coordinates.
            popover.style.top =
                this._portal === 'inline'
                    ? `${anchorHeight + POPOVER_GAP}px`
                    : `${anchorBottom + POPOVER_GAP}px`;
        }

        const available = openAbove ? spaceAbove : spaceBelow;
        const height = Math.max(POPOVER_MIN_HEIGHT, Math.min(POPOVER_MAX_HEIGHT, available));
        popover.style.maxHeight = `${height}px`;

        if (
            this._portal === 'body' &&
            viewportWidth &&
            anchorLeft + popoverWidth > viewportWidth - VIEWPORT_MARGIN
        ) {
            const overflow = anchorLeft + popoverWidth - (viewportWidth - VIEWPORT_MARGIN);
            popover.style.left = `${Math.max(VIEWPORT_MARGIN, anchorLeft - overflow)}px`;
        }
    }

    /**
     * Resolve one picker string.
     *
     * A host that renders its own field passes `translate` and keeps its own locale wiring;
     * otherwise the view's i18n service is used, exactly like any other view.
     * @param key - Locale key, e.g. `controls.iconPicker.hint`.
     * @param params - Interpolation parameters.
     * @returns The localized string.
     */
    private _text(key: string, params: Record<string, unknown> = {}): string {
        if (typeof this._translateOption === 'function') {
            return this._translateOption(key, params);
        }

        return this.t(key, params);
    }

    /**
     * Close the popover when a click lands outside both the field row and the popover.
     * @param event - Document-level click.
     */
    private _handleClickOutside(event: MouseEvent): void {
        if (this._isInside(event.target as Node | null)) {
            return;
        }

        this.close();
    }

    /**
     * Commit the typed value and close, unless focus moved into the popover.
     *
     * A host that owns the field (`onDismiss`) is only told that the session ended: it
     * already tracks every keystroke and decides what closing means.
     * @param event - Blur event of the input.
     */
    private _handleInputBlur(event: FocusEvent): void {
        const related = event.relatedTarget as Node | null;
        if (related && this._isInside(related)) {
            return;
        }

        this.close();

        if (typeof this._onDismiss === 'function') {
            this._onDismiss();
            return;
        }

        this._commitInputValue();
    }

    /**
     * Test whether a node belongs to the field row or to the (possibly portalled) popover.
     * @param node - Event target or focus destination.
     * @returns `true` when the node is part of this control.
     */
    private _isInside(node: Node | null): boolean {
        if (!node) {
            return false;
        }

        return Boolean(this._rootElement?.contains(node) || this._popoverElement?.contains(node));
    }

    /**
     * Keyboard behaviour: arrow-key navigation inside the grid, Enter commits the typed string
     * (or the tile the arrow keys reached), Escape closes the popover.
     *
     * The handler is attached to both the field and the popover, so tiles reached with `Tab`
     * keep the same keyboard map. With `onDismiss` the host owns the end of the session: Enter
     * and a second Escape report it instead of committing, so a host with its own field and
     * commit path keeps a single source of truth.
     * @param event - Keydown event of the field or the popover.
     */
    private _handleKeyDown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'Escape':
                if (this._isOpen) {
                    event.preventDefault();
                    this.close();
                    return;
                }
                if (typeof this._onDismiss === 'function') {
                    this._onDismiss();
                }
                return;
            case 'ArrowDown':
            case 'ArrowRight':
                event.preventDefault();
                this.open();
                this._moveActive(1);
                return;
            case 'ArrowUp':
            case 'ArrowLeft':
                event.preventDefault();
                this.open();
                this._moveActive(-1);
                return;
            case 'Enter': {
                event.preventDefault();

                // Enter only takes over the highlighted tile when the arrow keys browsed a
                // grid with alternatives — otherwise it would silently replace the string
                // the user just typed with the first match.
                if (this._isOpen && this._activeFromKeys) {
                    this._selectHit(this._hits[this._activeIndex]);
                }

                this.close();

                if (typeof this._onDismiss === 'function') {
                    this._onDismiss();
                    return;
                }

                this._commitInputValue();
                return;
            }
            default:
                return;
        }
    }
}

