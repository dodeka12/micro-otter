// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Organizational palette entries.
 *
 * Some palette entries create *graph items* instead of nodes: a documentation area is not a node
 * type, never reaches the transpiler, the capability validators or the connection router, so it
 * cannot be described by a node package. These entries are declared here and merged into the
 * palette list at render time, marked with `type: 'graph-item'` so every node-only code path can
 * skip them.
 */

export const ORGANIZATIONAL_CATEGORY = 'Organizational';
export const DOCUMENTATION_AREA_GRAPH_ITEM_ID = 'documentation-area';
export const FUNCTION_INPUT_GRAPH_ITEM_ID = 'function-input-node';
export const FUNCTION_OUTPUT_GRAPH_ITEM_ID = 'function-output-node';

export interface OrganizationalPaletteEntry {
    id: string;
    type: 'graph-item';
    category: string;
    title: { en: string; de: string };
    /** `IconProvider` registry name; the asset already ships with the app. */
    icon: string;
    description: { en: string; de: string };
    /** i18n keys for the label and the info text; the `{ en, de }` maps stay the fallback. */
    i18n: { title: string; info: string };
    /**
     * Optional visibility gate. `'function-graph'` entries are listed only while the
     * active graph is a function graph; entries without the marker are always listed.
     */
    visibleFor?: 'function-graph';
}

export const ORGANIZATIONAL_PALETTE_ENTRIES: OrganizationalPaletteEntry[] = [
    {
        id: DOCUMENTATION_AREA_GRAPH_ITEM_ID,
        type: 'graph-item',
        category: ORGANIZATIONAL_CATEGORY,
        title: { en: 'Documentation Area', de: 'Dokumentationsbereich' },
        icon: 'nodeCategory',
        description: {
            en: 'Coloured, resizable box for notes and formulas.',
            de: 'Farbiger, skalierbarer Kasten für Notizen und Formeln.',
        },
        i18n: {
            title: 'nodePalette.graphItems.documentationArea.title',
            info: 'nodePalette.graphItems.documentationArea.info',
        },
    },
    {
        id: FUNCTION_INPUT_GRAPH_ITEM_ID,
        type: 'graph-item',
        category: ORGANIZATIONAL_CATEGORY,
        title: { en: 'Function Input', de: 'Funktionseingang' },
        icon: 'input',
        description: {
            en: 'Mirrors the declared function inputs as output connectors.',
            de: 'Spiegelt die deklarierten Funktionseingänge als Ausgangsanschlüsse.',
        },
        i18n: {
            title: 'functionGraph.node.input.title',
            info: 'functionGraph.node.input.info',
        },
        visibleFor: 'function-graph',
    },
    {
        id: FUNCTION_OUTPUT_GRAPH_ITEM_ID,
        type: 'graph-item',
        category: ORGANIZATIONAL_CATEGORY,
        title: { en: 'Function Output', de: 'Funktionsausgang' },
        icon: 'output',
        description: {
            en: 'Mirrors the declared function outputs as input connectors.',
            de: 'Spiegelt die deklarierten Funktionsausgänge als Eingangsanschlüsse.',
        },
        i18n: {
            title: 'functionGraph.node.output.title',
            info: 'functionGraph.node.output.info',
        },
        visibleFor: 'function-graph',
    },
];

/**
 * Whether a palette id belongs to the organizational (graph-item) entries.
 * @param {string} id - Palette entry id.
 * @returns {boolean} True for a known graph-item entry.
 */
export function isOrganizationalEntry(id: string): boolean {
    return ORGANIZATIONAL_PALETTE_ENTRIES.some((entry) => entry.id === id);
}
