import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { Workspace } from '../../src/micro_otter/nodes/html/js/core/workspace.js';

globalThis.indexedDB = indexedDB;

const DB_NAMES = [
    'micro-otter-collections',
    'micro-otter-workspace',
    'micro-otter-target-configs',
];

function deleteDatabase(dbName) {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

async function resetDatabases() {
    for (const dbName of DB_NAMES) {
        await deleteDatabase(dbName);
    }
}

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

    return new Workspace({
        viewManager,
        splashScreen,
        i18nService,
    });
}

function buildTargetInput(id = 'user_board') {
    return {
        id,
        displayName: 'User Board',
        version: '1.0.0',
        created: '2026-02-22',
        targetData: {
            id,
            displayName: 'User Board',
            pinCapabilities: {
                4: {
                    digital: {
                        input: true,
                        output: true,
                    },
                },
            },
        },
    };
}

test('Workspace user target config APIs save/list/get/delete/clear records', async () => {
    await resetDatabases();

    const workspace = createWorkspaceForTest();

    const saved = await workspace.saveUserTargetConfig(buildTargetInput('board_alpha'));
    assert.equal(saved.id, 'board_alpha');

    const listed = await workspace.listUserTargetConfigs();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'board_alpha');

    const loaded = await workspace.getUserTargetConfig('board_alpha');
    assert.equal(loaded?.id, 'board_alpha');

    await workspace.deleteUserTargetConfig('board_alpha');
    assert.equal((await workspace.listUserTargetConfigs()).length, 0);

    await workspace.saveUserTargetConfig(buildTargetInput('board_beta'));
    await workspace.clearUserTargetConfigs();
    assert.equal((await workspace.listUserTargetConfigs()).length, 0);

    workspace.cleanup();
});

test('Workspace saveUserTargetConfig rejects IDs that collide with runtime-shipped targets', async () => {
    await resetDatabases();

    const workspace = createWorkspaceForTest();
    workspace.runtimeCollection = {
        runtimesById: new Map([
            [
                'general',
                {
                    deviceTargetsById: new Map([['runtime_board', { id: 'runtime_board' }]]),
                },
            ],
        ]),
    };

    await assert.rejects(
        workspace.saveUserTargetConfig(buildTargetInput('runtime_board')),
        (error) => error?.code === 'ERR_TARGET_DUPLICATE_ID'
    );

    await assert.rejects(
        workspace.saveUserTargetConfig(buildTargetInput('runtime_board'), { allowOverwrite: true }),
        (error) => error?.code === 'ERR_TARGET_DUPLICATE_ID'
    );

    workspace.cleanup();
});

test('Workspace exposes user target conflict details for id and displayName collisions', async () => {
    await resetDatabases();

    const workspace = createWorkspaceForTest();
    await workspace.saveUserTargetConfig(buildTargetInput('board_alpha'));
    await workspace.saveUserTargetConfig({
        ...buildTargetInput('board_beta'),
        displayName: 'Board Beta',
        targetData: {
            ...buildTargetInput('board_beta').targetData,
            displayName: 'Board Beta',
        },
    });

    const idConflict = await workspace.getUserTargetConfigConflictDetails(
        buildTargetInput('board_alpha')
    );
    assert.equal(idConflict?.type, 'id');
    assert.equal(idConflict?.incoming.id, 'board_alpha');
    assert.equal(idConflict?.existing.id, 'board_alpha');

    const displayNameConflict = await workspace.getUserTargetConfigConflictDetails({
        ...buildTargetInput('board_gamma'),
        displayName: ' board beta ',
        targetData: {
            ...buildTargetInput('board_gamma').targetData,
            displayName: ' board beta ',
        },
    });
    assert.equal(displayNameConflict?.type, 'displayName');
    assert.equal(displayNameConflict?.incoming.id, 'board_gamma');
    assert.equal(displayNameConflict?.existing.id, 'board_beta');
    assert.equal(displayNameConflict?.existing.version, '1.0.0');

    workspace.cleanup();
});

test('Workspace saveUserTargetConfig requires explicit overwrite intent for displayName collisions', async () => {
    await resetDatabases();

    const workspace = createWorkspaceForTest();
    await workspace.saveUserTargetConfig({
        ...buildTargetInput('board_alpha'),
        displayName: 'Shared Board',
        targetData: {
            ...buildTargetInput('board_alpha').targetData,
            displayName: 'Shared Board',
        },
    });

    await assert.rejects(
        workspace.saveUserTargetConfig({
            ...buildTargetInput('board_beta'),
            displayName: ' shared board ',
            targetData: {
                ...buildTargetInput('board_beta').targetData,
                displayName: ' shared board ',
            },
        }),
        (error) => error?.code === 'ERR_TARGET_DUPLICATE_ID'
    );

    const overwritten = await workspace.saveUserTargetConfig(
        {
            ...buildTargetInput('board_beta'),
            displayName: ' shared board ',
            version: '1.1.0',
            targetData: {
                ...buildTargetInput('board_beta').targetData,
                displayName: ' shared board ',
            },
        },
        { allowOverwrite: true }
    );

    assert.equal(overwritten.id, 'board_beta');

    const listed = await workspace.listUserTargetConfigs();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'board_beta');
    assert.equal(listed[0].version, '1.1.0');

    workspace.cleanup();
});

test('Workspace listTargetsForRuntime includes runtime targets plus runtime-independent user targets', async () => {
    await resetDatabases();

    const workspace = createWorkspaceForTest();
    workspace.runtimeCollection = {
        getRuntime(runtimeId) {
            if (runtimeId !== 'general') {
                return null;
            }
            return {
                deviceTargetsById: new Map([
                    ['runtime_esp32', { displayName: 'Runtime ESP32' }],
                ]),
            };
        },
    };

    await workspace.saveUserTargetConfig(buildTargetInput('user_board_a'));

    const targets = workspace.listTargetsForRuntime('general');
    const targetIds = targets.map((target) => target.id);

    assert.deepEqual(targetIds, ['runtime_esp32', 'user_board_a']);

    workspace.cleanup();
});
