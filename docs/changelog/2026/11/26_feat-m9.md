# Changes since version 1.43.0

## New Features

- **The editor can run as a static, serverless web app** — `mo webapp build` builds the same
  application in Vite hosted mode (`MICRO_OTTER_HOSTED=1`) into `_dist/webapp-hosted`, through one
  environment seam (`MICRO_OTTER_HOSTED`, `MICRO_OTTER_WEBAPP_OUT`, `MICRO_OTTER_WEBAPP_DOCS_URL`)
  rather than a second npm script. It writes a `webapp-build.json` manifest with one
  `{path, size, sha256}` row per file, refuses `_dist/webapp` (the wheel payload) as an output
  directory, and gates the local server by simply not starting the server monitor: no capability
  probe, no `/api/*` request, no title-bar badge, no reconnect dialog.
- **Hosted mode keeps Deploy** — WebSerial stays the only device path and the collection deploy path
  is unchanged, including the source upload for `missing` / `override-required` packages; only the
  local-server firmware features are gated. The Firmware tab shows its existing offline panel with a
  hosted body and, when `--docs-url` is given, a link to where the desktop app is obtained.
- **The hosted bundle ships a Content Security Policy** — `default-src 'self'` plus
  `script-src 'self'`, `connect-src 'self'`, no wildcard, injected as a `<meta>` element. Getting
  there moved the inline splash `<style>` and `<script>` into
  `html/styles/standard/initial-loading.css` and `js/app/initial-loading.ts` and replaced three
  `eval()` feature probes with direct syntax checks; the KaTeX CDN is a third-party source and is
  therefore unavailable in hosted builds, where math falls back to readable source text.
- **`/firmware/` is generated from a release index** — `--firmware-index` renders one section per
  board with the `.bin` and `.firmware.zip` downloads, SHA-256, firmware and MicroPython versions,
  and copyable esptool commands for Linux/macOS, Windows and `erase_flash`, plus a CSP and no
  `<script>`. The page is a pure render of the index (no runtime fetch, no default index URL) and two
  renders are byte-identical; the contract is
  [firmware-index.md](../../../dev/firmware-compile/firmware-index.md).
- **`mo webapp upload` publishes the bundle to any SFTP host** — the manifest drives one `sftp -b`
  batch in publication order (hashed assets, `html/version.json`, `webapp-build.json`, `index.html`
  last), with parents created first, `--prune` limited to files the manifest does not list and never
  the two live entry points, and `--verify` comparing remote sizes plus the hosted and, when a
  `--public-url` was recorded, the public `html/version.json` against the manifest's `appVersion`.
  `--dry-run` plans without connecting, `--json-output` is machine-readable, key auth is the default,
  the password path goes through `SSH_ASKPASS` and is redacted everywhere, and every failure carries
  a `webapp-upload-*` code.
- **Users are told what the hosted app cannot do** — a new *Hosted web app* page says which features
  work without a server, how to install an image by hand from `/firmware/`, and that Web Serial needs
  a secure context; the *Firmware view* and app index point at it, and the release procedure has a
  hosted-publish part that never touches a release asset.

