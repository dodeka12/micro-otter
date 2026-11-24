# Deployment System Documentation

This folder contains documentation about the deployment system architecture, access control, and device deployment APIs.

**Canonical invariant:** node-package **source upload** is independent of firmware images, feature flags,
and package selection. The `missing` / `override-required` fallback that uploads source is decided by the
node graph, the firmware inventory, and the firmware package versions only — never by `--package-ids`,
`modulePackagingMode`, `enable_compile`, `enable_deploy`, a `source: local` firmware source, or the
outcome of a firmware flash. See
[deployment-system-architecture.md](deployment-system-architecture.md) for the decision table and
[package-selection.md](../firmware-compile/package-selection.md#what-this-does-not-mean) for the
firmware-side statement of the same rule.

## Files

- **[deployment-system-architecture.md](deployment-system-architecture.md)** - Complete architecture of the deployment system including managers, coordinators, and device communication layers. Contains the normative **Deploy Pattern: Complete Plan, Subtractive Removal** (invariant `removal = manifest − plan`, decision table, firmware-replaceability guard, observability log events) that every change to library planning, hashing or stale cleanup must respect.

- **[deployment-access-control.md](deployment-access-control.md)** - Access control mechanisms for managing deployment permissions and security.

- **[device-deployment-api.md](device-deployment-api.md)** - API reference for device deployment operations including file transfers, configuration, and validation.

- **[device-info-ownership-and-onboarding-lifecycle.md](device-info-ownership-and-onboarding-lifecycle.md)** - Canonical ownership and lifecycle contract for DeviceConnection-owned device-info reads and embedded onboarding, including dynamic install handoff semantics.

- **[embedded-runtime-compatibility-deploy.md](embedded-runtime-compatibility-deploy.md)** - Embedded-mode runtime deploy semantics using firmware-owned setup APIs (`get_bootstrap_setup_status`, `apply_bootstrap_setup`) and event/status behavior.

- **[mpy-optional-deployment-integration.md](mpy-optional-deployment-integration.md)** - Integration contract for optional `.mpy` deployment using the existing deployment pipeline and file-selection seam.

- **[deploy-layout.md](deploy-layout.md)** - Ownership contract for the top-level `deploy/` tree (toolchain, docker, release, packaging), the shared toolchain pin source, and the boundary that keeps node-package source upload out of the build/flash backends.

- **[configuration.md](configuration.md)** - Configuration reference: precedence chain (`CLI flag > environment > micro-otter.toml > platform default`), TOML schema, platform defaults, state-directory location, and the `toolchain`/`doctor`/`serve` contracts with their JSON payloads and exit codes.

## Environment Checks

A forgotten `npm run build` leaves `_dist/webapp` in front of the source tree, and deploying from
that bundle compares the firmware against its **stale** node-package manifests — the deploy then
looks like it ignores a package you just changed. The server warns about it at startup and exposes
the served/source version pair in `GET /api/server-capabilities`; see
[Build and Deployment → Stale build warning](../guides/build-and-deployment.md#stale-build-warning).

## Build And Deploy Firmware From The Web UI

The **Firmware** tab builds or flashes a firmware image over `WS /firmware`; it is a
firmware-image path and never touches the source-upload deploy path described on this page. See
[view-system/firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md)
for the tab's capability gating, target/package selection, and single-flight build/deploy/scan
flows.
