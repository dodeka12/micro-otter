"""Render the hosted ``/firmware`` manual-install page from a release index.

The page is a pure render of the ``index.json`` the caller passes to ``mo webapp build``: it adds no
release facts of its own, fetches nothing at runtime, and reads no board catalog (the index already
carries ``chip`` and ``flashOffset``). Reproducible by construction — two renders of the same index
are byte-identical — and script-free, so the bundle's strict CSP holds without a second exception.
"""

from __future__ import annotations

import html
import json
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

from micro_otter.tools.webapp_csp import HOSTED_CSP_POLICY
from micro_otter.tools.webapp_errors import WebappError

INDEX_SCHEMA_VERSIONS = (1, "1", "firmware-index/1")
"""Accepted root ``schemaVersion`` values.

``tools/make_release_index.py`` writes the integer ``1``; the string spellings are accepted so a
hand-written index may name the schema instead of numbering it.
"""

_LINE_BREAK_CHARS = ("\n", "\r", "\0")
"""Characters that would break a one-line HTML value and are rejected in every index string."""

_HEX_DIGITS = set("0123456789abcdef")
"""Alphabet of a lowercase SHA-256 hex digest."""

_FIRMWARE_CSS = """\
:root {
    color-scheme: light dark;
    --page-bg: #f7f7f5;
    --panel-bg: #ffffff;
    --page-fg: #1c1c1a;
    --muted-fg: #5b5b55;
    --accent: #2f6f4f;
    --rule: #dcdcd6;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    padding: 2.5rem 1.25rem 4rem;
    background: var(--page-bg);
    color: var(--page-fg);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.55;
}

main {
    max-width: 52rem;
    margin: 0 auto;
}

h1 {
    font-size: 1.9rem;
    margin: 0 0 0.75rem;
}

h2 {
    font-size: 1.3rem;
    margin: 0 0 0.25rem;
}

h3 {
    font-size: 1rem;
    margin: 1.5rem 0 0.5rem;
}

a {
    color: var(--accent);
}

.lead {
    color: var(--muted-fg);
    margin: 0 0 2rem;
}

.board {
    background: var(--panel-bg);
    border: 1px solid var(--rule);
    border-radius: 0.5rem;
    padding: 1.25rem 1.5rem 1.5rem;
    margin: 0 0 1.5rem;
}

.board__slug,
.board__release {
    color: var(--muted-fg);
    font-size: 0.9rem;
    margin: 0.15rem 0;
}

.board__downloads {
    margin: 1rem 0 0;
}

.board__downloads a {
    margin-right: 1rem;
}

pre {
    background: #1c1c1a;
    color: #f2f2ee;
    border-radius: 0.375rem;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.5rem 0 0;
}

code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.9rem;
}

.board__sha {
    word-break: break-all;
}

@media (prefers-color-scheme: dark) {
    :root {
        --page-bg: #161614;
        --panel-bg: #1f1f1c;
        --page-fg: #f2f2ee;
        --muted-fg: #b3b3aa;
        --accent: #7fd1a5;
        --rule: #33332e;
    }

    pre {
        background: #0d0d0c;
    }
}
"""
"""Stylesheet written next to the page.

Literal colours, because the page cannot rely on the editor's theme files and must not add an
inline ``<style>`` the strict CSP would refuse. A dark-mode block keeps the page readable when the
visitor's browser prefers it.
"""


def _invalid(field: str, problem: str) -> WebappError:
    """Return the index-validation failure for *field* describing *problem*."""

    return WebappError(
        "webapp-firmware-index-invalid",
        f"{field} {problem}",
        hint="fix the release index; `tools/make_release_index.py` writes the expected shape",
    )


def _require_text(entry: Any, field: str, index: int, *, label: str | None = None) -> str:
    """Return ``firmware[i].<field>`` as a non-empty, single-line string."""

    name = label or f"firmware[{index}].{field}"
    value = entry.get(field) if isinstance(entry, dict) else None
    if not isinstance(value, str):
        raise _invalid(name, "must be a string")
    if any(char in value for char in _LINE_BREAK_CHARS):
        raise _invalid(name, "must not contain line breaks or NUL")
    if not value.strip():
        raise _invalid(name, "must not be empty")
    return value


