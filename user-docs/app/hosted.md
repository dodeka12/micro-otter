# Hosted web app

The hosted app is the same Micro-Otter editor, served from a web site instead of your own computer.
There is nothing to install: open the site in a browser, and everything that does not need a local
server works.

## What works here

| Works in the hosted app | Needs the local app |
|---|---|
| graph editing, collections, import and export | building a firmware image |
| Deploy over Web Serial, including the local-source upload | flashing an image from the Firmware tab |
| Console, Device view, settings, language | the firmware inventory and add-on installs |
| saving to the browser's own database | anything that reads the local server |

Deploying a collection still uploads source for the node packages the firmware does not carry
(`missing` / `override-required`), exactly as in the local app; only the firmware tools are absent.

## Getting firmware onto the board

The hosted app cannot flash a board, so install an official image once by hand:

1. Open `/firmware/` on the same site.
2. Download the image for your board — the `.firmware.zip` package is recommended, a bare `.bin`
   works too.
3. Copy the `esptool` command that matches your operating system, and adjust `--port` to your serial
   device.
4. Run it, then connect the board in the editor and deploy as usual.

`/firmware/` and the project's release page describe the same release, so either source works.

## Browser

Use a Chromium-based desktop browser (Chrome, Edge, …) on a secure context — `https://` or
`http://localhost`. Web Serial is the only device connection in the hosted app, because the WebSocket
bridge needs the local server; see [Connect a device](../setup/connect.md).

The Firmware tab shows a notice instead of the build and flash panes. When the site publishes a
documentation link, the notice also points at where to download the desktop app.
