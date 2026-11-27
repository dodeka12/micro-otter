# Hosted web app

`mo webapp build` produces a browser-only build of the editor that runs with no local server, and
`mo webapp upload` publishes that bundle to any SFTP host. Neither command knows a domain: the
destination arrives at upload time as a flag or a `MICRO_OTTER_UPLOAD_*` variable, and nothing about
it is stored in the tree.

## What the hosted build is

`_dist/webapp-hosted` is the same editor, compiled with `MICRO_OTTER_HOSTED=1`: no `mo serve`, no
`/api/*`, and WebSerial as the only device path. `_dist/webapp` keeps its old meaning — the payload
inside the wheel that `mo serve` hands to a browser.

| | `_dist/webapp` | `_dist/webapp-hosted` |
|---|---|---|
| Built by | `npm run build`, which every wheel build runs | `uv run mo webapp build` |
| Served by | `micro-otter serve`, out of the installed wheel | any static host the bundle is uploaded to |
| `/api/*` | yes — capabilities, version, firmware, serial bridge | no: nothing on the host can answer it |

The collection deploy path with its `missing` / `override-required` source upload is unchanged in both
builds; hosted mode gates local-server firmware features only. See
[deployment-system-architecture.md](deployment-system-architecture.md).

## Building it

```bash
uv run mo webapp build --firmware-index dist/release-<base>/index.json \
    --docs-url https://docs.example.invalid/ --public-url https://app.example.invalid/
```

| Option | Default | Meaning |
|---|---|---|
| `--out PATH` | `_dist/webapp-hosted` | publication directory; `_dist/webapp` and anything inside it are refused |
| `--firmware-index FILE` | none | release `index.json` that renders `firmware/index.html`; no URL is defaulted |
| `--docs-url URL` | none | absolute `http(s)` URL the hosted Firmware notice links to |
| `--public-url URL` | none | root URL the bundle will be served from; recorded in the manifest and linked from `/firmware/` |
| `--no-build` | off | skip `npm run build` and re-render the page and the manifest of an existing `--out` |
| `--json-output` | off | print `{outDir, appVersion, fileCount, firmwarePage, manifestPath}` instead of the summary |
| `--config PATH` | discovered | `micro-otter.toml` to read instead of the discovered one |

Before npm runs, the command checks the checkout (`package.json`, `vite.config.js`), that `npm` is on
`PATH`, that `node_modules` exists, and that the output directory is safe; a `--firmware-index` is
validated next, so an index typo costs nothing. `npm run build` then runs with the environment seam
below, and after it the `/firmware/` page and `webapp-build.json` are written.

| Variable | Read by | Set by | Meaning |
|---|---|---|---|
| `MICRO_OTTER_HOSTED=1` | `vite.config.js` | `mo webapp build` only | injects `globalThis.__MICRO_OTTER_HOSTED__` and the CSP `<meta>` |
| `MICRO_OTTER_WEBAPP_OUT` | `vite.config.js` | `mo webapp build` only | absolute output directory, set from `--out`; a value in the shell never overrides the flag |
| `MICRO_OTTER_WEBAPP_DOCS_URL` | `vite.config.js` | `mo webapp build` only | `globalThis.__MICRO_OTTER_DOCS_URL__`; **removed** from the child environment when `--docs-url` is absent |

The seam is a Vite `define`, not `import.meta.env`: both values are compile-time constants that
tree-shaking can collapse, and no `import.meta.env` access exists under `src/` to follow. The build
therefore has exactly one entry point (`npm run build` with an environment), not a second npm script
that could drift.

`_dist/webapp` is the wheel payload (`tools/inspect_wheel.py` pins its file list), so writing a hosted
build into it is refused twice: `run_webapp_build` raises `webapp-build-out-dir-unsafe` before npm
runs, and `vite.config.js` refuses `MICRO_OTTER_WEBAPP_OUT` or `vite build --outDir` pointing there.

## What hosted mode turns off

Not starting the server monitor *is* the gating: with no monitor there is no capability probe, no
`/api/server-capabilities` request, no title-bar badge and no 15-second reconnect dialog.

| File | What it does when hosted |
|---|---|
| `js/app/main.ts` | passes `serverConnection: null` instead of a `ServerConnectionMonitor`, so `WorkspaceView` renders without the badge |
| `js/core/app-meta.ts` | skips the `/api/version` hop and reads `/html/version.json` directly |
| `js/firmware/server-capabilities.ts` | is never constructed; `SERVER_CAPABILITIES_URL` and the `WS /firmware` build path are unreachable |
| `js/views/firmware-build-view.ts` | shows the existing offline explainer with the hosted body (`firmwareBuild.hosted.body`) and, when `--docs-url` was given, the desktop-install line (`firmwareBuild.hosted.installLink`, rendered as `Download Micro-Otter for desktop: <url>`) |

