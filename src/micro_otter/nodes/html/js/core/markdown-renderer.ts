// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Safe Markdown rendering for documentation areas.
 *
 * The renderer never calls `marked.parse()`: it walks the token stream produced by
 * `marked.lexer()` and emits an allowlisted HTML subset itself. Anything outside the
 * allowlist (raw HTML, tables, images, unknown token types) is emitted as escaped text,
 * so untrusted Markdown can never introduce markup or script.
 *
 * KaTeX is optional. Math expressions are extracted *before* lexing and replaced with
 * sentinel tokens so the Markdown lexer cannot mangle underscores or emphasis inside a
 * formula. When no KaTeX instance is supplied the expression is rendered as readable,
 * copyable text.
 *
 * The module touches no browser API at module scope, so it can be unit tested in Node.
 */

export interface MarkdownToken {
    type?: string;
    raw?: string;
    text?: string;
    lang?: string;
    depth?: number;
    ordered?: boolean;
    start?: number;
    href?: string;
    title?: string;
    items?: MarkdownToken[];
    tokens?: MarkdownToken[];
}

export interface MarkedLike {
    lexer(src: string): MarkdownToken[];
}

export interface KatexLike {
    renderToString(expr: string, options?: Record<string, unknown>): string;
}

export interface MarkdownRenderOptions {
    /** Markdown provider. `null` disables the browser fallback (`window.marked`). */
    marked?: MarkedLike | null;
    /** KaTeX instance. When absent, math is rendered as escaped source text. */
    katex?: KatexLike | null;
}

export interface MarkdownRenderResult {
    html: string;
    hasMath: boolean;
    mathRendered: boolean;
}

