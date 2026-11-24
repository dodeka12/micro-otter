// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Value type for a documentation area — the user-visible "group box" on the graph.
 *
 * A documentation area is a graph item, not a node: it takes part in no transpilation,
 * capability validation, connection routing or node culling. Its only job is to hold a
 * translucent coloured region with a title and a Markdown body.
 *
 * The colour is stored as `#rrggbb` only. Translucency is *not* part of the data: the two
 * alpha constants below are the single source of truth, so neither a colour picker nor a
 * clipboard payload pasted from another document can ever make a box opaque.
 */

export interface DocumentationAreaBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Vertical placement of the Markdown body inside the box.
 *
 * The title always stays in the header row; only the body text moves. `top` is the default so
 * documents written before the field existed keep their original look.
 */
export type DocumentationAreaContentAlign = 'top' | 'bottom';

/**
 * Text-size preset for the Markdown body and its headings.
 *
 * The title is deliberately excluded: it stays at its fixed 16 px size. `normal` is the default so
 * documents written before the field existed keep their original look.
 */
export type DocumentationAreaFontSize = 'small' | 'normal' | 'large';

export interface DocumentationAreaData {
    id: string;
    title: string;
    markdown: string;
    color: string;
    contentAlign: DocumentationAreaContentAlign;
    fontSize: DocumentationAreaFontSize;
    bounds: DocumentationAreaBounds;
}

/** Gesture kind reported by `documentation-area-drag-started`. */
export type DocumentationAreaDragMode = 'move' | 'resize';

/** The subset of area fields `updateDocumentationArea()` may patch. */
export interface DocumentationAreaPatch {
    title?: string;
    markdown?: string;
    color?: string;
    contentAlign?: DocumentationAreaContentAlign;
    fontSize?: DocumentationAreaFontSize;
}

export const DOCUMENTATION_AREA_DEFAULT_COLOR = '#4a90d9';
export const DOCUMENTATION_AREA_DEFAULT_CONTENT_ALIGN: DocumentationAreaContentAlign = 'top';
export const DOCUMENTATION_AREA_DEFAULT_FONT_SIZE: DocumentationAreaFontSize = 'normal';
export const DOCUMENTATION_AREA_DEFAULT_SIZE = Object.freeze({ width: 320, height: 200 });
export const DOCUMENTATION_AREA_MIN_SIZE = Object.freeze({ width: 120, height: 80 });
export const DOCUMENTATION_AREA_FILL_ALPHA = 0.16;
export const DOCUMENTATION_AREA_BORDER_ALPHA = 0.65;

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Coerce a value to a finite number.
 * @param {unknown} value - Candidate value.
 * @param {number} fallback - Value used when the input is not finite.
 * @returns {number} Finite number.
 */
function toFiniteNumber(value: unknown, fallback: number): number {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : fallback;
}

/**
 * Normalize a stored colour to `#rrggbb`.
 *
 * Only `#rgb` and `#rrggbb` are accepted (case-insensitive, short form expanded). Anything
 * else — `rgba(...)`, colour names, `''` — falls back to the default colour, so an alpha
 * channel can never enter the data.
 * @param {unknown} value - Candidate colour.
 * @returns {string} Lower-case `#rrggbb` colour.
 */
export function normalizeAreaColor(value: unknown): string {
    if (typeof value !== 'string') {
        return DOCUMENTATION_AREA_DEFAULT_COLOR;
    }

    const trimmed = value.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
        return DOCUMENTATION_AREA_DEFAULT_COLOR;
    }

    const hex = trimmed.slice(1).toLowerCase();
    if (hex.length === 3) {
        return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }

    return `#${hex}`;
}

/**
 * Coerce a stored content alignment to `top` or `bottom`.
 *
 * Anything other than the exact strings (including `undefined`, `null` and `''`) falls back to
 * the default `top`, so a corrupted document can never produce an unknown `data-align` value.
 * @param {unknown} value - Candidate alignment.
 * @returns {DocumentationAreaContentAlign} `'top'` or `'bottom'`.
 */
export function normalizeAreaContentAlign(value: unknown): DocumentationAreaContentAlign {
    return value === 'bottom' ? 'bottom' : DOCUMENTATION_AREA_DEFAULT_CONTENT_ALIGN;
}

/**
 * Coerce a stored font-size preset to `small`, `normal` or `large`.
 *
 * Anything other than the exact strings (including `undefined`, `null` and `''`) falls back to
 * `normal`, so a corrupted document can never produce an unknown `data-font-size` value.
 * @param {unknown} value - Candidate preset.
 * @returns {DocumentationAreaFontSize} `'small'`, `'normal'` or `'large'`.
 */
export function normalizeAreaFontSize(value: unknown): DocumentationAreaFontSize {
    if (value === 'small' || value === 'large') {
        return value;
    }
    return DOCUMENTATION_AREA_DEFAULT_FONT_SIZE;
}

/**
 * Normalize bounds: finite coordinates, a usable size.
 *
 * A missing, non-finite or non-positive dimension falls back to the default size;
 * anything smaller than the minimum is clamped upwards.
 * @param {unknown} value - Candidate bounds.
 * @returns {DocumentationAreaBounds} Fresh, normalized bounds object.
 */
export function normalizeAreaBounds(value: unknown): DocumentationAreaBounds {
    const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const rawWidth = toFiniteNumber(source.width, 0);
    const rawHeight = toFiniteNumber(source.height, 0);

    return {
        x: toFiniteNumber(source.x, 0),
        y: toFiniteNumber(source.y, 0),
        width:
            rawWidth > 0
                ? Math.max(rawWidth, DOCUMENTATION_AREA_MIN_SIZE.width)
                : DOCUMENTATION_AREA_DEFAULT_SIZE.width,
        height:
            rawHeight > 0
                ? Math.max(rawHeight, DOCUMENTATION_AREA_MIN_SIZE.height)
                : DOCUMENTATION_AREA_DEFAULT_SIZE.height,
    };
}

