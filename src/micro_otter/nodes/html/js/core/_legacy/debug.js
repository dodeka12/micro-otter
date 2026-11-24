// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Central debug toggles for the web app.
 *
 * Keep this intentionally small and dependency-free so any module can import it
 * without creating circular imports.
 */

export const DEBUG_FLAGS = {
    /** Logs workspace auto-cache restore/save activity. */
    workspaceCache: false,

    /** Logs graph panel layout restore + graphId assignment. */
    graphPanels: false,

    /** Logs per-panel graph activation and add-node attempts. */
    graphPanelActivation: true,

    /** Logs tab label resolution details (graph id -> label). */
    panelTabs: false,

    /** Logs workspace snapshot import/apply details. */
    snapshotApply: false,

    /** Focused trace for math node persistence (IndexedDB save/load). */
    mathPersist: false,

    /** Logs WebSerial UI button interactions. */
    webserialUi: false,

    /** Logs WebSerial deploy workflow (main loop + snapshot writes). */
    webserialDeploy: false,

    /** Logs WebSerial device profile/snapshot loading decisions. */
    webserialProfile: false,

    /** Enables debug-only package registry dumps to the console. */
    packagesDiagnostics: false,

    /** Graph store level tracing (non-math). */
    graphStore: false,

    /** Transpiler emit debugging. */
    transpilerDebug: false,

    /** Node UI actions (control/default edits). */
    nodeUiActions: false,

    /** WebSerial WiFi helpers. */
    webserialWifi: false,

    /** WebSerial serial client/monitor. */
    webserialSerial: false,

    /** Capability map + node capability checks. */
    capabilityChecks: false,

    /** Collection versioning + dirty flag tracing. */
    collectionVersioning: false,

    collectionStore: false,
    workspace: false,         // Disabled in Phase 1 - use new log.js system instead
    main: false,              // Disabled in Phase 1 - use new log.js system instead
    main_v2: false,
    splash: false,            // Disabled in Phase 1 - use new log.js system instead

    workspace_event: false,
    render_v2_draw: false,
    render_v2_pointer: false,
    render_v2_grid: false,
    render_v2_hit: false,
    palette_v2: false,
    node_ui: false,
    node_data: false,
    node_graph: false,
    connections_v2: false,
    graph_panel: false,
};

export function debugEnabled(flagName) {
    return Boolean(
        DEBUG_FLAGS && Object.prototype.hasOwnProperty.call(DEBUG_FLAGS, flagName)
            ? DEBUG_FLAGS[flagName]
            : false
    );
}

export function debugLog(flagName, ...args) {
    if (!debugEnabled(flagName)) {
        return;
    }
    if (typeof console === 'undefined') {
        return;
    }
    const logger =
        typeof console.debug === 'function'
            ? console.debug.bind(console)
            : typeof console.info === 'function'
              ? console.info.bind(console)
              : typeof console.log === 'function'
                ? console.log.bind(console)
                : null;
    if (logger) {
        logger(`[${flagName}] `, ...args);
    }
}

// Expose a read-only hook for non-module scripts (e.g., package capability files).
try {
    if (typeof globalThis !== 'undefined') {
        const descriptor = Object.freeze({ debugLog, debugEnabled, DEBUG_FLAGS });
        globalThis.__microOtterDebug = descriptor;
        globalThis.__microOtterDebugLog = debugLog;
    }
} catch (exposeError) {
    // Best-effort only; ignore exposure failures.
}
