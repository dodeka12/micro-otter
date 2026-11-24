// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Reserved device-module namespaces.
 *
 * Device code lives under ``otter_*`` (Micro-Otter built-ins) or ``moa_*``
 * (installed add-ons). This module is the single place the split is spelled in the
 * web app, so the deploy classifier can recognise a library path by *namespace*
 * without ever learning about provenance.
 */

/** Device module prefixes, in declaration order. */
export const PACKAGE_MODULE_PREFIXES: readonly string[] = ['otter_', 'moa_'];

/** Reserved add-on device-module prefix. */
export const ADDON_MODULE_PREFIX = 'moa_';

/**
 * Return the device module root for an add-on *packageId*, optionally narrowed to *variant*.
 *
 * The default variant (``null`` or ``'py'``) yields ``moa_<id>``; any other variant
 * yields ``moa_<id>_<variant>``. This mirrors the server-side ``addon_module_root``.
 */
export function addonModuleRoot(packageId: string, variant: string | null): string {
    const root = `${ADDON_MODULE_PREFIX}${packageId}`;
    return variant && variant !== 'py' ? `${root}_${variant}` : root;
}

/**
 * Return whether *path* is a package library path (or a ``libs/`` member).
 *
 * A path like ``otter_core/system.py``, ``moa_hello/__init__.py``, or
 * ``libs/foo/bar.py`` classifies as a library path; runtime/app paths do not.
 */
export function isPackageModulePath(path: string): boolean {
    const normalized = String(path ?? '');
    if (normalized.startsWith('libs/')) {
        return true;
    }
    return PACKAGE_MODULE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Return whether *dotted* is a package module import.
 *
 * Imports are dotted (``otter_core.system``, ``moa_hello``), so only the namespace
 * prefix matters — there is no ``libs/`` form for an import.
 */
export function isPackageModuleImport(dotted: string): boolean {
    const normalized = String(dotted ?? '');
    return PACKAGE_MODULE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
