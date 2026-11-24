import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { Workspace } from '../../src/micro_otter/nodes/html/js/core/workspace.js';

globalThis.indexedDB = indexedDB;

function createWorkspaceForTest() {
    const viewManager = {
        theme: 'standard',
        updateViewContext() {},
        getAvailableThemes() {
            return [];
        },
        setTheme(themeId) {
            this.theme = themeId;
            return themeId;
        },
    };

    const splashScreen = {
        isVisible: false,
        updateProgress() {},
        show: async () => {},
        hide: async () => {},
        destroy() {},
    };

    const i18nService = {
        currentLocale: 'en',
        async setLocale(localeCode) {
            this.currentLocale = localeCode;
        },
    };

    return new Workspace({ viewManager, splashScreen, i18nService });
}

test('workspace registers Web Serial and WebSocket providers', () => {
    const workspace = createWorkspaceForTest();
    const providers = workspace.deviceConnection.getProviders();

    assert.ok(providers.webserial);
    assert.equal(providers.webserial.name, 'Web Serial');

    assert.ok(providers.websocket);
    assert.equal(providers.websocket.name, 'WebSocket (Bridge)');

    assert.equal(workspace.deviceConnection.getActiveProviderKey(), 'webserial');
});
