# Changes since version 1.26.0

## New Features
- **`array-modify` copies by default** — the node gains an `In-Place` checkbox. It is
  unchecked by default, so fill/ramp/steps/hat/sine/shift now write into a copy of the input
  array and leave the incoming array untouched. Check it to keep the previous behaviour, where
  the operation mutates the input buffer and returns it (no per-pass allocation).

## Bug Fixes
- **Shadow uploads are always confirmed** — deploying from the main toolbar now asks before host
  sources replace firmware-bundled (embedded) packages, using the same confirmation the deploy
  view uses; the prompt can be remembered per package/firmware/host version for the session.
  The upload also always ships the *complete* package, so the device can no longer end up with a
  half-shadowed import path that raises the original `ImportError` even though files were written.

## Documentation
- `otter_vars/arrays.py` modify functions (`fill`, `ramp`, `steps`, `hat`, `sin`, `shift`) accept
  `inplace=False`; the generated code always passes it explicitly.
