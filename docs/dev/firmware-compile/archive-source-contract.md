# Archive Source Contract

The one place that answers **"where is the archive?"** for `addon.install`,
`firmware.import`, and the `mo addons` / `mo firmware` verbs. Two inputs, mutually
exclusive: a **path** the server can already see, or a **URL** the server may fetch.
The server never receives archive bytes from the client — it resolves either form
into one local file through `micro_otter.tools.archive_source`, with a caller-chosen
suffix (`.zip` for add-on and firmware packages, `.bin` for a raw MicroPython image).

## Path policy

A path is expanded, resolved, and must be an **existing regular file** whose suffix
(case-insensitive) is in the caller's accepted suffix list and that stays within the
caller's byte cap. The server never accepts a directory here; `mo addons package`
turns a directory into an archive whose members live under `<folder>/` (the shape
`addon.install` accepts without `--as`), skipping `.DS_Store`, `Thumbs.db`, and
`__pycache__`.

| Condition | Code |
|-----------|------|
| Missing path, not a file, or suffix not in the accepted list | `archive-path-invalid` |
| File above the caller's byte cap | `archive-too-large` |

`archive-too-large` names the actual size and the cap in the message, with the hint
"Package fewer or smaller sources, or raise the documented cap."

## Suffix policy

The accepted suffixes are a parameter, not a second policy. `resolve_archive_source`
defaults to `DEFAULT_ARCHIVE_SUFFIXES = (".zip",)`; the firmware binary import passes
`(".bin",)` for a raw image. For the URL branch the first entry is used as the
temporary file suffix, so a downloaded `.bin` keeps a truthful name. An empty suffix
list or any entry without a leading dot is a programming error (`ValueError`). The
suffix list never weakens the byte cap, and the URL policy below is identical for
both suffixes.

## URL policy

The server fetches a URL on the user's behalf, so on a public-interface server it
must never reach a private host, and it never follows an unvalidated hop.

| Rule | Value |
|------|-------|
| Scheme | `https` always; `http` only towards loopback (`is_loopback_host`) |
| Redirect budget | At most three redirects, each hop re-validated against the same policy |
| Body | Streamed in 64 KiB chunks with a running byte counter that aborts at the caller's cap |
| Timeouts | 30 s socket timeout, applied to the connect and to each read (`ARCHIVE_URL_TIMEOUT_SECONDS`) |

| Condition | Code |
|-----------|------|
| Scheme not `http`/`https`, or missing hostname | `archive-url-invalid` |
| `http` towards a non-loopback host | `archive-url-blocked` |
| More than three redirect hops | `archive-url-redirect` |
| Body above the caller's cap | `archive-url-too-large` |
| `HTTPError` / `URLError` / `TimeoutError` | `archive-url-unreachable` |

## Ownership

`resolve_archive_source` yields one local path. For a **path** the caller owns the
file and nothing is deleted; for a **url** a temp file (`mo-<label>-*.<suffix>`) is
created, yielded, and unlinked in a `finally` block, so **the yielded path is only
valid inside the context manager**.

## Code table

The `archive-*` codes are defined once in `archive_source.py` as
`ARCHIVE_SOURCE_ERROR_CODES` and splatted into the WebSocket `ERROR_CODES`, so the
protocol document's table and the client's error-code list stay in lock-step:

- `archive-path-invalid`
- `archive-too-large`
- `archive-url-invalid`
- `archive-url-blocked`
- `archive-url-redirect`
- `archive-url-unreachable`
- `archive-url-too-large`

## Packaging a directory

`package_addon_source(package_dir, destination=None, *, force=False)` turns a
validated add-on directory into a **reproducible** archive: members are written in
sorted relative-POSIX order, and every member gets a fixed `1980-01-01` timestamp
and `0o644` mode, so two runs over the same tree produce byte-identical archives.
Tree validation stays in `addon_archive.validate_addon_tree`, which the CLI runs
first. An existing destination raises `FileExistsError` unless `force` is set.
