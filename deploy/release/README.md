# `deploy/release/`

Owner: **M8** (firmware releases). Empty in M1 — only this README exists.

Planned content:

- Release builds of per-board firmware images, driven through the `BuildBackend` seam.
- `index.json` generation: per-board download URL, SHA-256, firmware version, and the
  OS-specific manual `esptool` install commands.
- Publish, verification, and retention tooling for the firmware index.

Rules for the owner:

- Reuse the `FlashBackend` argv contract for documented manual flashing instead of inventing a
  second command shape.
- Never publish images produced by an unverified toolchain pin; the pins come from
  `deploy/toolchain/versions.env`.