def _require_sha256(entry: Any, field: str, index: int) -> str:
    """Return ``firmware[i].<field>`` as a lowercase 64-character SHA-256 digest."""

    value = _require_text(entry, field, index)
    if len(value) != 64 or not set(value) <= _HEX_DIGITS:
        raise _invalid(f"firmware[{index}].{field}", "must be a lowercase 64-character hex digest")
    return value


def _require_size(entry: dict[str, Any], index: int) -> int:
    """Return ``firmware[i].size`` as a non-negative byte count."""

    value = entry.get("size")
    if isinstance(value, bool) or not isinstance(value, int):
        raise _invalid(f"firmware[{index}].size", "must be an integer")
    if value < 0:
        raise _invalid(f"firmware[{index}].size", "must not be negative")
    return value


def _normalise_offset(entry: dict[str, Any], index: int) -> str:
    """Return ``firmware[i].flashOffset`` as ``0x…`` from an int or a catalog string."""

    name = f"firmware[{index}].flashOffset"
    value = entry.get("flashOffset")
    if isinstance(value, bool):
        raise _invalid(name, "must be an integer or a 0x… string")
    if isinstance(value, int):
        offset = value
    elif isinstance(value, str):
        try:
            offset = int(value.strip(), 0)
        except ValueError as error:
            raise _invalid(name, "must be an integer or a 0x… string") from error
    else:
        raise _invalid(name, "must be an integer or a 0x… string")
    if offset < 0:
        raise _invalid(name, "must not be negative")
    return f"0x{offset:x}"


def _entry_filename(url: str, board: str) -> str:
    """Return the artifact file name a flashing command can use, derived from *url*."""

    name = PurePosixPath(urlparse(url).path).name
    return name or f"{board}.bin"


def _normalise_chip(entry: dict[str, Any], index: int) -> str:
    """Return ``firmware[i].chip`` as an esptool chip token (``""`` when the catalog omits it)."""

    value = entry.get("chip")
    if not isinstance(value, str) or any(char in value for char in _LINE_BREAK_CHARS):
        raise _invalid(f"firmware[{index}].chip", "must be a single-line string")
    if value and not (value.isascii() and value.replace("_", "").isalnum()):
        raise _invalid(
            f"firmware[{index}].chip",
            "must be an esptool chip name (letters, digits and underscores)",
        )
    return value


def _normalise_entry(entry: Any, index: int) -> dict[str, Any]:
    """Validate one ``firmware[i]`` entry and return the fields the page renders."""

    if not isinstance(entry, dict):
        raise _invalid(f"firmware[{index}]", "must be an object")

    board = _require_text(entry, "board", index)
    url = _require_text(entry, "url", index)

    package = entry.get("package")
    package_url: str | None = None
    if package is not None:
        if not isinstance(package, dict):
            raise _invalid(f"firmware[{index}].package", "must be an object")
        if package.get("url") is not None:
            package_url = _require_text(
                package,
                "url",
                index,
                label=f"firmware[{index}].package.url",
            )

    return {
        "board": board,
        "boardName": _require_text(entry, "boardName", index),
        "chip": _normalise_chip(entry, index),
        "flashOffset": _normalise_offset(entry, index),
        "version": _require_text(entry, "version", index),
        "micropythonVersion": _require_text(entry, "micropythonVersion", index),
        "sha256": _require_sha256(entry, "sha256", index),
        "size": _require_size(entry, index),
        "url": url,
        "packageUrl": package_url,
        "filename": _entry_filename(url, board),
    }


