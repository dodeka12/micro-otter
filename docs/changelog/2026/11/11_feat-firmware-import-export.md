# Changes since version 1.25.0

## New Features

- **Firmware packages import/export.** A published firmware image can now move between publish
  roots as a self-contained `.firmware.zip` — the `.bin`, its `<stem>.manifest.json` sidecar, and a
  `firmware-package.json` descriptor recording the image's SHA-256. `mo firmware package` /
  `export` / `import` / `list` cover the CLI (`firmware` became a Typer group; bare `mo firmware` /
  `mo fw` still open the interactive menu), and the Firmware tab's Local firmware toolbar gains
  **Import** and **Export** buttons.
- **Verified import.** `import_firmware_package` refuses traversal/symlink/duplicate members, an
  oversized archive (4 MiB), a SHA-256 mismatch, and a filename/sidecar identity disagreement; an
  identical re-import answers `already-present` and a name collision needs `--force` (CLI) or a
  whole-app confirm (UI). Import only writes into the publish root — it never builds or flashes, and
  deploy resolves the imported image by filename identity unchanged.
- **Wire surface.** A new `firmware.import` `WS /firmware` frame (base64 archive, gated on
  `firmware-compile`) and a `GET /api/firmware/package?path=…` download route; the server's
  `max_size` is raised to 8 MiB to fit the encoded package.

## Notes

- Package format, validation rules, and the transport are documented in
  `docs/dev/firmware-compile/firmware-packages.md`.
