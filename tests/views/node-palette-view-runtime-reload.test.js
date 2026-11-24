// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file The palette rebuilds its node list when the runtime collection reloads its packages.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import { RuntimeCollectionRuntimesLoadedPayload } from '../../src/micro_otter/nodes/html/js/data/device-runtime-collection.js';
import { NodePaletteView } from '../../src/micro_otter/nodes/html/js/views/node-palette-view.js';

const CORE_TYPES = {
    const: { title: 'Constant', category: 'math', color: '#334455', inputs: [], outputs: [] },
};

const ADDON_TYPES = {
    'sample_addon.hello': {
        title: 'Hello',
        category: 'debug',
        color: '#5b7fc7',
        inputs: [],
        outputs: [],
    },
};

function createPackage(id, name, nodeTypes) {
    return { id, name, nodeTypes: new Map(Object.entries(nodeTypes)) };
}

/**
 * Runtime stub whose package list the test mutates to simulate an install or an uninstall.
 * @returns {{nodePackages: Array<{id: string, name: string, nodeTypes: Map<string, Record<string, unknown>>}>, packageProvenance: (packageId: string) => 'builtin'|'addon'}} Runtime-like object.
 */
function createRuntime() {
    return {
        nodePackages: [createPackage('core', 'Core', CORE_TYPES)],
        packageProvenance: (packageId) => (packageId === 'sample_addon' ? 'addon' : 'builtin'),
    };
}

function createI18n() {
    return {
        t: (key) => key,
        addEventListener: () => {},
        removeEventListener: () => {},
        getCurrentLanguage: () => 'en',
    };
}

class RuntimeCollectionStub extends AppEventEmitter {
    /**
     * Announce a completed reload.
     */
    emitRuntimesLoaded() {
        this.emit(
            'runtimesLoaded',
            new RuntimeCollectionRuntimesLoadedPayload(['general'], 'general')
        );
    }
}

describe('NodePaletteView runtime reloads', () => {
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

    function createView({ runtime, runtimeCollection }) {
        return new NodePaletteView({
            deviceRuntime: runtime,
            runtimeCollection,
            // Large cards render the node name, and alphabetical mode keeps the list free of the
            // `<details>` sections whose asynchronous `toggle` events outlive a jsdom test.
            workspaceConfig: { nodePalette: { viewSize: 'large', organizationMode: 'alphabetical' } },
            i18nService: createI18n(),
            logger: { log: () => {} },
        });
    }

    function listedNames() {
        // Graph items (documentation areas) share the card markup but are not node types.
        return Array.from(
            container.querySelectorAll('.node-type-ui:not([data-graph-item]) .node-type-ui__name')
        ).map((element) => element.textContent);
    }

    it('shows a node type installed after the palette was rendered', () => {
        const runtime = createRuntime();
        const runtimeCollection = new RuntimeCollectionStub();
        const view = createView({ runtime, runtimeCollection });

        view.attachTo(container);
        assert.deepEqual(listedNames(), ['Constant']);

        runtime.nodePackages.push(createPackage('sample_addon', 'Sample Add-on', ADDON_TYPES));
        runtimeCollection.emitRuntimesLoaded();

        assert.deepEqual(listedNames().sort(), ['Constant', 'Hello']);

        view.detach();
    });

    it('drops a node type whose add-on was uninstalled', () => {
        const runtime = createRuntime();
        runtime.nodePackages.push(createPackage('sample_addon', 'Sample Add-on', ADDON_TYPES));
        const runtimeCollection = new RuntimeCollectionStub();
        const view = createView({ runtime, runtimeCollection });

        view.attachTo(container);
        assert.deepEqual(listedNames().sort(), ['Constant', 'Hello']);

        runtime.nodePackages = [createPackage('core', 'Core', CORE_TYPES)];
        runtimeCollection.emitRuntimesLoaded();

        assert.deepEqual(listedNames(), ['Constant']);

        view.detach();
    });

    it('stops listening once the view is detached', () => {
        const runtime = createRuntime();
        const runtimeCollection = new RuntimeCollectionStub();
        const view = createView({ runtime, runtimeCollection });

        view.attachTo(container);

        let updateCalls = 0;
        view.update = () => {
            updateCalls += 1;
        };

        runtimeCollection.emitRuntimesLoaded();
        assert.equal(updateCalls, 1);

        view.detach();

        runtime.nodePackages.push(createPackage('sample_addon', 'Sample Add-on', ADDON_TYPES));
        runtimeCollection.emitRuntimesLoaded();

        // `beforeDetach()` must drop the subscription, otherwise a detached palette keeps
        // rebuilding itself from a container that is gone.
        assert.equal(updateCalls, 1);
    });
});
