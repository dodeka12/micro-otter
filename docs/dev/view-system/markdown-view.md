# MarkdownView

`MarkdownView` (`js/views/markdown-view.ts`) renders Markdown source to a **safe HTML subset**,
reusing the documentation-area renderer. It is the reusable view counterpart to
`js/core/markdown-renderer.ts`: the renderer walks `marked.lexer()` and emits only an allowlisted
subset (headings, paragraphs, lists, emphasis, inline/block code, links, blockquotes, rules), never
`marked.parse()`, so untrusted Markdown can never introduce markup or script. When no `marked`
provider is available the source is shown as escaped text.

## Options

| Option | Type | Default | Purpose |
|---|---|---|---|
| `markdown` | `string` | `''` | Markdown source to render. |
| `scrollable` | `boolean` | `true` | Add `.view-markdown--scrollable` so the body scrolls instead of growing. |
| `marked` | `MarkedLike \| null` | `undefined` | Markdown provider; `undefined` uses `window.marked`, `null` disables it (escaped `<pre>` fallback). |
| `katex` | `KatexLike \| null` | `null` | Optional KaTeX instance for `$…$` math. |
| `title` / `icon` / `id` / `logger` / `i18nService` | — | — | Standard `ViewBase` options. |

## API

- `get markdown()` / `set markdown(value)` — replace the source and re-render when attached.
- `setMarkdown(value)` — explicit setter with the same behaviour.
- `getMarkdown()` — return the current source.
- `render(container)`, `serialize()` (type `'MarkdownView'`), `static deserialize(data, _viewFactory, context)`.

## Rendering and safety

`render()` builds `.view-markdown` (plus `.view-markdown--scrollable` when scrollable) and sets its
`innerHTML` to the renderer's allowlisted output. The renderer escapes everything outside the
allowlist, so the `innerHTML` assignment is safe — raw HTML, images, and unknown token types are
emitted as escaped text. Math is rendered with KaTeX when a provider is supplied, otherwise as a
readable `doc-area__math-fallback` code span. Styling is scoped entirely under `.view-markdown` in
`styles/standard/markdown-view.css` (registered in `styles/themes.json`), so the documentation-area
stylesheet is untouched.

## Example

```ts
import { MarkdownView } from './markdown-view.js';

const view = new MarkdownView({ markdown: '## Help\n\n- **bold** point' });
view.attachTo(host);
// later, on a locale switch:
view.setMarkdown(t('myView.help.body'));
```

## Tests

`tests/views/markdown-view.test.js` covers headings/lists/emphasis/inline-code, `setMarkdown`
re-render, the escaped fallback with `marked: null`, raw-HTML/script neutralisation, `ViewFactory`
round-trip, and the theme-manifest + stylesheet registration.