const MATH_SENTINEL = '\u0000MATH:';
const MATH_SENTINEL_PATTERN = /\u0000MATH:(\d+)\u0000/g;
const MATH_FALLBACK_CLASS = 'doc-area__math-fallback';
const CODE_BLOCK_CLASS = 'doc-area__code';
const RAW_BLOCK_CLASS = 'doc-area__raw';
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const LANGUAGE_CLASS_PATTERN = /^[a-z0-9+#-]{1,20}$/;
const LINK_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

interface ExtractedMathExpression {
    expr: string;
    display: boolean;
    source: string;
}

interface ExtractedMarkdown {
    source: string;
    mathExpressions: ExtractedMathExpression[];
    hasMath: boolean;
}

/**
 * Escape a string for use as HTML text or as an attribute value.
 * @param {string} value - Raw text.
 * @returns {string} Escaped text.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Replace `$…$` and `$$…$$` with sentinel tokens that survive Markdown lexing.
 * @param {string} markdown - Markdown source.
 * @returns {ExtractedMarkdown} Rewritten source plus the collected expressions.
 */
function extractMathExpressions(markdown: string): ExtractedMarkdown {
    const mathExpressions: ExtractedMathExpression[] = [];
    let source = '';
    let index = 0;

    const pushExpression = (expr: string, display: boolean): void => {
        source += `${MATH_SENTINEL}${mathExpressions.length}\u0000`;
        mathExpressions.push({
            expr,
            display,
            source: display ? `$$${expr}$$` : `$${expr}$`,
        });
    };

    while (index < markdown.length) {
        const char = markdown[index];

        if (char === '\\' && markdown[index + 1] === '$') {
            source += '$';
            index += 2;
            continue;
        }

        if (char === '$' && markdown[index + 1] === '$') {
            const end = markdown.indexOf('$$', index + 2);
            if (end === -1) {
                source += '$$';
                index += 2;
                continue;
            }
            const expr = markdown.slice(index + 2, end).trim();
            if (!expr) {
                source += markdown.slice(index, end + 2);
                index = end + 2;
                continue;
            }
            pushExpression(expr, true);
            index = end + 2;
            continue;
        }

        if (char === '$') {
            let cursor = index + 1;
            let end = -1;
            while (cursor < markdown.length) {
                const nextChar = markdown[cursor];
                if (nextChar === '\n') {
                    break;
                }
                if (nextChar === '\\') {
                    cursor += 2;
                    continue;
                }
                if (nextChar === '$') {
                    end = cursor;
                    break;
                }
                cursor += 1;
            }
            if (end === -1) {
                source += '$';
                index += 1;
                continue;
            }
            const expr = markdown.slice(index + 1, end);
            if (!expr.trim()) {
                source += markdown.slice(index, end + 1);
                index = end + 1;
                continue;
            }
            pushExpression(expr, false);
            index = end + 1;
            continue;
        }

        source += char;
        index += 1;
    }

    return { source, mathExpressions, hasMath: mathExpressions.length > 0 };
}

/**
 * Resolve the Markdown provider: explicit option first, then the browser global.
 * @param {MarkedLike | null | undefined} provided - Provider from the caller.
 * @returns {MarkedLike | null} Usable provider or null.
 */
function resolveMarkedProvider(provided: MarkedLike | null | undefined): MarkedLike | null {
    if (provided === null) {
        return null;
    }
    if (provided) {
        return typeof provided.lexer === 'function' ? provided : null;
    }
    if (typeof window !== 'undefined') {
        const candidate = (window as unknown as { marked?: MarkedLike }).marked;
        if (candidate && typeof candidate.lexer === 'function') {
            return candidate;
        }
    }
    return null;
}

/**
 * Keep only absolute URLs whose scheme is safe inside a documentation box.
 * Relative links are rejected because their resolution depends on the host page.
 * @param {unknown} href - Candidate href from the Markdown token.
 * @returns {string | null} Safe href or null.
 */
function sanitizeHref(href: unknown): string | null {
    if (typeof href !== 'string') {
        return null;
    }
    const value = href.trim();
    const match = LINK_SCHEME_PATTERN.exec(value);
    if (!match) {
        return null;
    }
    const scheme = `${match[1].toLowerCase()}:`;
    return SAFE_LINK_SCHEMES.has(scheme) ? value : null;
}

/**
 * Render an inline token list through the allowlist.
 * @param {MarkdownToken[] | undefined} tokens - Inline tokens.
 * @returns {string} HTML fragment.
 */
function renderInlineTokens(tokens: MarkdownToken[] | undefined): string {
    return (tokens ?? []).map(renderInlineToken).join('');
}

/**
 * Render a single inline token. Unknown types degrade to escaped text.
 * @param {MarkdownToken | undefined} token - Inline token.
 * @returns {string} HTML fragment.
 */
function renderInlineToken(token: MarkdownToken | undefined): string {
    if (!token) {
        return '';
    }

    switch (token.type) {
        case 'strong':
            return `<strong>${renderInlineTokens(token.tokens)}</strong>`;
        case 'em':
            return `<em>${renderInlineTokens(token.tokens)}</em>`;
        case 'del':
            return `<del>${renderInlineTokens(token.tokens)}</del>`;
        case 'codespan':
            return `<code>${escapeHtml(token.text ?? '')}</code>`;
        case 'br':
            return '<br>';
        case 'link': {
            const href = sanitizeHref(token.href);
            const label = renderInlineTokens(token.tokens);
            if (!href) {
                return label;
            }
            return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
        case 'text':
            return escapeHtml(token.text ?? token.raw ?? '');
        default:
            return escapeHtml(token.raw ?? token.text ?? '');
    }
}

/**
 * Render a fenced or indented code block.
 * @param {MarkdownToken} token - Code token.
 * @returns {string} HTML fragment.
 */
function renderCodeBlock(token: MarkdownToken): string {
    const rawLang = typeof token.lang === 'string' ? token.lang.trim().split(/\s+/)[0] : '';
    const lang = rawLang && LANGUAGE_CLASS_PATTERN.test(rawLang) ? rawLang : '';
    const langClass = lang ? ` class="language-${lang}"` : '';
    const code = escapeHtml(token.text ?? token.raw ?? '');
    return `<pre class="${CODE_BLOCK_CLASS}"><code${langClass}>${code}</code></pre>`;
}

/**
 * Render an ordered or unordered list, including nested lists and tight items.
 * @param {MarkdownToken} token - List token.
 * @returns {string} HTML fragment.
 */
function renderList(token: MarkdownToken): string {
    const tag = token.ordered ? 'ol' : 'ul';
    const start =
        token.ordered && typeof token.start === 'number' && token.start !== 1
            ? ` start="${token.start}"`
            : '';
    const items = (token.items ?? [])
        .map((item) => `<li>${renderBlockTokens(item.tokens ?? [])}</li>`)
        .join('');
    return `<${tag}${start}>${items}</${tag}>`;
}

/**
 * Render a single block token. Unknown and disallowed types degrade to escaped text.
 * @param {MarkdownToken | undefined} token - Block token.
 * @returns {string} HTML fragment.
 */
function renderBlockToken(token: MarkdownToken | undefined): string {
    if (!token) {
        return '';
    }

    switch (token.type) {
        case 'space':
        case 'def':
            return '';
        case 'paragraph':
            return `<p>${renderInlineTokens(token.tokens)}</p>`;
        case 'heading': {
            const depth = Math.min(Math.max(Math.trunc(token.depth ?? 1), 1), 6);
            return `<h${depth}>${renderInlineTokens(token.tokens)}</h${depth}>`;
        }
        case 'list':
            return renderList(token);
        case 'blockquote':
            return `<blockquote>${renderBlockTokens(token.tokens ?? [])}</blockquote>`;
        case 'code':
            return renderCodeBlock(token);
        case 'hr':
            return '<hr>';
        case 'text':
            return token.tokens && token.tokens.length > 0
                ? renderInlineTokens(token.tokens)
                : escapeHtml(token.text ?? token.raw ?? '');
        default:
            return escapeHtml(token.raw ?? token.text ?? '');
    }
}

/**
 * Render a block token list.
 * @param {MarkdownToken[]} tokens - Block tokens.
 * @returns {string} HTML fragment.
 */
function renderBlockTokens(tokens: MarkdownToken[]): string {
    return (tokens ?? []).map(renderBlockToken).join('');
}

/**
 * Render a math expression as readable source text (the KaTeX fallback).
 * @param {ExtractedMathExpression} expression - Expression that could not be rendered.
 * @returns {string} HTML fragment.
 */
function renderMathFallback(expression: ExtractedMathExpression): string {
    return `<code class="${MATH_FALLBACK_CLASS}" data-math>${escapeHtml(expression.source)}</code>`;
}

/**
 * Render Markdown to a restricted, always-safe HTML subset.
 * @param {string} markdown - Markdown source, possibly containing `$…$` math.
 * @param {MarkdownRenderOptions} options - Optional Markdown and KaTeX providers.
 * @returns {MarkdownRenderResult} HTML plus math flags.
 */
export function renderMarkdown(
    markdown: string,
    options: MarkdownRenderOptions = {}
): MarkdownRenderResult {
    const input = typeof markdown === 'string' ? markdown : '';

    if (!input.trim()) {
        return { html: '', hasMath: false, mathRendered: false };
    }

    const extracted = extractMathExpressions(input);
    const marked = resolveMarkedProvider(options.marked);
    const katex = options.katex ?? null;

    let html: string;
    if (!marked) {
        html = `<pre class="${RAW_BLOCK_CLASS}">${escapeHtml(input)}</pre>`;
    } else {
        let tokens: MarkdownToken[] = [];
        try {
            tokens = marked.lexer(extracted.source) ?? [];
        } catch {
            tokens = [];
        }
        html =
            tokens.length > 0
                ? renderBlockTokens(tokens)
                : `<p>${escapeHtml(extracted.source)}</p>`;
    }

    let renderedCount = 0;
    html = html.replace(MATH_SENTINEL_PATTERN, (match, indexText: string) => {
        const expression = extracted.mathExpressions[Number(indexText)];
        if (!expression) {
            return '';
        }
        if (katex) {
            try {
                const rendered = katex.renderToString(expression.expr, {
                    throwOnError: false,
                    displayMode: expression.display,
                });
                if (typeof rendered === 'string' && rendered) {
                    renderedCount += 1;
                    return rendered;
                }
            } catch {
                // Fall through to the readable fallback below.
            }
        }
        return renderMathFallback(expression);
    });

    const hasMath = extracted.hasMath;
    return {
        html,
        hasMath,
        mathRendered: hasMath && renderedCount === extracted.mathExpressions.length,
    };
}

