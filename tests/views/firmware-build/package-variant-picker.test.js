// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwarePackagesPanel } from '../../../src/micro_otter/nodes/html/js/views/firmware-packages-panel.js';
import { DEFAULT_VARIANT_ID } from '../../../src/micro_otter/nodes/html/js/data/package-resolver.js';
import {
    createI18nService,
    createRuntime,
    createTarget,
    setupDom,
    teardownDom,
} from './fixtures.js';

function viperVariant(overrides = {}) {
    return {
        variantId: 'viper',
        manifestRel: 'pulse/manifest.viper.json',
        precedence: 10,
        requiredCapabilities: ['viper'],
        title: { en: 'Viper', de: 'Viper' },
        hardware: { en: 'ESP32', de: 'ESP32' },
        description: { en: 'Viper implementation', de: 'Viper-Implementierung' },
        packageDescription: 'Example add-on.',
        isDefault: false,
        ...overrides,
    };
}

function defaultVariant(overrides = {}) {
    return {
        variantId: DEFAULT_VARIANT_ID,
        manifestRel: 'pulse/manifest.json',
        precedence: 0,
        requiredCapabilities: [],
        title: null,
        hardware: null,
        description: null,
        packageDescription: 'Example add-on.',
        isDefault: true,
        ...overrides,
    };
}

function viperTarget() {
    return {
        id: 'esp32-test',
        displayName: 'ESP32 Test',
        generalCapabilities: { viper: { supported: true } },
        resources: {},
        capabilityRegistry: { getDomain: () => 'general', get: () => null },
    };
}

function makePanel({ runtime, target = createTarget('esp32-test', 'ESP32 Test'), i18nService = createI18nService() }) {
    return new FirmwarePackagesPanel({
        i18nService,
        logger: null,
        getRuntime: () => runtime,
        getTarget: () => target,
        hasFeature: () => true,
        registerControl: () => {},
        onSelectionChange: () => {},
        onRefreshLocalPackages: () => {},
        onRefreshAddons: () => {},
        isBusy: () => false,
        onRequestInstallAddon: () => {},
        onRequestInstallAddonUrl: () => {},
        onRemoveAddons: () => {},
        getUsedNodeTypeIds: () => [],
    });
}

function renderPanel(container, panel) {
    const section = panel.buildPackagesSection();
    container.appendChild(section);
    panel.renderPackagesSection();
    return section;
}

describe('FirmwarePackagesPanel variant picker', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    it('renders a badge for a single-implementation package', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'audio', name: 'Audio', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['audio'],
            packageVariants: {
                audio: [viperVariant({ manifestRel: 'audio/manifest.viper.json' })],
            },
        });
        renderPanel(container, makePanel({ runtime }));

        const badge = container.querySelector('.firmware-build-view__package-badge--variant');
        assert.ok(badge, 'expected a variant badge');
        assert.equal(badge.textContent, 'Viper');
        assert.equal(badge.title, 'Viper implementation');

        const wrapper = container.querySelector('.firmware-build-view__package-variant');
        assert.ok(wrapper, 'expected the variant wrapper');
        assert.equal(wrapper.querySelector('.dropdown-control__button'), null);
    });

    it('renders Py for a default implementation without a title', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['core'],
            packageVariants: {
                core: [defaultVariant({ manifestRel: 'core/manifest.json', packageDescription: 'Core runtime' })],
            },
        });
        renderPanel(container, makePanel({ runtime }));

        const badge = container.querySelector('.firmware-build-view__package-badge--variant');
        assert.equal(badge.textContent, 'Py');
        assert.equal(badge.title, 'Core runtime');
    });

    it('renders a dropdown with the real variant ids only', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'pulse', name: 'Pulse', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['pulse'],
            packageVariants: {
                pulse: [viperVariant(), defaultVariant()],
            },
        });
        renderPanel(container, makePanel({ runtime }));

        const trigger = container.querySelector('.firmware-build-view__package-variant .dropdown-control__button');
        assert.ok(trigger, 'expected a dropdown trigger');
        trigger.click();

        const options = [...document.body.querySelectorAll('.dropdown-control__option')];
        assert.deepEqual(
            options.map((option) => option.getAttribute('data-value')),
            ['viper', DEFAULT_VARIANT_ID]
        );

        const viperOption = document.body.querySelector('.dropdown-control__option[data-value="viper"]');
        assert.ok(viperOption.classList.contains('dropdown-control__option--disabled'));
    });

    it('records an explicit variant pick in packageVariants', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'pulse', name: 'Pulse', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['pulse'],
            packageVariants: {
                pulse: [viperVariant(), defaultVariant()],
            },
        });
        const panel = makePanel({ runtime, target: viperTarget() });
        renderPanel(container, panel);

        const trigger = container.querySelector('.firmware-build-view__package-variant .dropdown-control__button');
        trigger.click();
        document.body.querySelector('.dropdown-control__option[data-value="viper"]').click();

        assert.equal(panel.packageVariants().pulse, 'viper');

        trigger.click();
        document.body.querySelector('.dropdown-control__option[data-value="py"]').click();
        assert.equal(panel.packageVariants().pulse, 'py');
    });

    it('uses the localized effective-variant description for the trigger tooltip', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'pulse', name: 'Pulse', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['pulse'],
            packageVariants: {
                pulse: [viperVariant(), defaultVariant()],
            },
        });
        renderPanel(container, makePanel({ runtime, target: viperTarget(), i18nService: createI18nService('de') }));

        const trigger = container.querySelector('.firmware-build-view__package-variant .dropdown-control__button');
        const label = trigger.querySelector('.dropdown-control__button-label');
        assert.equal(trigger.title, 'Viper-Implementierung');
        assert.equal(label.title, 'Viper-Implementierung');
    });

    it('localizes the badge label', () => {
        const runtime = createRuntime({
            nodePackages: [{ id: 'audio', name: 'Audio', version: '1.0.0', requiredCapabilities: null }],
            nodePackagesGlobal: ['audio'],
            packageVariants: {
                audio: [
                    viperVariant({
                        manifestRel: 'audio/manifest.viper.json',
                        title: { en: 'Viper', de: 'Vip' },
                    }),
                ],
            },
        });
        renderPanel(container, makePanel({ runtime, i18nService: createI18nService('de') }));

        const badge = container.querySelector('.firmware-build-view__package-badge--variant');
        assert.equal(badge.textContent, 'Vip');
    });
});