The notice is the Firmware tab's own offline section — the same `CollapsibleView` + `MarkdownView`
surface as the local offline case — so hosted mode adds no view, dialog or badge variant.

## Content Security Policy

A hosted build carries this policy in a `<meta http-equiv="Content-Security-Policy">` as the first
child of `<head>`:

```http
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'
```

The constant is `HOSTED_CSP_POLICY` in `tools/vite-hosted-csp.mjs`; `micro_otter.tools.webapp_csp`
carries the same string for the `/firmware/` page. It is a `<meta>` element because a static bundle
cannot set response headers on shared hosting — a `.htaccess` or server snippet is optional
reinforcement, never the source of truth. `frame-ancestors` cannot be delivered by `<meta>` at all; a
host that wants it adds it as a header.

Making `script-src 'self'` true required three removals, all shipped:

- the inline `<style>` block moved to `html/styles/standard/initial-loading.css`;
- the inline splash `<script>` moved to `js/app/initial-loading.ts`, a module loaded before `main.js`;
- the three `eval()` probes in `js/core/feature-requirements.ts` replaced by direct syntax checks.

The built `index.html` therefore holds no `<style>` element, no `<script>` without `src`, and no
`style="…"` attribute; styles reach the page from linked stylesheets and, after load, from the CSSOM,
which `style-src` does not restrict. A host may repeat the policy as a response header, but must never
widen it with `unsafe-eval` or `unsafe-inline`.

One consequence is deliberate: the KaTeX CDN (`cdn.jsdelivr.net`) is a third-party script and style
source, so math in documentation areas does not render in a hosted build. `katex-loader.ts` reports
`unavailable` and the renderer falls back to readable source text.

## The manual-install page

`--firmware-index` turns a release index into `firmware/index.html` + `firmware/firmware-page.css`
inside the bundle, so the same upload publishes `/firmware/` next to the editor. The page is a pure
render of the index: no runtime fetch, no default index URL, and no board-catalog read, because the
index already carries `chip` and `flashOffset`. Its contract — keys, `release-index-*` codes — is
[firmware-index.md](../firmware-compile/firmware-index.md); this page only states what the render adds.

| Part | Rule |
|---|---|
| Sections | one `<section class="board" id="board-<slug>">` per `firmware[]` entry, in index order |
| Downloads | the index's `url` and `package.url` used verbatim as `href`; the basename is what the command writes |
| Commands | three `<pre><code>` blocks per board: Linux/macOS `write_flash`, Windows `write_flash`, `erase_flash` |
| Chip | `--chip <chip>` is omitted when the index's `chip` is empty; a non-token value is refused |
| Assets | no `<script>`, no `<style>`, and the `HOSTED_CSP_POLICY` string copied into a `<meta>` verbatim |
| Repeatability | two renders of one index are byte-identical; `--public-url` only adds the editor link in the preamble |

The page is English only, like the release notes it mirrors.

## `webapp-build.json`

The manifest is written into the publication directory **after** everything else and never lists
itself, so its `files` list is a description of the finished tree — the list `mo webapp upload` sends
and verifies, instead of walking the directory.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | string | `webapp-build/v1` |
| `appVersion` | string | the `version` from the built `html/version.json` — exactly what the host serves |
| `hosted` | boolean | always `true`, because this command only builds with `MICRO_OTTER_HOSTED=1` |
| `builtAt` | string | ISO-8601 UTC with `Z`; `SOURCE_DATE_EPOCH` wins when set, so a rebuild can be byte-identical |
| `publicUrl` | string \| null | `--public-url`, else `null`; nothing is inferred |
| `firmwarePage` | object \| null | `{path, entryCount, indexSha256}`, or `null` when no index was supplied |
| `files` | array | `{path, size, sha256}` for every other file, sorted by POSIX path |

The document is serialised with `indent=2, sort_keys=True` and a trailing newline. `files` covers the
whole tree, including `firmware/index.html` and `firmware/firmware-page.css`; `firmwarePage` records
what caused the render, not what to upload. `--no-build` without `--firmware-index` therefore reports
`firmwarePage: null` even when a page is already on disk.

## Publishing

```bash
uv run mo webapp upload --host app.example.invalid --user deploy \
    --remote-path /var/www/app.example.invalid --identity-file ~/.ssh/id_ed25519 --verify
```

