# Changes since version 1.25.0

## Fixes
- **Installed add-ons appear on the Vite dev origin** — `npm run dev:web` forwarded `/api`, `/serial`,
  and `/firmware` but answered `/device` entirely from the source tree, so the merged node-package
  index never named an installed add-on: the Firmware tab's *Installed add-ons* table stayed empty
  and `packageProvenance('pulse')` never reported `addon`, even though `mo addons list` knew the
  package. `server.proxy` now forwards the three request shapes only the backend synthesizes — the
  merged index, a runtime manifest, and an installed add-on's files — and leaves everything else
  (`capabilities/*.json` above all) on Vite's JSON→ES-module transform.
- **A dev server without the backend stays usable** — the forward is gated on
  `/api/server-capabilities`, so `npm run dev:web` on its own, or before the backend has started,
  answers those three shapes from the checked-in files exactly as before.

## Improvements
- **One place defines what the backend owns under `/device`** — the new
  `tools/vite-device-backend.mjs` derives the forwarded paths from the same rules
  `addon_store.merged_index_payload`, `addon_store.runtime_manifest_addons`, and
  `addon_store.addon_asset_path` apply, so the two servers cannot drift on which requests are files
  and which are synthesized. `MICRO_OTTER_BACKEND_ORIGIN` points the dev proxy at a backend that
  does not listen on the default `http://127.0.0.1:8000`.