def _release_fields(document: dict[str, Any]) -> dict[str, str | None]:
    """Return the release ``version`` / ``tag`` the document states, or ``None`` per field."""

    release = document.get("release")
    if not isinstance(release, dict):
        return {"version": None, "tag": None}

    def _text(key: str) -> str | None:
        value = release.get(key)
        return value if isinstance(value, str) and value.strip() else None

    return {"version": _text("version"), "tag": _text("tag")}


def load_firmware_index(path: Path) -> dict[str, Any]:
    """Read a release index and validate the fields the ``/firmware`` page renders.

    Only that subset is enforced: root ``schemaVersion`` (``1``, as
    ``tools/make_release_index.py`` writes it, or a ``firmware-index/…`` string) and a non-empty
    ``firmware`` list whose entries carry ``board``, ``boardName``, ``chip``, ``flashOffset``,
    ``version``, ``micropythonVersion``, ``sha256``, ``size`` and ``url``; ``package.url`` is
    optional. Anything else the document says — ``generatedAt``, ``includedPackages`` — is left
    alone, so a newer index never fails for a field the page does not use.

    Returns the normalised document ``{"schemaVersion", "release", "firmware"}`` whose entries are
    what :func:`render_firmware_page` consumes.

    Raises:
        WebappError: ``webapp-firmware-index-invalid`` naming the entry index and the field.
    """

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise WebappError(
            "webapp-firmware-index-invalid",
            f"{path} does not exist",
            hint="pass --firmware-index with an index.json written by tools/make_release_index.py",
        ) from error
    except (OSError, UnicodeDecodeError) as error:
        raise WebappError(
            "webapp-firmware-index-invalid",
            f"{path} cannot be read: {error}",
            hint="pass a readable UTF-8 JSON release index",
        ) from error
    except json.JSONDecodeError as error:
        raise WebappError(
            "webapp-firmware-index-invalid",
            f"{path} is not valid JSON: {error.msg} at line {error.lineno}",
            hint="pass an index.json written by tools/make_release_index.py",
        ) from error

    if not isinstance(document, dict):
        raise _invalid("the document", "must be a JSON object")

    schema = document.get("schemaVersion")
    if isinstance(schema, bool) or schema not in INDEX_SCHEMA_VERSIONS:
        raise _invalid(
            "schemaVersion",
            f'is {schema!r}; expected 1, "1" or "firmware-index/1"',
        )

    firmware = document.get("firmware")
    if not isinstance(firmware, list) or not firmware:
        raise _invalid("firmware", "must be a non-empty list")

    return {
        "schemaVersion": 1,
        "release": _release_fields(document),
        "firmware": [
            _normalise_entry(entry, index) for index, entry in enumerate(firmware)
        ],
    }


def _flash_commands(entry: dict[str, Any]) -> list[tuple[str, str]]:
    """Return the ``(label, command)`` pairs the page prints for one board."""

    chip_flag = f" --chip {entry['chip']}" if entry["chip"] else ""
    offset = entry["flashOffset"]
    filename = entry["filename"]
    return [
        (
            "Linux or macOS",
            f"python3 -m esptool{chip_flag} --port /dev/ttyUSB0 "
            f"write_flash {offset} {filename}",
        ),
        (
            "Windows",
            f"py -m esptool{chip_flag} --port COM3 write_flash {offset} {filename}",
        ),
        (
            "Start from a clean flash (optional)",
            f"python3 -m esptool{chip_flag} --port /dev/ttyUSB0 erase_flash",
        ),
    ]


