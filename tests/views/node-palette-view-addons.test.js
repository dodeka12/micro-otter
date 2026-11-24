// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Add-on badges in the node palette's per-package sections.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { NodePaletteView } from '../../src/micro_otter/nodes/html/js/views/node-palette-view.js';

const BUILTIN_TYPES = {
    console: {
        title: 'Console',
        category: 'debug',
        color: '#334455',
        info: 'Prints to the console',
        inputs: [],
        outputs: [],
    },
};

const ADDON_TYPES = {
    'sample_addon.hello': {
        title: 'Hello',
        category: 'debug',
        color: '#5b7fc7',
        info: 'Greets from the add-on',
        inputs: [],
        outputs: [],
    },
};

function createRuntime({ withAddon = true } = {}) {
    const packages = [
        { id: 'core', name: 'Core', nodeTypes: new Map(Object.entries(BUILTIN_TYPES)) },
    ];
    if (withAddon) {
        packages.push({
            id: 'sample_addon',
            name: 'Sample Add-on',
            nodeTypes: new Map(Object.entries(ADDON_TYPES)),
        });
    }
    return {
        nodePackages: packages,
        packageProvenance: (packageId) => (packageId === 'sample_addon' ? 'addon' : 'builtin'),
    };
}

function createI18n(translations = {}) {
    return {
        t: (key) => translations[key] ?? key,
        addEventListener: () => {},
        removeEventListener: () => {},
        getCurrentLanguage: () => 'en',
    };
}

describe('NodePaletteView add-on badges', () => {
    let harness;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        harness.cleanup();
    });

    function createView({ withAddon = true, i18nService = createI18n() } = {}) {
        return new NodePaletteView({
            deviceRuntime: createRuntime({ withAddon }),
            workspaceConfig: {},
            i18nService,
            logger: { log: () => {} },
        });
    }

    function openPackageSections(view) {
        view.attachTo(container);
        container.querySelector('.node-palette-view__org-button[data-mode="package"]')?.click();
    }

    it('badges the add-on section and leaves built-in sections unmarked', () => {
        const view = createView();
        openPackageSections(view);

        const sections = Array.from(container.querySelectorAll('.collapsible-section'));
        const badgeBySection = new Map(
            sections.map((section) => [
                section.querySelector('.collapsible-section__name').textContent,
                section.querySelector('.collapsible-section__badge'),
            ])
        );

        assert.equal(badgeBySection.get('Sample Add-on')?.textContent, 'Add-on');
        assert.equal(badgeBySection.get('Core'), null);

        view.detach();
    });

    it('renders no badge and an unchanged section order without add-ons', () => {
        const view = createView({ withAddon: false });
        openPackageSections(view);

        assert.equal(container.querySelectorAll('.collapsible-section__badge').length, 0);
        assert.deepEqual(
            Array.from(container.querySelectorAll('.collapsible-section__name')).map(
                (element) => element.textContent
            ),
            ['Core']
        );

        view.detach();
    });

    it('carries the localized aria-label on the badge', () => {
        const view = createView({
            i18nService: createI18n({
                'palette.nodePackage.addonBadge': 'Erweiterung',
                'palette.nodePackage.addonTooltip': 'Aus einem Erweiterungspaket installiert',
            }),
        });
        openPackageSections(view);

        const badge = container.querySelector('.collapsible-section__badge');
        assert.ok(badge);
        assert.equal(badge.textContent, 'Erweiterung');
        assert.equal(badge.getAttribute('aria-label'), 'Aus einem Erweiterungspaket installiert');
        assert.equal(badge.title, 'Aus einem Erweiterungspaket installiert');

        view.detach();
    });
});
