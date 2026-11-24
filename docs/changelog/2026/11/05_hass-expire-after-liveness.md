# Changes since version 1.26.0

## Bug Fixes

- **`Expire After` no longer marks a running device unavailable** — the bridge published each
  entity state retained and de-duplicated, so a value that never changed produced exactly one
  message ever. Home Assistant starts its expiry timer with *every* state message, so a
  `hass-binary-sensor` with `Expire After = 10` went `unavailable` about ten seconds after boot
  while both availability topics still said `online` — the device was alive, the topic was
  silent. `publish_state()` now repeats the unchanged value once per **half** window for entities
  with a positive `expire_after` (`HassRuntime._state_memo()`, using `utime.ticks_ms()` and the
  wraparound-safe `ticks_diff()`), so expiry finally means what the docs promised: the program
  stopped refreshing the entity, not the value stopped changing. Entities without `expire_after`
  keep the plain de-duplication and never publish twice; `if_changed=False` is untouched.

## Improvements

- **The `entity:` log line names the expiry and the availability contract** — registration now
  logs `entity: <component>.<object_id> state='…' command='…' expire=<n>s availability='…' mode=…`
  (`expire=none` / `availability=none` where nothing is announced). The discovery payload is
  published truncated to 32 characters, which is why `expire_after` was invisible in the console
  while an entity was being misdiagnosed; the two fields that decide whether Home Assistant keeps
  an entity available are now readable without subscribing to the broker.
- **The `Expire After` control explains itself** — the `hass-sensor` and `hass-binary-sensor`
  descriptions (en/de) now say that the bridge repeats the current value every half window while
  the device runs, so the setting is a liveness check on the app and not a replacement for the
  availability flags.
- **Docs follow the behaviour** — `docs/dev/nodes/hass-node-system.md` gained a *State
  publication* section (the publish/de-duplicate contract, the half-window table, why the clock is
  `ticks_ms()`), the availability mechanism list, the diagnostics table and a troubleshooting row
  for "available, then `unavailable` while the device keeps running";
  `docs/user/mqtt-and-home-assistant.md` rewrote the practical advice around `Expire After` and
  gained the same troubleshooting row.
- **Versions** — `hass` package **0.10.0**. A firmware rebuild is required: the device runtime is
  flashed as precompiled bytecode, so an old `otter_hass.mpy` keeps the single-message behaviour
  and an entity with `Expire After` stays broken until the board runs the new runtime (setting
  `Expire After` to `0` is the workaround in the meantime).
