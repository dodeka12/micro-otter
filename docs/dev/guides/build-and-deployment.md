# Build and Deployment Guide

## Overview

Micro Otter uses a **dual-mode development/production strategy**:

- **Development**: the Vite dev server transpiles the TypeScript app and proxies `/api`, `/serial`,
  and `/firmware` to the Python backend
- **Production**: `npm run build` emits static assets into the repo-root `_dist/webapp`, which the
  Python server serves directly

This guide covers build configuration, deployment workflows, and integration with the Python package.

---

## Development Workflow

### Vite Dev Server (Recommended for Development)

```bash
# One command: Vite on :5173 plus the Python backend on :8000
npm run dev:all

# ...or run the two halves in separate terminals
npm run dev:web       # Vite on :5173, proxies /api, /serial, /firmware and the
                      # synthesized /device endpoints
npm run dev:backend   # Python server on :8000
```

**Features:**

- Vite transpiles TypeScript on demand and serves the app from `src/micro_otter/nodes`
- `/api`, `/serial`, and `/firmware` are proxied to the Python backend (see `server.proxy` in
  `vite.config.js`)
- Hot module replacement for the UI
- `/device/*` is served by Vite itself, so JSON files keep their ES-module transform — except the
  three request shapes only the backend synthesizes: the merged node-package index
  (`/device/node_pkgs/index.json`), a runtime manifest (`/device/runtime/<id>/manifest.json`), and
  the files of an installed add-on (`/device/node_pkgs/<addon-id>/*`). Those are forwarded while
  the backend answers `/api/server-capabilities`, and fall back to the checked-in files when it does
  not (see `tools/vite-device-backend.mjs`)

