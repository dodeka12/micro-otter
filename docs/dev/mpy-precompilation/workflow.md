# MPY Precompilation Workflow

This guide describes how developers should generate and maintain `.mpy` artifacts for device runtimes and node packages.

## Goals

- Keep precompiled artifacts deterministic and reproducible.
- Keep compile settings tracked in manifests.
- Keep Python and frontend tooling aligned on compile-profile hash behavior.

## Compile Source Discovery

The compiler gathers Python sources from manifests:

- Runtime files from each runtime manifest's `filesystem` entries.
- Node package files from package manifest `mpAssets` entries.
- Installed add-on packages: every package in `addons_dir` (default `<home>/addons`), whether or
  not a runtime manifest lists it, because `mpyCompileProfiles` drives the deploy classification for
  add-ons too.

Compiled outputs are written next to the source file using:

- `__mpycache__/<hash>/<module>.mpy`

This keeps cache artifacts colocated with source ownership while preserving profile separation by hash.

### Add-ons folder coverage

`mo compile-mpy` covers the add-ons folder by passing `addons_root` (`Config.addons_dir`) to
`gather_sources_from_manifests`, `resolve_package_dir`, and `clean_mpycache_dirs`. Two flags change
that scope:

| Flag | Effect |
|------|--------|
| `--skip-addons` | Compiles the shipped device tree only; the add-ons tree stays byte-identical. |
| `--dry-run` | Reports the source set and the profile hash, but compiles nothing, cleans nothing, and rewrites no manifest. |

The JSON payload therefore also reports `addonManifestsUpdated` and `addonsSkipped`. Cleaning is
store-driven: `clean_mpycache_dirs` removes a `__mpycache__` inside each *installed* package, never by
walking the add-ons root, so `.staging/` and `.trash/` cannot be deleted from under an install.

### Manifest write-back is atomic

`mo compile-mpy` is the only tool that writes into user data: it adds a `mpyCompileProfiles` entry to
an installed add-on's `manifest.json`. `save_json` therefore writes a sibling temp file
(`<name>.<pid>.tmp`), flushes and `fsync`s it, and renames it over the target with `os.replace` —
atomic within a filesystem, and the temp file must live next to the manifest, never in a system temp
directory. A crash leaves either the old manifest or the complete new one.

`update_manifests_with_profile` only owns that one key: the payload it writes is a copy of the
manifest with the single profile record set, so `mpAssets`, `requiredCapabilities`, `precedence`,
unknown keys, and key order survive verbatim. A manifest whose serialized content would not change is
not rewritten at all, which makes repeated runs free.

## Compile Profile Metadata

Each compile run produces a short profile hash from canonical parameters and compiler version metadata.

The tool records profile metadata under:

- `mpyCompileProfiles` in runtime manifests.
- `mpyCompileProfiles` in node package manifests.

Every key in `mpyCompileProfiles` is a hash string. The value stores the compile parameters used to produce that profile.

## Hash Spec

Compile-profile hashes must follow the canonical algorithm defined in [hash-spec.md](hash-spec.md).

Do not introduce local hashing variants in tooling, tests, or frontend code. Any hash behavior update must be coordinated as a shared spec change.

## Standard Developer Commands

### Probe And Compile

```bash
mo compile-mpy --from-device --port <serial-port>
```

Alias form:

```bash
mo cmpy --from-device --port <serial-port>
```

JSON output for automation:

```bash
mo compile-mpy --from-device --json-output
```

## Mpy-only Firmware Packaging

`mo cr --module-packaging-mode compiled-mpy` produces an image whose module tree is mpy-only. The
the `esp-idf` backend runs the precompile step **inside** staging, before
`otter/embedded_hashes.json` is written, so the hash table describes the tree that actually ships:

