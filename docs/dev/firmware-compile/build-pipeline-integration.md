# Build Pipeline Integration

This document describes the current package-level orchestration for firmware compile
pipeline integration and how it extends phase-2 staging and phase-3 command contracts.

## Canonical Package Flow

The shared layer resolves *what* goes into the firmware and delegates *how* it is built to the
selected `BuildBackend`:

1. Normalize the compile request, resolving the backend-typed `BoardTarget` and the content
   inventory (`ResolvedContents`).
2. Select the build backend for the target.
3. The backend owns the rest: staging destination, optional `.mpy` precompile, the toolchain
   command, and artifact discovery.

The shared orchestration (`run_build_orchestration`) no longer imports `build_toolchain`,
`staging_paths`, or `build_artifact`; those live inside the `esp-idf` backend.

## Packaging Modes

- `source-py` (default)
  - Source-first embedding behavior
- `compiled-mpy`
  - Optional precompile branch using existing `mpy-cross` tooling path

## CLI Usage

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
  --module-packaging-mode source-py \
  --json-output
```

## Artifact Handling

- The backend discovers the produced `build-*/firmware.bin` and returns it as
  `BuildResult.artifact_path`; the compile command reads that path instead of re-deriving it.
- Verified artifacts add hash/size metadata into the result payload.

## Build guards

Two guards keep the pipeline from shipping an unbootable image:

1. **Preflight (before the toolchain).** `run_build_preflight(..., port=<port>)` checks that the
   tracked stock modules in `ports/<port>/modules` are still present, so a prior run cannot have
   compiled and deleted MicroPython's own `_boot.py` / `inisetup.py` / `flashbdev.py` / `machine.py` /
   `espnow.py` / `apa106.py`. A shadowed or deleted stock module fails before any build work, with the
   `git -C <root> checkout -- ports/<port>/modules` hint.
2. **Post-build (before publish).** `verify_frozen_module_names(<artifact parent>/frozen_content.c)`
   refuses any frozen module with an absolute name, so a `.mpy` compiled without a relative `mpy-cross
   -s` source name fails the build with exit `8` instead of being published.

Both are documented in the [Firmware Runtime Payload Contract](firmware-runtime-payload-contract.md).

## Content identity

- One resolver — `resolve_build_identity()` — computes the version, channel, and content hash
  once and hands the same tuple to the pre-build publish guard, the `device.json` constituent
  bake, and the final publish step. There is no separate `_resolve_runtime_firmware_version()`
  call site anymore.
- The firmware version comes from `resolve_firmware_version()` (tag-derived; see
  [firmware-identity.md](firmware-identity.md)), not from a lineage counter.
- The published name is `<repo>-<platformVersion>-<slug>-<runtime>-<version>-<contentHash>`,
  where `contentHash` is `firmware_content_hash(...)` — a short hash over the *logical* contents
  (`slug`, `backend`, platform version, constituents, embedded packages, add-on packages,
  `packageVariants`, selection), never the version, commit, or raw binary, so \"same composition ⇒
  same name\" survives non-reproducible builds. The variant map is the **effective** one (what was
  staged), so two images that froze different implementations never share a name.
- A `firmware-manifest.json` sidecar is published next to the `.bin` recording the content hash, the
  per-backend constituents, `embeddedPackages`/`addonPackages`/`packageVariants`/`selection`, and the
  `version` identity; build metadata (git source, finished-at) lives only in the manifest, never in
  the hash. A build that recorded variants writes `schemaVersion: 3`; an image with no packages, or a
  build that passes no variant map, keeps the v2 sidecar byte-for-byte.

## Troubleshooting By Failure Category

- `input-validation` (`exit 2`)
  - Check CLI flags and path boundaries.
- `manifest-resolution` (`exit 3`)
  - Validate runtime/device manifests.
- `staging-conflict` (`exit 4`)
  - Resolve duplicate target mappings.
- `micropython-config` (`exit 5`)
  - Verify MicroPython root and target tree.
- `build-toolchain-invocation` (`exit 6`)
  - Validate required tools (`make`, optional `mpy-cross`) availability.
- `build-command-failed` (`exit 7`)
  - Inspect compiler/build output.
- `artifact-verification` (`exit 8`)
  - Verify artifact exists and is non-empty. Also covers a frozen table with absolute module names —
    see the [Firmware Runtime Payload Contract](firmware-runtime-payload-contract.md).
- `unexpected-internal` (`exit 9`)
  - Capture full logs and payload for triage.