/**
 * Build a CSS `rgba()` string from a stored `#rrggbb` colour.
 *
 * This is the only place a documentation-area colour becomes paintable, so the canvas
 * shading and the DOM layer's CSS variables can never drift apart. Channels are integers and
 * the alpha is the plain decimal form (`0.16`, not `16%`), because both consumers are plain
 * `rgba()` parsers.
 * @param {unknown} hex - Stored colour; normalized first, so invalid input yields the default.
 * @param {number} alpha - Alpha in `[0, 1]`.
 * @returns {string} `rgba(r, g, b, a)`.
 */
export function rgbaFromHex(hex: unknown, alpha: number): string {
    const color = normalizeAreaColor(hex);
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    const normalizedAlpha = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;

    return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
}

/**
 * Compare two bounds objects field by field.
 * @param {DocumentationAreaBounds} a - First bounds.
 * @param {DocumentationAreaBounds} b - Second bounds.
 * @returns {boolean} True when all four fields are identical.
 */
export function areaBoundsEqual(a: DocumentationAreaBounds, b: DocumentationAreaBounds): boolean {
    if (!a || !b) {
        return false;
    }
    return (
        Object.is(a.x, b.x) &&
        Object.is(a.y, b.y) &&
        Object.is(a.width, b.width) &&
        Object.is(a.height, b.height)
    );
}


/**
 * A single documentation area.
 *
 * Instances are owned by a `NodeGraph`; the graph assigns ids and emits the change events,
 * so the setters here are deliberately side-effect free.
 */
export default class DocumentationArea {
    id: string;
    title: string;
    markdown: string;
    color: string;
    contentAlign: DocumentationAreaContentAlign;
    fontSize: DocumentationAreaFontSize;
    bounds: DocumentationAreaBounds;

    constructor(options: Partial<DocumentationAreaData> = {}) {
        this.id = typeof options.id === 'string' ? options.id.trim() : '';
        this.title = typeof options.title === 'string' ? options.title : '';
        this.markdown = typeof options.markdown === 'string' ? options.markdown : '';
        this.color = normalizeAreaColor(options.color);
        this.contentAlign = normalizeAreaContentAlign(options.contentAlign);
        this.fontSize = normalizeAreaFontSize(options.fontSize);
        this.bounds = normalizeAreaBounds(options.bounds);
    }


    /**
     * Set the area id.
     * @param {string} id - Identifier assigned by the owning graph.
     * @returns {DocumentationArea} This instance.
     */
    setId(id: string): this {
        this.id = typeof id === 'string' ? id.trim() : '';
        return this;
    }

    /**
     * Set the title.
     * @param {unknown} title - New title; non-strings become `''`.
     * @returns {DocumentationArea} This instance.
     */
    setTitle(title: unknown): this {
        this.title = typeof title === 'string' ? title : '';
        return this;
    }

    /**
     * Set the Markdown body.
     * @param {unknown} markdown - New body; non-strings become `''`.
     * @returns {DocumentationArea} This instance.
     */
    setMarkdown(markdown: unknown): this {
        this.markdown = typeof markdown === 'string' ? markdown : '';
        return this;
    }

    /**
     * Set the colour. Values outside `#rgb`/`#rrggbb` fall back to the default.
     * @param {unknown} color - Candidate colour.
     * @returns {DocumentationArea} This instance.
     */
    setColor(color: unknown): this {
        this.color = normalizeAreaColor(color);
        return this;
    }

    /**
     * Set the vertical placement of the Markdown body.
     * @param {unknown} contentAlign - `'top'` or `'bottom'`; anything else falls back to `'top'`.
     * @returns {DocumentationArea} This instance.
     */
    setContentAlign(contentAlign: unknown): this {
        this.contentAlign = normalizeAreaContentAlign(contentAlign);
        return this;
    }

    /**
     * Set the Markdown body/heading font-size preset.
     * @param {unknown} fontSize - `'small'`, `'normal'` or `'large'`; anything else falls back to `'normal'`.
     * @returns {DocumentationArea} This instance.
     */
    setFontSize(fontSize: unknown): this {
        this.fontSize = normalizeAreaFontSize(fontSize);
        return this;
    }

    /**
     * Set the bounds. Values are normalized and clamped like `normalizeAreaBounds()`.
     * @param {unknown} bounds - Candidate bounds.
     * @returns {DocumentationArea} This instance.
     */
    setBounds(bounds: unknown): this {
        this.bounds = normalizeAreaBounds(bounds);
        return this;
    }

    /**
     * Serialize the area.
     * @returns {DocumentationAreaData} Deep copy, safe to cache in the history manager.
     */
    toData(): DocumentationAreaData {
        return {
            id: this.id,
            title: this.title,
            markdown: this.markdown,
            color: this.color,
            contentAlign: this.contentAlign,
            fontSize: this.fontSize,
            bounds: {
                x: this.bounds.x,
                y: this.bounds.y,
                width: this.bounds.width,
                height: this.bounds.height,
            },
        };
    }

    /**
     * Build an area from (possibly partial) serialized data.
     * @param {Partial<DocumentationAreaData>} data - Serialized area.
     * @returns {DocumentationArea} New instance.
     */
    static fromData(data: Partial<DocumentationAreaData> = {}): DocumentationArea {
        return new DocumentationArea(data);
    }
}