def _board_section(entry: dict[str, Any]) -> list[str]:
    """Return the HTML lines of one board's ``<section>``."""

    escape = html.escape
    board = escape(entry["board"], quote=True)
    size_mb = entry["size"] / (1024 * 1024)
    lines = [
        f'<section class="board" id="board-{board}">',
        f"<h2>{escape(entry['boardName'], quote=True)}</h2>",
        '<p class="board__slug">board <code>'
        f"{board}</code> &middot; chip <code>{escape(entry['chip'] or 'auto', quote=True)}</code>"
        f" &middot; flash offset <code>{entry['flashOffset']}</code></p>",
        '<p class="board__release">firmware version <code>'
        f"{escape(entry['version'], quote=True)}</code> &middot; MicroPython <code>"
        f"{escape(entry['micropythonVersion'], quote=True)}</code> &middot; {size_mb:.1f} MB</p>",
        '<p class="board__downloads">'
        f'<a href="{escape(entry["url"], quote=True)}">Download '
        f"{escape(entry['filename'], quote=True)}</a>",
    ]
    if entry["packageUrl"]:
        lines.append(
            f'<a href="{escape(entry["packageUrl"], quote=True)}">'
            "Download the .firmware.zip package (recommended)</a>"
        )
    lines.extend(
        [
            "</p>",
            f'<p class="board__sha">SHA-256 <code>{entry["sha256"]}</code></p>',
            "<h3>Flash with esptool</h3>",
        ]
    )
    for label, command in _flash_commands(entry):
        lines.append(f"<p><strong>{label}</strong></p>")
        lines.append(f"<pre><code>{escape(command, quote=True)}</code></pre>")
    lines.extend(
        [
            '<p class="board__hint">Adjust <code>--port</code> to your serial device. '
            "The desktop install flashes the same image from the Firmware tab.</p>",
            "</section>",
        ]
    )
    return lines


def render_firmware_page(
    index: dict[str, Any], *, public_url: str | None = None
) -> tuple[str, str]:
    """Render the ``/firmware`` page for a normalised index.

    Args:
        index: The document :func:`load_firmware_index` returned.
        public_url: Root URL of the hosted editor; when given, the preamble links to it. The page
            never invents a URL of its own.

    Returns:
        ``(html, css)`` — the page and its stylesheet. Both are pure functions of *index* and
        *public_url*: no timestamp, no ordering, so repeated renders are byte-identical.
    """

    escape = html.escape
    release_version = index.get("release", {}).get("version")
    # The policy carries no `&`, `<` or `>` and no `"`, so escaping only those keeps the single
    # quotes of the source lists readable instead of turning them into `&#x27;`.
    csp_attribute = html.escape(HOSTED_CSP_POLICY, quote=False)

    lines = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f'<meta http-equiv="Content-Security-Policy" content="{csp_attribute}">',
        "<title>Micro-Otter firmware</title>",
        '<link rel="stylesheet" href="firmware-page.css">',
        "</head>",
        "<body>",
        '<main class="firmware-page">',
        "<h1>Micro-Otter firmware</h1>",
        '<p class="lead">Pick the board, flash the image over USB with esptool or the '
        "Micro-Otter desktop install, then open the hosted editor and connect the device "
        "over WebSerial. No local server is needed.</p>",
    ]
    if release_version:
        lines.append(
            f'<p class="lead">Release <code>{escape(release_version, quote=True)}</code></p>'
        )
    if public_url:
        lines.append(
            f'<p class="lead">The hosted editor runs at '
            f'<a href="{escape(public_url, quote=True)}">{escape(public_url, quote=True)}</a>.</p>'
        )

    for entry in index.get("firmware", []):
        lines.extend(_board_section(entry))

    lines.extend(["</main>", "</body>", "</html>"])
    return "\n".join(lines) + "\n", _FIRMWARE_CSS


def write_firmware_page(
    out_dir: Path, index: dict[str, Any], *, public_url: str | None = None
) -> Path:
    """Write ``firmware/index.html`` and ``firmware/firmware-page.css`` under *out_dir*.

    Returns the HTML path. The page is written from the normalised index alone, so a rerun against
    the same release index leaves both files unchanged.
    """

    page_html, page_css = render_firmware_page(index, public_url=public_url)
    page_dir = out_dir / "firmware"
    page_dir.mkdir(parents=True, exist_ok=True)
    html_path = page_dir / "index.html"
    html_path.write_text(page_html, encoding="utf-8")
    (page_dir / "firmware-page.css").write_text(page_css, encoding="utf-8")
    return html_path


__all__ = ["load_firmware_index", "render_firmware_page", "write_firmware_page"]
