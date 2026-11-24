# Developer documentation

This site renders only `user-docs/`. The developer, workflow and administrative markdown lives in the
repository under `docs/` and is read in a checkout — none of it is published here.

| Folder | Holds |
|---|---|
| `docs/dev/` | the architecture and reference handbook, indexed by `docs/dev/README.md` — coding style, testing, build and deployment, the data backbone and progress events, i18n, the view system, node definitions, deployment, MPY precompilation, the firmware compile contract |
| `docs/workflow/` | contributor workflow — adding icons, changelog entries, pull requests, releases |
| `docs/admin/` | repository administration — GitHub setup and the `mod` tool |
| `docs/tools/` | operational references — firmware compile reference, the MPY runtime workflow, Windows USB and CP210x setup |
| `docs/general/` | setup shared by every checkout — git commit signing with GPG |
| `docs/changelog/` | dated changelog entries, indexed by `docs/changelog/index.md` |

- Every path is relative to the repository root.
- Start with `docs/dev/README.md` when changing the application, and `docs/workflow/` when changing the
  repository process.
