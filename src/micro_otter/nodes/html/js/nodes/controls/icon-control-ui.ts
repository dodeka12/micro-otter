// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * IconControlUi: Text input for icon values with a searchable MDI picker.
 *
 * Features:
 * - Behaves like `TextControlUi` everywhere outside the editor: same layout metrics and
 *   free text as the value (only a tile click formats `mdi:<name>`)
 * - Paints the glyph of a resolvable value in front of the value text in the node body, so
 *   an icon control reads as an icon without opening the editor
 * - Opens an anchored popover while editing: a tile grid filtered by the input itself,
 *   ranked by `js/data/mdi-icons.ts` (names *and* MDI aliases)
 * - Never rejects a value: an icon outside the bundled MDI release only produces a hint
 *
 * The editor itself is `MdiIconPickerControl` in host-field mode: it adopts the input of this
 * text control and owns the popover, the grid and the keyboard/blur map, while this class keeps
 * the value plumbing (live typing, commit, close) and the canvas glyph. Reusing the picker
 * keeps one implementation of the grid instead of a second copy inside the node editor.
 *
 * The popover must stay a child of the editor wrapper. `NodeUi.showControlEditor()` installs a
 * capture-phase `mousedown` click-away on `document` that hides the editor for any click
 * outside it, and `TextControlUi` closes on `blur` — a body-level portal would therefore close
 * the editor on the first tile click.
 *
 * @module nodes/controls/icon-control-ui
 */

import TextControlUi from './text-control-ui.js';
import type {
    TextControlDimensions,
    TextControlLayout,
    TextControlNodeState,
    TextControlNodeUiLike,
    TextControlPayload,
} from './text-control-ui.js';
import type { ValueLayout } from './node-control-ui.js';
import { CONTROL_CANVAS_VALUE_TEXT_COLOR } from './control-ui-colors.js';
import {
    EMPTY_MDI_INDEX,
    MDI_SET,
    loadMdiIconIndex,
    parseIconValue,
    resolveMdiGlyph,
} from '../../data/mdi-icons.js';
import type { MdiIconIndex } from '../../data/mdi-icons.js';
import { MdiIconPickerControl } from '../../views/controls/mdi-icon-picker-control.js';
import { MDI_CANVAS_FONT, ensureMdiGlyphFont, hasMdiGlyphFontSupport } from '../mdi-glyph-font.js';

export type IconControlPayload = TextControlPayload;
export type IconControlNodeState = TextControlNodeState;
export type IconControlLayout = TextControlLayout;
export type IconControlDimensions = TextControlDimensions;

/**
 * Node UI surface an icon control talks to: the inherited editor callbacks plus a repaint
 * request, used once the lazily loaded glyph font or index changes what the canvas paints.
 */
export interface IconControlNodeUiLike extends TextControlNodeUiLike {
    requestRepaint?: () => void;
}

/** Width of the glyph column reserved at the left of the canvas value box. */
const MDI_GLYPH_SIZE = 14;

/** Gap between the canvas glyph and the value text. */
const MDI_GLYPH_GAP = 6;

/** Left padding the inherited text rendering uses inside the value box. */
const VALUE_BOX_PADDING = 8;

type IconTranslate = (key: string, params?: Record<string, unknown>) => string;

export default class IconControlUi extends TextControlUi {
    declare controlData: IconControlPayload;
    declare nodeData: IconControlNodeState;
    declare nodeUi: IconControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;

    /** MDI picker mounted on the editor field; `null` until `renderDOM()` ran. */
    picker: MdiIconPickerControl | null;

    /** Index the canvas glyph resolves codepoints with; empty until the load lands. */
    _index: MdiIconIndex;
    /** Whether this control already asked the data module for the index. */
    _indexRequested: boolean;
    /** Glyph font state; only `'ready'` lets the canvas paint the glyph. */
    _glyphFontStatus: 'idle' | 'loading' | 'ready' | 'failed';

    /**
     * Create an IconControlUi instance.
     */
    constructor(
        controlData: IconControlPayload,
        nodeData: IconControlNodeState,
        nodeUi: IconControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);

        // Selecting a tile must not close the editor; the picker reports the end of the
        // session explicitly and this control decides what closing means.
        this.closeOnChange = false;