| Option | Default | Meaning |
|---|---|---|
| `--source PATH` | `_dist/webapp-hosted` | build directory holding `webapp-build.json` |
| `--host HOST` | `MICRO_OTTER_UPLOAD_HOST` | SFTP host |
| `--user USER` | `MICRO_OTTER_UPLOAD_USER` | SFTP user |
| `--remote-path PATH` | `MICRO_OTTER_UPLOAD_PATH` | absolute remote directory to publish into |
| `--port PORT` | `MICRO_OTTER_UPLOAD_PORT` or `22` | SSH port |
| `--identity-file FILE` | `MICRO_OTTER_UPLOAD_IDENTITY_FILE` | private key for publickey auth |
| `--known-hosts FILE` | `MICRO_OTTER_UPLOAD_KNOWN_HOSTS` | `known_hosts` file to pin the host key against |
| `--accept-new-host-key` | off | accept an unknown host key (`StrictHostKeyChecking=accept-new`) |
| `--prune` | off | delete remote files the manifest does not list, after confirmation |
| `--verify` | off | compare the host and the public version with the manifest |
| `--dry-run` | off | print the ordered plan and exit `0` without connecting or reading a credential |
| `--yes` | off | skip the prune confirmation; the plan is still printed |
| `--json-output` | off | print `{fileCount, byteCount, directories, pruned, verified, dryRun, manifestPath}` |
| `--config PATH` | discovered | `micro-otter.toml` to read instead of the discovered one |

| Variable | Meaning |
|---|---|
| `MICRO_OTTER_UPLOAD_HOST` | SFTP host |
| `MICRO_OTTER_UPLOAD_USER` | SFTP user |
| `MICRO_OTTER_UPLOAD_PATH` | absolute remote directory |
| `MICRO_OTTER_UPLOAD_PORT` | SSH port |
| `MICRO_OTTER_UPLOAD_IDENTITY_FILE` | private key |
| `MICRO_OTTER_UPLOAD_KNOWN_HOSTS` | `known_hosts` file |
| `MICRO_OTTER_UPLOAD_PASSWORD` | SFTP password — the only way to supply one without a prompt |

A flag wins over its variable; a missing host, user or remote path is `webapp-upload-target-invalid`
before any connection is attempted.

### Publication order

The upload is one `sftp -b` batch, built from the manifest, with parents created first:

1. **Hashed assets** — `assets/*`, `html/*`, `device/*`, `firmware/*` and the rest, sorted by remote
   path. New names, so a visitor still on the old `index.html` never requests them.
2. **`html/version.json`** — the version anchor: a served site advertises the new version only once
   the assets behind it exist.
3. **`webapp-build.json`** — the record of what was published, for the next run and for `--verify`.
4. **`index.html`** — last, because it is the pointer to all of the above.

Each directory gets its own `-mkdir` pass, parents before children, then `put -p` for its files;
pruning is a later batch of `-rm` lines, so a failed put never deletes anything.

### Prune safety

`--prune` compares a remote listing per directory with the manifest and removes only files the
manifest does not list — after a fully successful upload, and never `index.html` or
`html/version.json`. Directories are left in place, and the confirmation lists every candidate unless
`--yes` (or `--json-output`) is given.

### Verify semantics

`--verify` re-lists the remote tree and compares each file's size with the manifest, then re-reads
`html/version.json` on the host and compares its `version` with the manifest's `appVersion`. When the
manifest records a `publicUrl`, it also fetches `<publicUrl>/html/version.json` over HTTP(S) and
compares that; without a `publicUrl` the public check is skipped rather than guessed. Hashes are what
`webapp-build.json` stores; the transport check compares sizes, which is what SFTP lists cheaply.

## Passwords and host keys

Key auth is the supported path: `--identity-file` (or your agent) is used by the system `sftp` client,
and no password is read at all. The password path exists for hosts that only accept one:

- pass it in `MICRO_OTTER_UPLOAD_PASSWORD`, or answer one hidden prompt — never in a flag, which would
  land in the shell history and in `ps`;