**Why the Python server cannot serve the source tree:** `src/micro_otter/nodes/index.html` loads
`html/js/app/main.js`, but the repository only contains `main.ts`. Without a build (or Vite) that
entry module is a 404, so `uv run micro-otter serve` needs a production build — see
[Build for Production](#build-for-production).

**Key Behaviors (Python server, `src/micro_otter/tools/serial_bridge.py`):**

- Root path `/` serves `index.html` from `_dist/webapp` (or the source tree when no build exists)
- `/html/*` paths serve UI assets (styles, js, locales, icons)
- `/device/*` paths serve device files (runtime, targets, node packages)
- Direct access protection (Sec-Fetch headers) blocks non-JS access to `/html/` and `/device/`

---

## Production Build System

### Vite Configuration

**Location**: `vite.config.js` (project root)

```javascript
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: 'src/micro_otter/nodes',
    build: {
        // Repo-root build folder; the Python server resolves it as `_dist/webapp`.
        outDir: '../../../_dist/webapp',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/micro_otter/nodes/index.html'),
            },
        },
    },
    plugins: [
        // Excerpt: the real config also copies `html/{icons,locales,styles,vendor}`. `html/version.json`
        // is not copied; the `micro-otter-version-stamp` plugin writes it in `closeBundle`.
        viteStaticCopy({
            targets: [{ src: 'device', dest: '.' }],
        }),
    ],
});
```

**Configuration Details:**

| Setting                     | Value                        | Purpose                              |
| --------------------------- | ---------------------------- | ------------------------------------ |
| `root`                      | `src/micro_otter/nodes`      | Source directory for web app         |
| `build.outDir`              | `../../../_dist/webapp`      | Repo-root output dir (relative to root) |
| `build.emptyOutDir`         | `true`                       | Clean output dir before build        |
| `build.rollupOptions.input` | `index.html`                 | Entry point HTML file                |
| `plugins`                   | `viteStaticCopy`             | Copy runtime files to output         |

---

## Build Commands

### NPM Scripts

**Location**: `package.json`

```json
{
    "scripts": {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
    }
}
```

### Build for Production

```bash
npm run build
```

**Output**: `_dist/webapp/` directory containing:

- `index.html` (processed)
- `assets/` (bundled and minified app scripts/CSS with content hashes)
- `device/` (device files copied as-is)
- `html/locales/` (translation files)
- `html/icons/` (UI icons)
- All other static assets from source

**Serving the build:** `uv run micro-otter serve` (and `mo serve`) pick `_dist/webapp` up
automatically whenever it contains an `index.html` — there is no copy step into the Python package.
The resolution order is `<repo>/_dist/webapp`, then a `dist/webapp` bundled next to an installed
package, then the source tree. Delete `_dist/webapp` to fall back to the source tree, which only
works behind `npm run dev` because the app entry point is TypeScript.

### Stale build warning

Because the build wins over the source tree, a forgotten `npm run build` silently serves an old
bundle — including the old `device/node_pkgs/**/manifest.json` files. The app then compares host
package versions from that stale bundle against the firmware and can report "firmware current" for
a package you just changed.

The server therefore detects the mismatch and says so:

- `micro_otter.tools.server_capabilities.detect_stale_static_root(static_root, package_version)`
  sits next to `resolve_static_root()` and compares `<static_root>/html/version.json` — the stamp
  the bundle carries from `vite build` — with `micro_otter.__version__`, the version hatch-vcs
  wrote at install time. It returns `(served_version, package_version)` when the served root is a
  `_dist/webapp` build and the versions differ (a missing or unreadable file yields `None`, never
  an error).
- At import time the module logs one `WARNING` naming both versions, and
  `uv run micro-otter serve` prints the same line to the console through
  `serve_nodes.warn_if_stale_webapp_build()` before the startup banner.
- `GET /api/server-capabilities` exposes `webappBuildServedVersion` /
  `webappBuildSourceVersion` (`null` while the build is current) so a client can surface the
  warning itself. The keys keep their names for payload compatibility; `SourceVersion` is the
  package version.

**To clear it:** run `npm run build`, or delete `_dist/webapp` and work behind `npm run dev`. The
resolution order itself is deliberately unchanged — switching to the source tree automatically
would break the Vite workflow.

**Optimizations Applied:**

- Application script bundling and minification
- CSS bundling and minification
- Tree-shaking (removes unused code)
- Code splitting (dynamic imports)
- Asset fingerprinting (cache-busting via content hashes)
- Source maps (for debugging, optional)
- **Logging optimization**: Debug/info logs removed in production (see below)

---

## Logging Optimization in Production Builds

Production builds automatically optimize logging to reduce bundle size and improve runtime performance.

### Build-Time Log Level Configuration

The build system uses Vite's define plugin to set a minimum log level at build time:

- **Development builds** (`npm run dev`, default): All log levels enabled (debug, info, warn, error)
- **Production builds** (`npm run build`, `NODE_ENV=production`): Only warn and error logs included (debug/info removed)

**How it works:**

1. **Define Plugin**: Vite replaces `__MIN_LOG_LEVEL__` with `'warn'` at build time in production
2. **Early Returns**: Logger checks global minimum level before any processing
3. **Tree Shaking**: Vite's tree-shaking removes unreachable debug/info branches
4. **Terser**: Dead code elimination removes unreachable log calls completely

**Result**: Debug and info logs are completely eliminated from production bundles, reducing both bundle size and runtime overhead.

### Configuration

The logging level is automatically determined by `NODE_ENV`:

```javascript
// vite.config.js
export default defineConfig({
    define: {
        __MIN_LOG_LEVEL__: JSON.stringify(
            process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
        ),
    },
    build: {
        minify: 'terser',
        terserOptions: {
            compress: {
                dead_code: true,  // Remove unreachable code
                drop_debugger: true,
            },
        },
    },
});
```

### Override Minimum Level

Force a specific minimum level regardless of environment:

```bash
# Build with info minimum level
__MIN_LOG_LEVEL__=info npm run build

# Build with error minimum level
__MIN_LOG_LEVEL__=error npm run build
```

### Verification

Verify that debug logs are removed from production build:

```bash
# Build for production
npm run build

# Check bundle - debug/info logs should be absent
# Warn/error logs should remain for production debugging
grep -r "debug\|info" _dist/webapp/assets/*.js
grep -r "warn\|error" _dist/webapp/assets/*.js

# Compare bundle sizes
ls -lh _dist/webapp/assets/*.js
```

**Expected results:**
- No `debug` or `info` log calls in production bundles
- `warn` and `error` logs present for production debugging
- Smaller bundle size compared to development builds

---

## Preview Production Build

```bash
npm run preview
```

Starts local server to test production build before deployment.

### Development with Vite

```bash
npm run dev
```

Starts Vite dev server on port 5173 (default). `/device` is served from the source tree, except the
three request shapes only the backend synthesizes (the merged node-package index, a runtime
manifest, and an installed add-on's files) — those are proxied to `:8000` while the backend is up.
Without `npm run dev:backend` the same requests are answered from the checked-in files, so the
Firmware tab lists installed add-ons only next to a running backend.

---

## Dependency Management

### TypeScript/JavaScript Dependencies

**Location**: `package.json`

#### Runtime Dependencies (Bundled)

```json
{
    "dependencies": {
        "marked": "^17.0.1",
        "@mdi/font": "7.4.47"
    }
}
```

**Runtime dependencies** are bundled into production output by Vite:

- `marked`: Markdown parser for node info text formatting (MIT license, GPL-3.0 compatible)
- `@mdi/font`: Material Design Icons webfont (Apache-2.0 / Pictogrammers Free License). Exact-pinned because the vendored webfont and the generated index must stay in lockstep; it also feeds the About-dialog attribution list.

#### Development Dependencies

```json
{
    "devDependencies": {
        "vite": "^7.3.1",
        "vite-plugin-static-copy": "^3.1.6",
        "eslint": "^9.39.2",
        "prettier": "^3.7.4",
        "jsdom": "^27.4.0",
        "fake-indexeddb": "^6.2.5",
        "@mdi/svg": "7.4.47"
    }
}
```

**Development dependencies** are NOT included in production builds:

- `vite`: Bundler and dev server
- `vite-plugin-static-copy`: Copy runtime files to build output
- `eslint`: Code linting
- `prettier`: Code formatting
- `jsdom`: DOM simulation for tests
- `fake-indexeddb`: IndexedDB polyfill for tests
- `@mdi/svg`: MDI metadata (`meta.json`) used only by `tools/generate-mdi-icons.mjs` to generate `html/vendor/mdi/icon-index.json`; not shipped

### Python Dependencies

**Location**: `pyproject.toml`

Python dependencies are managed separately via `uv` and are NOT part of the web app build:

```toml
[project]
dependencies = [
    "esptool>=5.1.0",
    "micropython-esp32-stubs>=1.26.0.post1",
    "mpremote>=1.27.0",
    "typer>=0.12.5",
    "rich>=13.7.0",
]
```

### Firmware toolchain setup

The ESP-IDF / MicroPython / `mpy-cross` toolchain is resolved by the configuration resolver rather
than by fixed system paths. The supported setup path is:

```bash
uv run micro-otter doctor            # what is missing, with a remedy for each component
uv run micro-otter toolchain install # provision or repair the pinned toolchain
uv run micro-otter toolchain status  # resolved paths + the layer that supplied each one
```

`toolchain install` delegates to `deploy/toolchain/bootstrap.sh` and passes the child environment from
`Config.toolchain_env()` (`MICRO_OTTER_TOOLCHAIN_DIR`, `IDF_PATH`, `IDF_TOOLS_PATH`,
`MICROPYTHON_ROOT`). Point the toolchain somewhere else with `MICRO_OTTER_TOOLCHAIN_DIR`, a
`[paths] toolchain_dir` entry in `micro-otter.toml`, or `--dir`; the devcontainer keeps working with
zero configuration because `/opt` is part of the platform-default layer. See the
[Configuration Reference](../deployment/configuration.md) for the full precedence chain, the TOML
schema, and the platform defaults.

---

## Static Asset Handling

### Device Files

**Source**: `src/micro_otter/nodes/device/`

**Contents**:

- Device runtimes (MicroPython implementations)
- Node type packages (global and runtime-specific)
- Device target definitions
- Standard library modules
- Sample graphs

**Build Behavior**: Copied as-is to `_dist/webapp/device/` via `vite-plugin-static-copy`

**Purpose**: Web Serial deployment transfers these files to ESP32 devices during firmware deployment.

### UI Assets

**Source**: `src/micro_otter/nodes/html/`

**Structure**:

```
html/
├── index.html          # Entry point (processed by Vite)
├── js/                 # TypeScript app modules (bundled by Vite)
├── styles/             # CSS files (bundled by Vite)
├── locales/            # Translation JSON files (copied as-is)
├── icons/              # SVG icons + Apache-2.0 notice (copied as-is)
├── vendor/mdi/         # Vendored Material Design Icons (copied as-is)
└── favicon.ico         # Favicon (copied as-is)
```

**Build Behavior**:

- HTML files: Processed, script/link tags rewritten to point to bundled assets
- App scripts/CSS: Bundled, minified, fingerprinted
- Locales/Icons/Vendor: Copied as-is (accessed dynamically by app)

#### Vendored MDI Assets

The `icon` control offers a searchable Material Design Icons picker. The icons are
**vendored**, not fetched from a CDN: the web app works offline and inside a
Home-Assistant-hosted iframe without third-party requests.

| Path | Content | Source |
| --- | --- | --- |
| `html/vendor/mdi/materialdesignicons-webfont.woff2` | Icon webfont (~400 KB, all icons) | `@mdi/font` |
| `html/vendor/mdi/LICENSE` | Pictogrammers licence text | `@mdi/font` |
| `html/vendor/mdi/icon-index.json` | Minified `name → codepoint` plus `alias → name` map | generated from `@mdi/svg/meta.json` |
| `html/vendor/mdi/` (whole directory) | Copied to `_dist/webapp/html/vendor/mdi/` | `vite-plugin-static-copy` |

The index is loaded lazily by `js/data/mdi-icons.ts` the first time the picker opens,
so the JSON never lands in the main bundle.

**Single source of truth**: `MDI_VERSION` in `tools/generate-mdi-icons.mjs` (currently
`7.4.47`). `@mdi/font` (runtime, for About-dialog attribution) and `@mdi/svg`
(dev-only, provides `meta.json`) are both pinned to that exact version in
`package.json`. A version bump is therefore three small edits: both pins, the constant,
then regenerate.

```bash
npm run generate:mdi     # rewrite html/vendor/mdi/ (idempotent, writes only on change)
npm run check:mdi-generated  # regenerate + git diff gate used by CI
```

`check:ci-local` runs `check:mdi-generated` next to `check:oss-generated`, so a stale committed
index fails the pre-push hook instead of shipping a picker that disagrees with the webfont. The
generator exits non-zero with a readable message when `node_modules/@mdi/*` is missing, so a broken
`npm install` cannot silently produce an empty index.

#### Vendored icon sets and the About dialog

Two icon sets ship with the web app and both are attributed in **Info → About**
(`js/views/about-dialog-view.ts`): Material Design Icons through the `@mdi/font` runtime
dependency, and Google Material Symbols because its icons are downloaded as loose SVGs into
`html/icons/` and `node_pkgs/<package>/icons/`.

That list has one source, `tools/open-source-package-overrides.json`:

| Key | Filled from | Example |
| --- | --- | --- |
| `<package-id>` | every `dependencies` entry in `package.json` plus every `cdn.jsdelivr.net/npm/<pkg>@…` URL in `index.html`; the generator fails when one has no override | `marked`, `@mdi/font` |
| `vendoredAssets` | assets that are neither an npm package nor a CDN script, listed by hand as `{ name, license, url }` | `Google Material Symbols` |

`npm run generate:oss` rewrites `js/core/open-source-packages.generated.js` (rows sorted by display
name, duplicates dropped) and `check:oss-generated` is the CI gate. A new vendored set costs one
`vendoredAssets` entry plus the upstream licence text next to the files — for Material Symbols that
is `html/icons/LICENSE`, which names the covered directories and the one modification we make
(`fill="#e3e3e3"` on the root `<svg>`). The download-and-adapt recipe for both sets is
[the adding-icons workflow](../../workflow/adding-icons.md).

---

## Deployment

### Static Web Hosting

The `_dist/webapp/` output is a **fully static site** deployable to any web server:

#### Nginx

```nginx
server {
    listen 80;
    server_name micro-otter.example.com;
    root /var/www/micro-otter;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Optional: Enable gzip compression
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

#### Apache

```apache
<VirtualHost *:80>
    ServerName micro-otter.example.com
    DocumentRoot /var/www/micro-otter

    <Directory /var/www/micro-otter>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted

        # SPA fallback
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ index.html [L]
    </Directory>
</VirtualHost>
```

#### Cloudflare Pages / Netlify / Vercel

**Build Settings:**

- **Build command**: `npm run build`
- **Publish directory**: `_dist/webapp`
- **Node version**: 18+ (specified in `.nvmrc` or settings)

These platforms automatically detect Vite and apply optimizations (CDN, HTTP/2, compression).

---

## CI/CD Integration

### Repository CI baseline

[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) validates every pull request and
every merge to `main`, skips pull requests whose change set touches only `ldev/`, and can be started
on demand with **Run workflow**. A feature-branch push starts no second run; the `push` trigger is
the post-merge check of `main`, which takes no direct pushes. It holds `contents: read` only,
cancels superseded runs on the same ref, caches `uv.lock` and `package-lock.json`, and publishes
nothing; the deployment example below is not wired into it.

| Job | What it runs | Local equivalent |
| --- | --- | --- |
| `python` | `uv sync --group dev`, `uv run ruff check src/ tools/ tests/`, `uv run pytest` | `npm run lint:python && uv run pytest -q` |
| `web` | `npm ci`, `npm run check:lockfile-sync`, `check:oss-generated`, `check:mdi-generated`, `check:payload-docs`, `check:event-payload-emissions`, `lint`, `typecheck`, `test:node`, `test:vitest`, `build` | `npm run check:ci-local:web && npm run typecheck && npm run test:node && npm run test:vitest && npm run build` |
| `docs` | `uv sync --group docs`, `uv run mkdocs build --strict`, upload `site/` as the `docs-site` artifact | `npm run check:docs` |

`test:node` includes `tests/deployment/`, so a firmware or packaging regression blocks the pull
request even when the change does not touch the web app. The `web` job never runs
`check:device-syntax`: mpy-cross is only available from the local toolchain build, so that gate stays
in `npm run check:ci-local` in the devcontainer and runs in the firmware compile image.

### Deployment example

This example is illustrative and is not used by this repository.

```yaml
name: Build and Deploy

on:
    push:
        branches: [main]

jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: 20
                  cache: 'npm'
            - run: npm ci
            - run: npm run build
            - uses: actions/upload-artifact@v4
              with:
                  name: webapp
                  path: _dist/webapp/
```

---

## Development vs Production Differences

| Aspect              | Development (Python)        | Production (Vite)          |
| ------------------- | --------------------------- | -------------------------- |
| **Server**          | Python `serve_nodes.py`     | Any static web server      |
| **Bundling**        | None (native ES modules)    | Vite bundles app scripts/CSS |
| **Dependencies**    | Loaded from `node_modules/` | Bundled into `assets/*.js` |
| **Device files**    | Served via Python route     | Static files in `device/`  |
| **Hot reload**      | Browser refresh             | Not applicable (static)    |
| **Source maps**     | N/A (direct source)         | Optional (configurable)    |
| **File size**       | Individual files            | Minified bundles           |
| **Browser caching** | Minimal                     | Content-hash fingerprints  |

---

## Troubleshooting

### Build Errors

**"Cannot find module 'marked'"**

- **Cause**: Dependency not installed
- **Fix**: `npm install`

**"ENOENT: no such file or directory, open 'index.html'"**

- **Cause**: Vite `root` misconfigured
- **Fix**: Verify `root: 'src/micro_otter/nodes'` in `vite.config.js`

**"emptyOutDir: true" deletes unrelated files**

- **Cause**: `outDir` pointing to wrong directory
- **Fix**: Ensure `outDir: '../../../_dist/webapp'` is correct relative path

### Runtime Files Not Copied

**Runtime folder missing in build output**

- **Cause**: `vite-plugin-static-copy` not configured
- **Fix**: Verify plugin configuration in `vite.config.js`

**Runtime files outdated in build**

- **Cause**: Vite caches build artifacts
- **Fix**: Delete `_dist/webapp` and rebuild: `rm -rf _dist/webapp && npm run build`

### Development Server Issues

**Port 8000 already in use**

- **Cause**: Another process using port
- **Fix**: Kill process or change port in `serve_nodes.py`

**Runtime files not accessible**

- **Cause**: Path routing misconfigured
- **Fix**: Verify `APP_ROOT = Path(__file__).parent.parent / "nodes"` in `serve_nodes.py`

---

## Adding New Dependencies

### Runtime Dependency (Bundled in Production)

```bash
npm install <package-name>
```

**Example**: Adding a charting library:

```bash
npm install chart.js
```

Vite automatically includes it in the production bundle.

### Development-Only Dependency

```bash
npm install --save-dev <package-name>
```

**Example**: Adding a development utility:

```bash
npm install --save-dev eslint
```

Not included in production build.

---

## Build Output Structure

```
_dist/webapp/
├── index.html                       # Processed HTML entry point
├── assets/
│   ├── index-[hash].js              # Bundled main app JS
│   ├── main-[hash].css              # Bundled app CSS
│   ├── marked-[hash].js             # Bundled marked library
│   └── ...                          # Other chunked assets
├── device/
│   ├── manifest.json                # Device-level manifest
│   ├── node_pkgs/                   # Global node packages
│   │   ├── core/
│   │   └── stdmo/
│   ├── targets/                     # Target device configs (moved to device root)
│   │   └── *.json
│   └── runtime/
│       └── general/
│           ├── manifest.json        # Runtime manifest
│           ├── node_pkgs/           # Runtime-specific node packages
│           ├── libs/                # MicroPython libraries
│           ├── nodes/               # Node implementations
│           ├── app/                 # Application files
│           └── main.py              # Main entry point
├── html/
│   ├── locales/
│   │   ├── en.json
│   │   └── de.json
│   └── icons/
│       └── *.svg
└── favicon.ico
```

**File Size Estimates** (compressed):

- HTML: ~5 KB
- JS (bundled): ~200-400 KB
- CSS (bundled): ~20-40 KB
- Device files: ~500 KB - 2 MB (varies by packages)
- Icons/Locales: ~50-100 KB

**Total**: ~1-3 MB (typical)

---

## Performance Optimization

### Code Splitting

Vite automatically splits code at dynamic import boundaries:

```ts
// heavy-module.ts
// Dynamic import creates separate chunk
const module = await import('./heavy-module.js');
```

This reduces initial load time.

### Tree Shaking

Vite removes unused exports from dependencies:

```ts
// Only parse() is bundled, not the entire marked library
import { marked } from 'marked';
```

### Asset Optimization

- **Images**: Use WebP/AVIF for better compression
- **Icons**: SVG preferred (already in use)
- **Fonts**: Subset and preload if custom fonts added

### Caching Strategy

Production build uses content-hash filenames:

```
assets/index-a3f9d8c2.js
assets/main-7b4e1a5f.css
```

**Benefits**:

- Aggressive caching (1 year cache headers safe)
- Automatic cache invalidation on content change
- CDN-friendly

---

## Future Enhancements

### Potential Improvements

1. **Service Worker**: Offline support for web app UI
2. **PWA Manifest**: Install as desktop/mobile app
3. **Code Splitting**: Split by route/feature for faster initial load
4. **Compression**: Pre-compress with Brotli/Gzip
5. **Asset Preloading**: `<link rel="preload">` for critical resources

### Migration to Framework

If later migrating to React/Vue/Svelte:

- Vite config remains largely the same
- Update `root` and entry point as needed
- Framework-specific plugins available (e.g., `@vitejs/plugin-vue`)

---

## Related Documentation

- **[View System Architecture](view-system-architecture.md)** - UI component structure
- **[I18n System Architecture](i18n-architecture.md)** - Translation system
- **[Data Backbone Architecture](data-backbone-architecture.md)** - Data model and persistence
- **[Node Definition Reference](node-definition-reference.md)** - Node package format

---

## Reference Links

- **Vite Documentation**: https://vite.dev/
- **vite-plugin-static-copy**: https://github.com/sapphi-red/vite-plugin-static-copy
- **marked (Markdown parser)**: https://marked.js.org/
