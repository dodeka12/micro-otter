# Cutting a release

The one procedure a maintainer follows to publish Micro-Otter: a firmware release (one flashable
image per board, plus its exported package) and an app release (the wheel and the Windows exe). Every
command below exists in `src/micro_otter/cli/app.py`, `deploy/packaging/`, or `tools/`; none of them
is run by CI.

A release is an immutable tag: `firmware-v<base>` names the firmware release, `v<version>` names the
app release. The tag **is** the release, and the assets live on it.

## Who builds this

CI validates only. The `python`, `web`, `docs`, `packaging`, and `docker` jobs never build a
firmware image, an exe, or a tag; the `windows` job and `bump-version.yml` are
`workflow_dispatch`-only, so nothing is built, tagged, or uploaded unless a maintainer starts it.
The full job table and the local equivalents are in
[build-and-deployment.md](../dev/guides/build-and-deployment.md#cicd-integration).

Consequences: a half-verified image cannot be published by accident, and this page — not a workflow
file — is the authority on what a release contains.

## Why `firmware-v` and not `v`

The Python package version is derived by setuptools-scm/hatch-vcs from plain `v*` tags
(`v1.25.0`, …). A bare `v1.0.0` firmware tag would therefore **rewrite the package version**.
The `firmware-v` prefix keeps the two tag spaces independent — it is the single reason the prefix
is not optional.

## Prerequisites

- A clean checkout of the commit to release, with `git status` empty.
- A Docker host able to build the compile image (`deploy/docker/Dockerfile.compile`); the firmware
  builds run inside it, never on the host toolchain.
- A Windows host for the exe (`build-exe.ps1` cannot cross-compile).
- An authenticated `gh` (`gh auth status`), and a `git` identity whose tags are signed.
- `npm run check:firmware-release` green, and `uv sync --group dev` run once so `uv run mo …`
  resolves.

## Part 1 — Firmware release (`firmware-v<base>`)

### 1. Bump the manifest and commit

Edit `src/micro_otter/nodes/device/firmware/release.json` in the release commit:

- `releaseVersion` → the new plain `X.Y.Z` base,
- `kind` → `stable` or `prerelease`,
- `tag` → `firmware-v<releaseVersion>`,
- `releasedAtUtc` → `null` (filled by the follow-up commit, because the exact publish time is not
  known when the commit is authored).

Run `npm run check:firmware-release`, then commit.

### 2. Build every board in the compile image

The board list is the `slug` of each entry in
`src/micro_otter/nodes/device/firmware/boards.json` — currently `esp32`, `esp32_generic_s3`,
`esp32_generic_s2`. The only runtime id is `general`.

```bash
cd deploy/docker
docker compose --profile runtime build
docker compose --profile compile build

mkdir -p ../../dist/firmware
for board in esp32 esp32_generic_s3 esp32_generic_s2; do
    docker compose --profile compile run --rm --entrypoint micro-otter \
        -v "$PWD/../../dist/firmware:/data/firmware" \
        micro-otter-compile compile-runtime --runtime-id general --board "$board"
done
```

`/data/firmware` is the image's own `MICRO_OTTER_FIRMWARE_DIR`, so the mount is what puts the built
images on the host. Compiling inside the image also builds with the toolchain pins from
`deploy/toolchain/versions.env` — the same pins the released image claims.

### 3. Export the packages and collect the assets

The publish root now holds, per board, the image `<stem>.bin` and its `<stem>.manifest.json`
sidecar. Export the package the release recommends, and copy both raw artifacts next to it:

```bash
uv run mo fw list --firmware-dir dist/firmware          # read the <stem> of each new image
uv run mo fw export <base> --board <slug> --output-dir dist/release-<base> \
    --firmware-dir dist/firmware
cp "dist/firmware/<stem>.bin" "dist/firmware/<stem>.manifest.json" dist/release-<base>/
```

Repeat for every board. The directory then holds three files per board: `<stem>.bin`,
`<stem>.manifest.json`, `<stem>.firmware.zip`.

### 4. Generate the index and the release body

```bash
uv run python tools/make_release_index.py \
    --release-dir dist/release-<base> \
    --base-url https://github.com/<owner>/micro-otter/releases/download/firmware-v<base>
```

This writes `index.json` (one entry per board, absolute URLs, SHA-256 and size measured from the
bytes on disk) and `release-notes.md` (the release body). The contract — options, document shape,
failure codes — is [firmware-index.md](../dev/firmware-compile/firmware-index.md). `index.json` stays
in `dist/release-<base>/` for now; hosting it is M9's job, and nothing in `src/micro_otter/` reads it.

### 5. Manual gates before anything is uploaded

Two things are **not** enforced by any tool; check them by hand, and stop if either fails. A build
from a development clone carries a `-dev.<n>.g<sha>` version, and the index, the notes and the tag
all quote `release.json`'s number.

```bash
# 1. Nothing dev-flavoured may reach the release.
! find dist/release-<base> -maxdepth 1 \
    \( -name '*-dev.*' -o -name '*-dev-*' \) -print -quit | grep -q .

# 2. Every published image carries exactly the released version segment.
grep -q -- '-<base>-' <(ls dist/release-<base>/*.bin)
```

`tools/make_release_index.py` already refuses a non-`release` channel
(`release-index-channel-mismatch`) and a version that disagrees with `release.json`
(`release-index-version-mismatch`), so a `-dev` image normally fails at step 4. These gates catch the
case where the images are right but a stale file was copied into the directory afterwards. No script
renames a dev file — rebuild the image instead.

### 6. Tag and upload

```bash
git tag -s firmware-v<base> -m "Firmware <base>"
git push origin firmware-v<base>

gh release create firmware-v<base> --verify-tag --latest=false \
    --title "Firmware <base>" \
    --notes-file dist/release-<base>/release-notes.md \
    dist/release-<base>/*.bin dist/release-<base>/*.firmware.zip
```

`--verify-tag` makes `gh` fail instead of silently creating the tag at `HEAD`, which is the mistake
that would publish assets for the wrong commit. `--latest=false` (recent `gh`) keeps the *Latest*
badge on the app release, so a visitor looking for the installer is not sent to a firmware page. The
sidecars travel inside each `.firmware.zip`; they are not separate assets.

### 7. Fill `releasedAtUtc`

In a follow-up commit, set `releasedAtUtc` to the real ISO-8601 `Z` timestamp of the upload. Nothing
reads it yet; it is the record M9/M10 will use instead of guessing from the tag date.

## Part 2 — App release (`v<version>`)

The app release carries the wheel and, for Windows users, the exe. It never carries a firmware image
— no installer artifact does (see *Firmware view → Get an official image* in the user docs).

```bash
bash deploy/packaging/build-wheel.sh
bash deploy/packaging/verify-wheel.sh

git tag -s v<version> -m "Micro-Otter <version>"
git push origin v<version>
```

On a Windows host, build and smoke-test the exe **from the same commit**:

```powershell
pwsh -File deploy/packaging/build-exe.ps1
dist\micro-otter.exe --help
dist\micro-otter.exe serve --port 8123   # then open http://localhost:8123 and stop it
```

Upload the exe to the **app** release, never to the firmware release, so the two tag spaces stay
independent:

```bash
gh release create v<version> --verify-tag --title "Micro-Otter <version>" --generate-notes \
    dist/micro_otter-*.whl dist/micro-otter.exe
```

## Part 2b — Hosted web app

The hosted editor is a static bundle published to the maintainer's own host. It carries no firmware
image and never touches a release asset.

```bash
uv run mo webapp build \
    --firmware-index dist/release-<base>/index.json \
    --docs-url <docs url> \
    --public-url <site url>
uv run mo webapp upload --verify
```

Build from the released commit, with the `index.json` from Part 1 step 4, so the `/firmware/` page
always describes the images that were just published. Read `appVersion` in `webapp-build.json` — it
must be the version being released, not a `-dev` one — then publish with `--verify` and confirm that
`https://<site>/html/version.json` reports that same version.

`--verify` compares the remote sizes with the manifest and the public `version.json` with the
manifest's `appVersion`, so a stale cache or a half-finished upload fails the command. Options,
`MICRO_OTTER_UPLOAD_*` variables, prune safety, host requirements and every error code are in
[hosted-webapp.md](../dev/deployment/hosted-webapp.md).

## Part 3 — Verification without a board

The one check every release can run anywhere: import the published package into an empty publish
root and look at what landed. This proves the URL, the checksum, the sidecar and the package
inventory, without a board attached.

```bash
uv run mo fw import --url \
    https://github.com/<owner>/micro-otter/releases/download/firmware-v<base>/<stem>.firmware.zip \
    --firmware-dir /tmp/fw-check
uv run mo fw list --firmware-dir /tmp/fw-check --json
```

The imported entry must report `hasManifest: true`, a `contentHash`, `runtimeFirmwareVersion` equal
to `<base>`, and a populated `embeddedPackages`. An image that imports with an empty inventory is the
wrong artifact (a bare `.bin`), not a pass. Delete `/tmp/fw-check` afterwards.

Flashing an imported image on a real board is still a separate, deferred check: it needs hardware.

## Rules

- Never move or delete a pushed `firmware-v*` or `v*` tag.
- Never bump `release.json` except when cutting a new tag.
- `release.json` is metadata, not the version source — the tag is.
- Never upload a `-dev.` artifact, a firmware image to the app release, or an exe to the firmware
  release.
- A hosted publish uploads static files only; it never rewrites, moves or deletes a release asset.
- `npm run check:firmware-release` (also part of `check:ci-local`) validates `release.json` and, when
  `GITHUB_REF` names a `firmware-v*` tag, asserts the tag equals `firmware-v<releaseVersion>`.

## What this page does not cover

- **Hosting the index.** `index.json` is generated next to the assets and rendered into the hosted
  `/firmware/` page (Part 2b); it is not attached as a release asset. No URL is defaulted anywhere, so
  the Firmware tab's **Import from URL…** field still starts empty.
- **Code signing, notarization, and OTA.** There is no code-signing step, no notarization, and no
  delta/OTA or rollback channel in this procedure.
- **Windows-native firmware compile.** The compile image (or WSL with a Docker daemon) stays the only
  firmware build path.
- **The collection source-upload fallback.** Releases change nothing in deployment: `missing` and
  `override-required` packages still upload local source with the existing warning.

