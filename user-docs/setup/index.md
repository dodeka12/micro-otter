# Setup

Micro-Otter runs in three shapes. Pick the one that matches how you want to work; every shape uses the
same editor and the same node packages.

| Mode | What it is | How you get it | Documentation |
|---|---|---|---|
| Hosted web app | the editor in a browser tab; connects to the board through Web Serial only | open the hosted URL, no install | lands with M9 |
| Local install | Micro-Otter served from your own machine as a wheel, a `uv tool` install, or a Docker runtime image | install the package or pull the image, then start the server | [Linux](../install-linux.md), [macOS](../install-macos.md), [Windows](../install-windows.md) |
| Developer install | a checkout plus the ESP-IDF toolchain, so you can build firmware images as well as run the editor | clone the repository and set up both toolchains | the [Linux](../install-linux.md) compile profile or the [developer docs](../developer-docs.md) |

What each mode gives you:

| Capability | Hosted | Local | Developer |
|---|---|---|---|
| Node editor, collections, deploy to a device | yes | yes | yes |
| Device connection over Web Serial | yes | yes | yes |
| Build and flash firmware images | no | no | yes |

The connection types are described in [Connect a device](connect.md); firmware building is part of the
Firmware tab, described in [Firmware view](../app/firmware-view.md).

The installation commands are on the per-platform pages: [Linux](../install-linux.md),
[macOS](../install-macos.md), and [Windows](../install-windows.md). Until the hosted app lands (M9),
the developer documentation under `docs/dev/` in the repository carries the build instructions — see
[Developer documentation](../developer-docs.md).

## Related

- [Targets](targets.md) — which board definition to pick
- [Connect a device](connect.md) — the connection dialog