- the client is driven through `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4+) and a
  generated helper that prints the password; on Linux the call is detached with `setsid`, because
  `ssh` only consults askpass when it has no terminal;
- every line the command prints, every error message and every `--json-output` payload replaces the
  password with `***`.

Host keys are verified as usual. `--known-hosts` points the client at a specific file, and only
`--accept-new-host-key` relaxes an unknown key to `StrictHostKeyChecking=accept-new`; a changed key is
never accepted. Credentials live in the environment or your SSH configuration — `micro-otter.toml` is
tracked in git and holds none of them, and no destination is ever written into the tree.

## Host requirements

The app must be served from **the root of a vhost or a dedicated subdomain**. Every runtime fetch is
root-absolute — `/html/version.json`, `/html/locales/*.json`, `/html/icons/*`, `/html/styles/*`,
`/html/vendor/*`, `/device/*`, `/firmware/*` — so an install under `/otter/` would 404 on all of
them. Base-URL support is a separate change, not a configuration knob.

| Requirement | Why |
|---|---|
| TLS (`https://`) | Web Serial is only exposed in a secure context; `http://localhost` is the sole exception |
| Root-absolute static serving | the fetches listed above; no SPA rewrite is needed, every file exists |
| Correct MIME types | `application/javascript` for `.js`, `application/json` for `.json`, `text/css` for `.css`, `image/svg+xml` for `.svg`, `font/woff2` for `.woff2` — a module or locale served as `text/plain` fails to load |
| Correct caching | see below; a cached `index.html` is what makes a publish look half-applied |

| Path | Cache-Control |
|---|---|
| `assets/*` (content-hashed names) | `public, max-age=31536000, immutable` |
| `index.html` | `no-store` |
| `html/version.json` | `no-store` |
| `webapp-build.json` | `no-store` |
| everything else (`html/*`, `device/*`, `firmware/*`) | `no-cache` — revalidate, they keep their names |

## Error codes

Both commands print `<code>: <message>` and `hint: <hint>` on stderr and exit `1`, except an
interrupted upload (`130`) and a configuration error (`2`, before either command's own checks).

| Code | Cause | Fix |
|---|---|---|
| `webapp-build-source-missing` | the workspace has no `package.json` / `vite.config.js` | run `mo webapp build` in a source checkout |
| `webapp-build-tool-missing` | `npm` is not on `PATH` | install Node.js |
| `webapp-build-dependencies-missing` | `node_modules` is absent | run `npm ci` |
| `webapp-build-out-dir-unsafe` | `--out` is `_dist/webapp` or inside it | pick another directory; it is the wheel payload |
| `webapp-build-output-missing` | `--no-build` with no `index.html` in `--out` | build first, or drop `--no-build` |
| `webapp-build-docs-url-invalid` | `--docs-url` is not an absolute `http(s)` URL | pass an absolute URL |
| `webapp-build-public-url-invalid` | `--public-url` carries a path, query or fragment | host at a vhost root and pass that |
| `webapp-build-manifest-invalid` | the manifest just written failed validation | re-run; report it if it repeats |
| `webapp-build-failed` | `npm run build` failed, or `html/version.json` is missing, unreadable or version-less | fix the reported error and re-run |
| `webapp-firmware-index-invalid` | `--firmware-index` is unusable | check it against [firmware-index.md](../firmware-compile/firmware-index.md) |
| `webapp-upload-target-invalid` | host, user or remote path missing, or a remote path that cannot be quoted | pass the flag or its `MICRO_OTTER_UPLOAD_*` variable |
| `webapp-upload-source-invalid` | `--source` has no `webapp-build.json` or no files | point `--source` at a finished build |
| `webapp-upload-manifest-invalid` | the manifest fails validation or names a file that is missing or does not match | rebuild, then upload again |
| `webapp-upload-prune-unsafe` | a prune candidate would remove `index.html` / `html/version.json` or leave the remote root | fix the source tree, then re-run |
| `webapp-upload-sftp-missing` | no `sftp` client on `PATH` | install the OpenSSH client |
| `webapp-upload-credentials-missing` | no key, no password, and no terminal to prompt on | pass `--identity-file` or set `MICRO_OTTER_UPLOAD_PASSWORD` |
| `webapp-upload-connect-failed` | `sftp` exited `255`, or the connection timed out | check host, port, user, key and `known_hosts` |
| `webapp-upload-put-failed` | any other `sftp` failure during the batch | re-run; nothing was pruned, and `index.html` was not reached |
| `webapp-upload-verify-mismatch` | a remote size or the hosted `version.json` disagrees with the manifest | upload again; check the quota and any partial write |
| `webapp-upload-version-mismatch` | the public `html/version.json` reports another version | upload again, and check the `no-store` header on that file |
| `webapp-upload-verify-failed` | the listing or the public fetch could not be completed | check the host and the recorded `publicUrl` |
| `webapp-upload-interrupted` | the transfer died on `SIGINT` (exit `130`) | re-run; the previous `index.html` is still served |

## Trying it locally

```bash
python3 -m http.server -d _dist/webapp-hosted
```

Then check, in a Chromium-based desktop browser on `http://localhost:8000`:

1. the splash screen appears and the editor loads;
2. the title bar shows no server badge, and devtools shows **no** request to `/api/*`;
3. `/firmware/` renders one section per board with working download links and copyable commands;
4. the Firmware tab shows the hosted notice, with the desktop-install line when `--docs-url` was
   passed, and devtools reports no CSP violation.

`file://` cannot work: the app is an ES module that fetches the locale, icon and version files, and
those are same-origin requests a `file://` page cannot satisfy.

## Deferred

No CI workflow, no GitHub Pages deployment, no default domain, no browser-side flasher, no analytics,
and no custom-domain automation. The publish is a maintainer command run where the credentials are.




