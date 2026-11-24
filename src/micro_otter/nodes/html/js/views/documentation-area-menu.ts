// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Menu item builder for documentation areas.
 *
 * The burger button in the DOM layer and the header's context menu must always show the same
 * items in the same order with the same enabled states. Building them here — no DOM attachment —
 * keeps that single source of truth and makes the shape unit-testable. Nested `MenuView` entries
 * use the same opener installed by `MenuWindow`, so a child selection bubbles up unchanged.
 */

import type {
    DocumentationAreaContentAlign,
    DocumentationAreaData,
    DocumentationAreaFontSize,
} from '../data/documentation-area.js';
import { normalizeAreaFontSize } from '../data/documentation-area.js';
import { MenuView } from './menu-view.js';
import { IconProvider } from './icon-provider.js';

export interface DocumentationAreaMenuItem {
    [key: string]: unknown;
    id?: string;
    type?: string;
    label?: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    action?: () => void;
}

export interface DocumentationAreaMenuActions {
    edit: (areaId: string) => void;
    changeColor: (areaId: string) => void;
    rename: (areaId: string) => void;
    alignContent: (areaId: string, align: DocumentationAreaContentAlign) => void;
    setFontSize: (areaId: string, fontSize: DocumentationAreaFontSize) => void;
    cut: (areaId: string) => void;
    copy: (areaId: string) => void;
    paste: (areaId: string) => void;
    duplicate: (areaId: string) => void;
    fitToSelection: (areaId: string) => void;
    remove: (areaId: string) => void;
}

export interface DocumentationAreaMenuContext {
    area: DocumentationAreaData;
    isEditing: boolean;
    hasClipboardData: boolean;
    selectedNodeCount: number;
    /** Label resolver; receives the i18n key and the English fallback. */
    t: (key: string, fallback: string) => string;
    actions: DocumentationAreaMenuActions;
}

/**
 * Build the documentation-area menu.
 * @param {DocumentationAreaMenuContext} context - Current state plus the action table.
 * @returns {DocumentationAreaMenuItem[]} Items in display order, separators included.
 */
export function createDocumentationAreaMenuItems(
    context: DocumentationAreaMenuContext
): DocumentationAreaMenuItem[] {
    const { area, isEditing, hasClipboardData, selectedNodeCount, t, actions } = context;
    const areaId = area.id;
    const activeFontSize = normalizeAreaFontSize(area.fontSize);
    const fontSizeLabel = t('documentationArea.menu.fontSize', 'Font Size');
    const fontSizeMenu = new MenuView({
        title: fontSizeLabel,
        items: [
            {
                id: 'fontSizeSmall',
                label: t('documentationArea.menu.fontSizeSmall', 'Small'),
                disabled: activeFontSize === 'small',
                action: () => actions.setFontSize(areaId, 'small'),
            },
            {
                id: 'fontSizeNormal',
                label: t('documentationArea.menu.fontSizeNormal', 'Normal'),
                disabled: activeFontSize === 'normal',
                action: () => actions.setFontSize(areaId, 'normal'),
            },
            {
                id: 'fontSizeLarge',
                label: t('documentationArea.menu.fontSizeLarge', 'Large'),
                disabled: activeFontSize === 'large',
                action: () => actions.setFontSize(areaId, 'large'),
            },
        ],
    });

    return [
        {
            id: 'edit',
            label: isEditing
                ? t('documentationArea.menu.done', 'Done')
                : t('documentationArea.menu.edit', 'Edit'),
            icon: IconProvider.edit,
            action: () => actions.edit(areaId),
        },
        {
            id: 'color',
            label: t('documentationArea.menu.color', 'Change Colour…'),
            icon: IconProvider.palette,
            action: () => actions.changeColor(areaId),
        },
        {
            id: 'rename',
            label: t('documentationArea.menu.rename', 'Rename…'),
            icon: IconProvider.edit,
            action: () => actions.rename(areaId),
        },
        { type: 'separator' },
        {
            id: 'alignTop',
            label: t('documentationArea.menu.alignTop', 'Align Text Top'),
            icon: IconProvider.arrowUpward,
            // The active placement is disabled: it doubles as the "current value" indicator.
            disabled: area.contentAlign !== 'bottom',
            action: () => actions.alignContent(areaId, 'top'),
        },
        {
            id: 'alignBottom',
            label: t('documentationArea.menu.alignBottom', 'Align Text Bottom'),
            icon: IconProvider.arrowDownward,
            disabled: area.contentAlign === 'bottom',
            action: () => actions.alignContent(areaId, 'bottom'),
        },
        {
            type: 'menuview',
            id: 'fontSize',
            label: fontSizeLabel,
            icon: IconProvider.formatSize,
            menu: fontSizeMenu,
        },
        { type: 'separator' },
        {
            id: 'cut',
            label: t('documentationArea.menu.cut', 'Cut'),
            icon: IconProvider.contentCut,
            shortcut: 'Ctrl+X',
            action: () => actions.cut(areaId),
        },
        {
            id: 'copy',
            label: t('documentationArea.menu.copy', 'Copy'),
            icon: IconProvider.contentCopy,
            shortcut: 'Ctrl+C',
            action: () => actions.copy(areaId),
        },
        {
            id: 'paste',
            label: t('documentationArea.menu.paste', 'Paste'),
            icon: IconProvider.contentPaste,
            shortcut: 'Ctrl+V',
            disabled: !hasClipboardData,
            action: () => actions.paste(areaId),
        },
        {
            id: 'duplicate',
            label: t('documentationArea.menu.duplicate', 'Duplicate'),
            icon: IconProvider.fileCopy,
            action: () => actions.duplicate(areaId),
        },
        { type: 'separator' },
        {
            id: 'fit',
            label: t('documentationArea.menu.fitToSelection', 'Fit to Selection'),
            icon: IconProvider.selectAll,
            disabled: selectedNodeCount === 0,
            action: () => actions.fitToSelection(areaId),
        },
        {
            id: 'delete',
            label: t('documentationArea.menu.delete', 'Delete'),
            icon: IconProvider.delete,
            shortcut: 'Del',
            action: () => actions.remove(areaId),
        },
    ];
}
