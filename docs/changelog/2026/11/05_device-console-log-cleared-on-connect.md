# Changes since version 1.26.0

## Bug Fixes

- **A new device session starts with an empty console** — the device console used to keep the
  messages of the previous session, so a reconnect interleaved stale output with the new boot log
  and the `Connecting...` notice was pushed up by lines that belonged to an earlier attempt. The
  log is now cleared the moment the connection enters `connecting`
  (`_onConnectionStateChanged()` in `views/device-connection-view.ts`), and the notice written
  right after it is therefore always the first line of the session.
- **Every connect path behaves the same** — the clear sits in the connection-state handler rather
  than in the toolbar action, so the toolbar `Connect` button, the `Connect` button of the
  Deployment view and a programmatic `connect()` all start from an empty log. The handler clears
  only on a real transition into `connecting` (previous state not `connecting`), so a repeated
  `connecting` event cannot wipe the output of an attempt that is already running.
- **Tests** — `tests/views/device-connection-view.test.js` seeds a stale message, connects and
  asserts the console holds exactly the `Connecting...` and `Connected` notices; the test fails
  without the clear. `webserial-architecture.md` documents the log lifecycle and the connect
  sequence, and `webserial-manual-testing.md` gains "Scenario 7b: Console Log Cleared When
  Connecting".