1. **Select.** `run_optional_mpy_precompile(..., staged_paths=..., source_excludes=...)` receives the
   sorted staged relative paths the backend collected plus the runtime manifest's
   `mpySourceExcludes` list (normalized by `mpy_precompile.normalize_mpy_source_excludes`, the same
   helper `mo compile-mpy` uses). Only staged paths that still exist and end in `.py` are compiled, so
   MicroPython's own modules in `ports/<port>/modules` are never touched; `mpySourceExcludes` paths
   (`main.py`, `app/main_loop.py`) are never compiled and never removed — the boot path imports them
   by name and the collection-preserving deploy path rewrites `app/main_loop.py`.
2. **Compile.** Every selected `.py` module is compiled to a sibling `.mpy` through
   `compile_sources_to_sibling_mpy`, which passes `mpy-cross -s <staged relative path>` so the `.mpy`
   header records a **relative** source name. The freezer names a module after that header
   (`tools/mpy-tool.py freeze`), so without `-s` a staged `.mpy` freezes as an absolute host path that
   no `import` statement can resolve — see the
   [Firmware Runtime Payload Contract](../firmware-compile/firmware-runtime-payload-contract.md).
   (`__mpycache__` artefacts are a separate concern.)
3. **Remove.** Each compiled `.py` source is deleted only after its `.mpy` sibling exists and is
   non-empty; a missing or zero-byte sibling raises `RuntimeError("mpy output missing for <path>")`
   so a partial compiler failure can never delete the only copy. `PrecompileResult.sources_removed`
   reports the count as `metadata.mpySourcesRemoved`.
4. **Reconcile.** `staging_runner._reconcile_entries_after_precompile` swaps staged entries whose
   `.py` target disappeared to their `.mpy` sibling before `build_embedded_hash_records` runs, so
   `embedded_hashes.json` lists `otter_stdmo/motor.mpy` rather than a deleted `.py`. The web app
   already maps a remote `.mpy` path back to its `.py` source (`_removeConflictingPySourceForMpy`),
   so no frontend change is required.

Dry-run skips the staging hook entirely, so a dry-run build reports `metadata.precompiledFiles` and
`metadata.mpySourcesRemoved` as `0` and emits no `metadata.mpyCrossPath`. Called directly with
`dry_run=True`, `run_optional_mpy_precompile` resolves the compiler and reports
`files_compiled=0` / `sources_removed=0` without touching the tree. `source-py` mode is unchanged:
nothing is compiled and no source is removed.

