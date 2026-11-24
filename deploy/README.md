# `deploy/` — Distribution Layout

Distribution and host-toolchain assets for installing and operating Micro-Otter as a local
server. This tree is the single home for installation and distribution work, so later milestones
add files inside these folders instead of inventing a second layout.

## Folder ownership

| Folder | Owner | Owns |
| --- | --- | --- |
| `toolchain/` | **M1** | Host toolchain installation (ESP-IDF and MicroPython clones, `mpy-cross`) and the single shared version-pin source. |
| `docker/` | **M7** | Runtime and compile container images, compose profiles, and their entrypoints. |
| `release/` | **M8** | Firmware release builds, release indexes (`index.json`), and publish/verification tooling. |
| `packaging/` | **M7** | Wheel and PyInstaller packaging of the local server. |

Every folder carries a README that states what lands there and which milestone owns it.

## Milestones

- **M1** — layout, shared pins, toolchain dispatchers, and the platform-agnostic
  `BuildBackend` / `FlashBackend` seams.
- **M7** — container images and packaging.
- **M8** — firmware releases and the public firmware index.

## What is not owned here

Node-package source deployment is not a `deploy/` responsibility. The browser app keeps the
`missing` / `override-required` source upload in
`src/micro_otter/nodes/html/js/deployment/`, and that path stays independent of firmware images,
of `BuildBackend`, and of `FlashBackend`.

Developer documentation for this layout lives in
[docs/dev/deployment/deploy-layout.md](../docs/dev/deployment/deploy-layout.md).
