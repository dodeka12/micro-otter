# Markdown and Math Rendering

Documentation areas render their body text from Markdown. This document describes the renderer that
turns that Markdown into DOM, the optional KaTeX upgrade path, and the seams the tests use.

## Why an allowlisted renderer instead of sanitising HTML

The obvious pipeline — `marked.parse()` followed by a sanitiser such as DOMPurify — adds a second
dependency and relies on the sanitiser staying ahead of every parser quirk. Instead,
`renderMarkdown()` never calls `marked.parse()`. It walks the token stream from `marked.lexer()` and
emits HTML itself, so the set of emitted elements *is* the allowlist. There is no HTML string that
survives from input to output, and therefore no sanitiser to configure, audit or keep updated.

The renderer is also the only place in the codebase that converts Markdown for documentation areas.
`node-info-view` keeps its own `marked.parse()` path for node info panels; that path is unchanged.

## Files

| File | Responsibility |
| --- | --- |
| `js/core/markdown-renderer.ts` | Token-walking renderer, math extraction, HTML escaping, link policy. No browser API at module scope, so it runs in plain Node. |
| `js/core/katex-loader.ts` | Lazy CDN loader for KaTeX with caching, timeout and a never-rejecting promise. |
| `js/core/render-documentation-markdown.ts` | `renderAreaMarkdown()` facade: resolves the browser globals, renders with whatever is available and starts the KaTeX load on demand. |

## Allowlist

Block tokens that produce markup:

| Token | Output |
| --- | --- |
| `paragraph` | `<p>` |
| `heading` | `<h1>` … `<h6>` (depth clamped to 1–6) |
| `list` | `<ul>` / `<ol start="n">` |
| `list_item` | `<li>` |
| `blockquote` | `<blockquote>` |
| `code` | `<pre class="doc-area__code"><code>` |
| `hr` | `<hr>` |
| `space`, `def` | nothing |
| `text` (tight list item) | inline rendering without a wrapper |

Inline tokens that produce markup: `text`, `strong`, `em`, `del`, `codespan`, `br`, `link`.

Everything else — most importantly `html`, plus `table`, `image` and unknown types — is emitted as
escaped text of its `raw` source. A stray `<div>` in a box therefore shows up literally instead of
becoming markup.

Attribute policy:

- `link` emits `<a href="…" target="_blank" rel="noopener noreferrer">` only for `http:`, `https:` and
  `mailto:` URLs. `javascript:`, `data:` and relative URLs keep the label but lose the anchor.
- `code` blocks emit no language class unless the fence name matches `^[a-z0-9+#-]{1,20}$`. Prism is
  deliberately not wired up here: the class is inert metadata for a future highlighter.
- Every attribute value passes through `escapeHtml()` (`&`, `<`, `>`, `"`, `'`).


## Math: sentinel extraction and fallback

Math is extracted **before** lexing:

1. `\$` is unescaped to a literal `$` and never starts an expression.
2. `$$…$$` becomes a display expression, `$…$` an inline one (no newline inside, non-empty).
3. Each expression is replaced with `\u0000MATH:<n>\u0000` in the source handed to the lexer, so
   underscores and emphasis inside a formula cannot be interpreted as Markdown.
4. After the HTML is emitted, every sentinel is substituted:

   - with a KaTeX instance: `renderToString(expr, { throwOnError: false, displayMode })`;
   - without one, or when the instance throws:
     `<code class="doc-area__math-fallback" data-math>$expr$</code>` with the escaped source, so the
     formula stays readable and copyable.

An unterminated `$`, an empty `$…$` pair and `\$` all stay literal text. One bad formula can never
break a box: the `try/catch` is per expression.

`renderMarkdown()` returns `{ html, hasMath, mathRendered }`:

- `hasMath` — the source contained at least one expression (the layer uses it to decide what to
  re-render once KaTeX arrives);
- `mathRendered` — every expression was rendered by KaTeX.

When no Markdown provider is available the whole source is emitted in a single escaped
`<pre class="doc-area__raw">` block instead; math extraction still runs, so `hasMath` keeps working.

## KaTeX CDN policy

`katex-loader.ts` is the only module that knows about the network:

```ts
export const KATEX_VERSION = '0.16.11';
export const KATEX_CDN_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/`;
```

- `katex.min.css` and `katex.min.js` are injected into `document.head` **once** per load cycle; each
  element carries `data-katex-loader="stylesheet" | "script"` so tests and DevTools can find them.
- Concurrent `loadKaTeX()` calls share one promise; `getKatexLoadState()` reports
  `idle → loading → ready | unavailable`.
- The promise **never rejects**. A script error, a `timeoutMs` expiry (default `5000`) or a missing
  `document` all resolve `'unavailable'`. A rejected promise would surface as an unhandled rejection
  just because a box mentioned a formula while offline.
- Offline behaviour is therefore: the raw-text fallback, permanently. Nothing is vendored and no
  asset is cached; a future offline bundle only has to change this module.


## API surface

```ts
// markdown-renderer.ts
renderMarkdown(markdown: string, options?: { marked?: MarkedLike | null; katex?: KatexLike | null })
    : { html: string; hasMath: boolean; mathRendered: boolean };

// katex-loader.ts
loadKaTeX(options?: { timeoutMs?: number }): Promise<'ready' | 'unavailable'>;
getKatexLoadState(): 'idle' | 'loading' | 'ready' | 'unavailable';
getKatex(): KatexLike | null;
onKatexStateChange(listener: (state) => void): () => void;
__resetKatexLoaderForTests(): void;

// render-documentation-markdown.ts
renderAreaMarkdown(markdown: string): MarkdownRenderResult;
```

`renderAreaMarkdown()` renders with the currently available KaTeX (usually none on the first paint)
and calls `loadKaTeX()` when a document reports math. The documentation layer subscribes to
`onKatexStateChange` and re-renders only the boxes whose previous result had `hasMath: true`, so the
upgrade happens without a full rebuild and without blocking the first paint.

## Test seams

- `renderMarkdown()` takes both providers as options, so the renderer tests are plain `node:test`
  files with no DOM: the tests load the vendored bundle
  (`html/vendor/marked/marked.umd.js`) through `createRequire` and pass stub KaTeX objects.
- The loader takes a `timeoutMs` override and exposes `__resetKatexLoaderForTests()`, which restores
  `idle` so a test can run a second load cycle. Loader tests run under `tests/helpers/dom-harness.js`
  (jsdom) and drive `script.dispatchEvent(new Event('load' | 'error'))` by hand.
- `renderAreaMarkdown()` resolves `window.marked` / `window.katex` at call time, so a test can install
  a global between two calls to reproduce the "upgrade after load" flow.

See also: [Undo/Redo Architecture](undo-redo-architecture.md),
[Graph Panel Documentation Areas](../view-system/graph-panel-documentation-areas.md).