This page is the canonical statement of the `.py`-removal-after-verify rule and of the
`mpySourceExcludes` set. For how the mode interacts with package selection — and why neither changes
what a deploy uploads — see
[package-selection.md](../firmware-compile/package-selection.md#packaging-mode).

## Device Syntax Gate

The device tree is MicroPython firmware and is deliberately **not** ruff-linted. Ruff cannot lint
that dialect correctly:

- `F821` flags viper intrinsics such as `ptr16`, which only the MicroPython compiler provides.
- `UP038` rewrites `isinstance(x, (int, float))` into a PEP 604 union, which raises `TypeError`
  on MicroPython (there is no PEP 604 union support for type objects in `py/objtype.c`).
- `B905` adds `zip(..., strict=True)`, which the pinned MicroPython `zip` does not accept.
- `node_pkgs/mqtt/otter_mqtt/umqtt/simple.py` is vendored third-party code.

Instead, `src/micro_otter/nodes/device/` is covered by a compile gate that uses the same
compiler and version as the firmware build:

```bash
npm run check:device-syntax
```

which is `uv run python tools/check_device_syntax.py`. Useful flags:

| Flag | Purpose |
|------|---------|
| `--march=<arch>` | Check a single architecture (repeatable). Default: `xtensa` and `xtensawin`. |
| `--device-root <dir>` | Check another tree (default: `src/micro_otter/nodes/device`). |
| `--mpy-cross <path>` | Use a specific compiler (default: `$MPY_CROSS`, then `/opt/micropython/mpy-cross/build/mpy-cross`, then `PATH`). |
| `--verbose` | List every compiled file instead of only the summary. |

`xtensa` and `xtensawin` are the ABI variants of the two boards in
`src/micro_otter/nodes/device/firmware/boards.json` (ESP32 and ESP32-S3), so the default run
covers both. `-march` is mandatory for the gate: viper and native-decorated code is only
validated when the compiler resolves an architecture.

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | Every device file compiled for every requested architecture. |
| `1` | At least one compile failure. Every failure is reported with file, architecture, and compiler output. |
| `2` | The gate itself is broken: compiler not found, unsupported `-march`, missing device root, or an empty source selection. |

The distinction matters: exit `1` means device code is broken, exit `2` means the toolchain or
configuration is, and CI should not conflate them.

The gate writes bytecode to `/dev/null` and never touches the repository, so it is safe to run
at any time. It is a syntax check, not a precompile step: `mo compile-mpy` /
`tools/compile_runtime_mpy.py` and the firmware build own `__mpycache__` artefact generation
(see [Compile Source Discovery](#compile-source-discovery)).

## Compiled Is Not Available: The Runtime API Surface

`mpy-cross` proves that device code **parses and compiles** for the target ABI. It proves nothing
about the calls inside that code: attribute access is resolved at runtime, so a method MicroPython
does not implement still compiles into valid bytecode and raises `AttributeError` on the board.

Two such calls shipped in runtime 1.50.0 (MicroPython v1.29.0, ESP32-S3) and stopped the
controller on every boot:

| Call | Where | Why it is wrong |
|------|-------|-----------------|
| `str.isalnum()` | `node_pkgs/hass/otter_hass/runtime.py` | `py/objstr.c` implements only `isspace`, `isalpha`, `isdigit`, `isupper`, `islower` for one-character strings |
| `Task.exception()` | `runtime/general/otter_main.py`, `runtime/general/otter_runtime/web_interface.py` | `uasyncio.Task` has no `exception()`; inspect a finished task by awaiting it |

The first one aborted the main loop at import time; the second turned that failure into an
unreadable restart loop because the supervisor crashed while reporting it. Both are cheap to
prevent, so device work uses two gates:

1. **Compile gate** — `npm run check:device-syntax` (above).
2. **API-subset gate** — `pytest tests/test_device_micropython_api_guard.py`. It scans every file
   under `src/micro_otter/nodes/device/` and fails on any call in its `FORBIDDEN_CALLS` table —
   CPython-only `str` methods (`isalnum()`, `isascii()`, `removeprefix()`, `title()`,
   `translate()`, …) and `asyncio.Task.exception()`. A line that is correct by design can opt out
   with a `micropython-api-ok` marker on the same or the preceding line, so escapes stay
   reviewable.

When you add a runtime call that is not obviously part of the MicroPython subset, confirm it
against the pinned implementation (`py/objstr.c`, `py/objdict.c`, `extmod/asyncio/*` at the
firmware's MicroPython tag) or the MicroPython docs, then add the rejected CPython form to
`FORBIDDEN_CALLS`. Coding tasks must treat this as mandatory — see the `code` skill.

## Validation Checklist

1. Confirm new `.mpy` files exist under `__mpycache__/<hash>/` adjacent to each source module.
2. Confirm relevant runtime manifests include the generated hash in `mpyCompileProfiles`.
3. Confirm relevant node package manifests include the generated hash in `mpyCompileProfiles`.
4. Confirm hash generation still matches [hash-spec.md](hash-spec.md).
5. Confirm `npm run check:device-syntax` exits `0` after any device-tree edit.
6. Confirm `pytest tests/test_device_micropython_api_guard.py` passes, and that every newly used
   MicroPython call was confirmed against the MicroPython source or docs
   (see [Compiled Is Not Available](#compiled-is-not-available-the-runtime-api-surface)).

## Implementation Note

If hash logic changes, update both Python and JavaScript implementations in the same change and document the update in [hash-spec.md](hash-spec.md).
