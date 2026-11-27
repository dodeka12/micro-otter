# Development Guides

This folder contains general development guides including architecture overview, build system, and coding standards.

## Files

- **[architecture-overview.md](architecture-overview.md)** - High-level overview of the entire Micro-Otter architecture and how components interact.

- **[build-and-deployment.md](build-and-deployment.md)** - Build system configuration, development workflows, dependency management, and production deployment strategies.

- **[devcontainer.md](devcontainer.md)** - The VS Code dev container: first start, bundled tooling, Windows USB forwarding, in-container GPG commit signing, Cline history persistence, and troubleshooting.

- **[git-hooks.md](git-hooks.md)** - The `hooks/` directory: enabling `core.hooksPath`, the commit-msg device manifest bump rules, the pre-commit generated-file refresh, and the pre-push `check:ci-local` gate.

- **[coding-style-guide.md](coding-style-guide.md)** - Coding standards for Python (PEP 8) and TypeScript, including critical encapsulation rules and naming conventions.

- **[updating-micropython-idf-toolchain.md](updating-micropython-idf-toolchain.md)** - How to check the latest MicroPython version, find the matching ESP-IDF version, update the Dockerfile pins, and refresh the devcontainer toolchain.