        this.picker = null;
        this._index = EMPTY_MDI_INDEX;
        this._indexRequested = false;
        this._glyphFontStatus = 'idle';
    }

    /**
     * Render the control on canvas: the inherited text rendering plus the icon glyph.
     *
     * The glyph is painted inside the value box in front of the text whenever the value
     * resolves to an icon of the bundled MDI release. Free text and foreign icon sets keep
     * the plain text box, so the node still says what the value actually is.
     *
     * @param ctx - Canvas context.
     * @param layout - Layout information.
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: TextControlLayout): void {
        this._prepareCanvasGlyph(this._coerceTextValue(this.getValue()));
        super.renderCanvas(ctx, layout);
    }

    /**
     * Kick the two lazy resources the canvas glyph needs.
     *
     * The index maps the name in the value to a codepoint, the webfont maps the codepoint to
     * a glyph. Both are requested once and each one repaints the node when it arrives; until
     * then the canvas falls back to the plain text box.
     *
     * @param value - Current control value.
     */
    _prepareCanvasGlyph(value: string): void {
        const parsed = parseIconValue(value);
        if (!parsed || parsed.set !== MDI_SET) {
            return;
        }

        this._ensureIndex();
        this._ensureGlyphFont();
    }

    /**
     * Glyph the canvas paints in front of the value text.
     *
     * @returns The glyph character, or `null` while the value is not a bundled MDI icon or
     * the webfont is not ready.
     */
    _canvasGlyph(): string | null {
        if (this._glyphFontStatus !== 'ready') {
            return null;
        }

        return resolveMdiGlyph(this._coerceTextValue(this.getValue()), this._index);
    }

    /**
     * Reserve the glyph column at the left of the value box.
     *
     * @param _ctx - Canvas context (the glyph width is fixed by the webfont size).
     * @param _valueLayout - Value box.
     * @returns Width reserved for the glyph, or `0` while no glyph is painted.
     */
    _canvasValueLeadingWidth(_ctx: CanvasRenderingContext2D, _valueLayout: ValueLayout): number {
        return this._canvasGlyph() ? MDI_GLYPH_SIZE + MDI_GLYPH_GAP : 0;
    }

    /**
     * Paint the glyph inside the reserved column, mirroring the picker tiles.
     *
     * @param ctx - Canvas context.
     * @param valueLayout - Value box.
     * @param leadingWidth - Width reserved by `_canvasValueLeadingWidth()`.
     */
    _drawCanvasValueLeading(
        ctx: CanvasRenderingContext2D,
        valueLayout: ValueLayout,
        leadingWidth: number
    ): void {
        const glyph = this._canvasGlyph();
        if (!glyph || leadingWidth <= 0) {
            return;
        }

        ctx.save();
        ctx.font = MDI_CANVAS_FONT;
        ctx.fillStyle = CONTROL_CANVAS_VALUE_TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            glyph,
            valueLayout.x + VALUE_BOX_PADDING + MDI_GLYPH_SIZE / 2,
            valueLayout.y + valueLayout.height / 2
        );
        ctx.restore();
    }

    /**
     * Ask the shared loader for the glyph webfont, once per control.
     *
     * The load itself is shared by every control (`nodes/mdi-glyph-font`), so two node canvases
     * never ask the browser twice. Environments without a `FontFaceSet` (older webviews, jsdom)
     * fall back to the text-only rendering for good.
     */
    _ensureGlyphFont(): void {
        if (this._glyphFontStatus !== 'idle') {
            return;
        }

        if (!hasMdiGlyphFontSupport()) {
            this._glyphFontStatus = 'failed';
            return;
        }

        this._glyphFontStatus = 'loading';
        void ensureMdiGlyphFont().then((status) => {
            this._glyphFontStatus = status;
            if (status === 'ready') {
                this._requestRepaint();
            }
        });
    }

    /**
     * Ask the node to repaint, e.g. once the glyph font or the icon index has arrived.
     */
    _requestRepaint(): void {
        const nodeUi = this.nodeUi as IconControlNodeUiLike | undefined;
        if (nodeUi && typeof nodeUi.requestRepaint === 'function') {
            nodeUi.requestRepaint();
        }
    }

    /**
     * Render the control for DOM: the inherited label/input wrapper plus the picker.
     *
     * The wrapper is the popover's containing block. `showControlEditor()` makes it
     * `position: absolute`; when the control is rendered detached (tests, previews) it is
     * still `static`, so fall back to `relative` to keep the popover anchored.
     * @param container - Optional parent element.
     * @returns The editor element.
     */
    renderDOM(container?: HTMLElement): HTMLElement {
        const wrapper = super.renderDOM(container);
        wrapper.classList.add('icon-control');

        const input = this.inputElement;
        if (!input) {
            return wrapper;
        }

        const computedPosition =
            typeof globalThis.getComputedStyle === 'function'
                ? globalThis.getComputedStyle(wrapper).position
                : '';
        if (!computedPosition || computedPosition === 'static') {
            wrapper.style.position = 'relative';
        }

        this._mountPicker(wrapper, input);

        return wrapper;
    }

    /**
     * Mount the shared picker on the field this control rendered.
     *
     * The picker adopts the field as its filter and adds the popover, the tiles and the
     * keyboard/blur map; this control stays the single owner of the value, so a tile click
     * arrives through `onChange` and every other end of the session through `onDismiss`.
     * @param wrapper - Editor wrapper the popover is anchored to.
     * @param input - Field rendered by `TextControlUi`.
     */
    _mountPicker(wrapper: HTMLElement, input: HTMLInputElement): void {
        this.picker?.detach();
        this.picker = new MdiIconPickerControl({
            value: this._coerceTextValue(this.getValue()),
            portal: 'inline',
            translate: (key, params) => this._translate(key, params),
            onChange: (value) => this._applyValue(value),
            onDismiss: () => this._handlePickerDismiss(),
        });
        this.picker.render(wrapper, { input });

        // The canvas glyph resolves codepoints with the same index the picker pages through;
        // ask for it once the editor exists, matching the old first-focus behaviour.
        this._ensureIndex();
    }

    /**
     * Commit the typed value and close the editor once the picker reports the end of a
     * session (Enter, Escape on a closed grid, focus-out).
     */
    _handlePickerDismiss(): void {
        this._commitInputValue();
        this._requestClose();
    }

    /**
     * Create the text input and teach it the picker placeholder.
     *
     * The popover teaches the search only once the field has focus; an empty field says what
     * to do with it up front (and collapses out of the way as soon as there is a value).
     * @returns The input element.
     */
    _renderDOMControl(): HTMLInputElement {
        const input = super._renderDOMControl();

        input.placeholder = this._translate('controls.iconPicker.hint');

        // The picker owns blur and the keyboard; the inherited handlers would close the editor
        // on the first Escape/Enter (or any blur), stealing the picker's two-step session.
        if (this._blurHandler) {
            input.removeEventListener('blur', this._blurHandler);
            this._blurHandler = null;
        }
        if (this._keydownHandler) {
            input.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        return input;
    }

    /**
     * Load the index once per control, then repaint the glyph on the canvas.
     *
     * Requested by the canvas rendering (an `mdi:` value); the module caches the request, so
     * the picker opening later finds the index already there.
     */
    _ensureIndex(): void {
        if (this._indexRequested || this._index.version) {
            return;
        }

        this._indexRequested = true;
        void loadMdiIconIndex().then((index) => {
            this._index = index;
            this._requestRepaint();
        });
    }

    /**
     * Push the typed value into the node data, but only when it actually changed.
     */
    _commitInputValue(): void {
        if (!this.inputElement) {
            return;
        }

        const nextValue = this.inputElement.value;
        if (nextValue === this._coerceTextValue(this.getValue())) {
            return;
        }

        this._notifyChange(nextValue);
    }

    /**
     * Write a value the picker selected into the node data.
     * @param value - The new control value; the picker already wrote it into the field.
     */
    _applyValue(value: string): void {
        this._notifyChange(value);
    }

    /**
     * Keep the picker in sync when the value changes from outside (undo, inspector, tests).
     * @param value - The new control value.
     */
    _updateDOMInputValue(value: string): void {
        super._updateDOMInputValue(value);
        this.picker?.setValue(value);
    }

    /**
     * Translate a picker string, tolerating an `_t` implementation without parameters.
     * @param key - Locale key.
     * @param params - Optional interpolation parameters.
     * @returns The localized string, or the key when no translation service is wired.
     */
    _translate(key: string, params?: Record<string, unknown>): string {
        const translate = this._t as IconTranslate | undefined;
        if (typeof translate !== 'function') {
            return key;
        }

        return translate(key, params);
    }

    /**
     * Detach the picker before the base teardown removes the wrapper it is mounted on.
     */
    destroy(): void {
        this.picker?.detach();
        this.picker = null;

        super.destroy();
    }
}
