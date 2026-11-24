import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { TargetConfigStore } from '../../src/micro_otter/nodes/html/js/data/target-config-store.js';

globalThis.indexedDB = indexedDB;

const DB_NAME = 'micro-otter-target-configs';

function deleteDatabase() {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

function buildInput(overrides = {}) {
    return {
        id: 'esp32_custom_alpha',
        displayName: 'ESP32 Custom Alpha',
        version: '1.2.3',
        created: '2026-02-22',
        targetData: {
            id: 'esp32_custom_alpha',
            displayName: 'ESP32 Custom Alpha',
            description: 'Custom board',
            pinCapabilities: {
                2: {
                    digital: {
                        input: true,
                        output: true,
                    },
                },
            },
        },
        ...overrides,
    };
}

test('TargetConfigStore saves, lists, and retrieves validated user target configs', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();
    const saved = await store.saveTargetConfig(buildInput());

    assert.equal(saved.id, 'esp32_custom_alpha');
    assert.equal(saved.version, '1.2.3');
    assert.equal(saved.created, '2026-02-22');
    assert.equal(saved.source, 'user');
    assert.equal(saved.targetData.id, 'esp32_custom_alpha');
    assert.equal(saved.targetData.targetId, 'esp32_custom_alpha');

    const loaded = await store.getTargetConfig('esp32_custom_alpha');
    assert.equal(loaded?.id, 'esp32_custom_alpha');

    const listed = await store.listTargetConfigs();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'esp32_custom_alpha');
});

test('TargetConfigStore rejects invalid version format', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await assert.rejects(
        store.saveTargetConfig(buildInput({ version: '1.2' })),
        (error) => error?.code === 'ERR_TARGET_VERSION_INVALID'
    );
});

test('TargetConfigStore rejects invalid created date', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await assert.rejects(
        store.saveTargetConfig(buildInput({ created: 'not-a-date' })),
        (error) => error?.code === 'ERR_TARGET_CREATED_INVALID'
    );
});

test('TargetConfigStore rejects id mismatch between metadata and payload', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await assert.rejects(
        store.saveTargetConfig(buildInput({ id: 'different-id' })),
        (error) => error?.code === 'ERR_TARGET_ID_MISMATCH'
    );
});

test('TargetConfigStore rejects user configs that declare openPins', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await assert.rejects(
        store.saveTargetConfig(
            buildInput({
                targetData: {
                    id: 'esp32_custom_alpha',
                    openPins: { min: 0, max: 255 },
                },
            })
        ),
        (error) => error?.code === 'ERR_TARGET_OPEN_PINS'
    );
});

test('TargetConfigStore rejects duplicate IDs by default and allows overwrite explicitly', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await store.saveTargetConfig(buildInput());

    await assert.rejects(
        store.saveTargetConfig(buildInput({ displayName: 'Renamed Board' })),
        (error) => error?.code === 'ERR_TARGET_DUPLICATE_ID'
    );

    const overwritten = await store.saveTargetConfig(
        buildInput({ displayName: 'Renamed Board' }),
        { allowOverwrite: true }
    );

    assert.equal(overwritten.displayName, 'Renamed Board');
});

test('TargetConfigStore accepts a derived record with a shipped baseTargetId', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore({
        isShippedTarget: (id) => id === 'esp32_wroom',
        isUserTarget: () => false,
    });
    const saved = await store.saveTargetConfig(
        buildInput({
            id: 'esp32_custom_alpha',
            baseTargetId: 'esp32_wroom',
            targetData: {
                id: 'esp32_custom_alpha',
                displayName: 'ESP32 Custom Alpha',
                description: 'Derived board',
                pinCapabilities: {
                    5: null,
                },
            },
        })
    );

    assert.equal(saved.baseTargetId, 'esp32_wroom');
});

test('TargetConfigStore rejects a baseTargetId that is not a shipped target', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore({
        isShippedTarget: () => false,
        isUserTarget: () => false,
    });

    await assert.rejects(
        store.saveTargetConfig(buildInput({ baseTargetId: 'esp32_wroom' })),
        (error) => error?.code === 'ERR_TARGET_BASE_UNKNOWN'
    );
});

test('TargetConfigStore rejects the removed custom base target id', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore({
        isShippedTarget: (id) => id !== 'custom',
        isUserTarget: () => false,
    });

    await assert.rejects(
        store.saveTargetConfig(buildInput({ baseTargetId: 'custom' })),
        (error) => error?.code === 'ERR_TARGET_BASE_UNKNOWN'
    );
});

test('TargetConfigStore rejects a chained base that is itself a user target', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore({
        isShippedTarget: (id) => id === 'esp32_wroom' || id === 'esp32_custom_alpha',
        isUserTarget: (id) => id === 'esp32_custom_alpha',
    });

    await assert.rejects(
        store.saveTargetConfig(
            buildInput({ id: 'esp32_custom_beta', baseTargetId: 'esp32_custom_alpha' })
        ),
        (error) => error?.code === 'ERR_TARGET_BASE_CHAINED'
    );
});

test('TargetConfigStore rejects imported custom-target metadata', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await assert.rejects(
        store.saveTargetConfig(
            buildInput({
                targetData: {
                    id: 'esp32_custom_alpha',
                    metadata: { isCustomTarget: true, disableValidation: true },
                },
            })
        ),
        (error) => error?.code === 'ERR_TARGET_CUSTOM_DEPRECATED'
    );
});

test('TargetConfigStore finds ID and displayName conflicts for upload analysis', async () => {
    await deleteDatabase();

    const store = new TargetConfigStore();

    await store.saveTargetConfig(buildInput());
    await store.saveTargetConfig(
        buildInput({
            id: 'esp32_custom_beta',
            displayName: 'ESP32 Custom Beta',
            targetData: {
                id: 'esp32_custom_beta',
                displayName: 'ESP32 Custom Beta',
                description: 'Custom board beta',
                pinCapabilities: {
                    2: {
                        digital: {
                            input: true,
                            output: true,
                        },
                    },
                },
            },
        })
    );

    const idConflict = await store.findTargetConfigConflict(
        buildInput({ displayName: 'New Name For Alpha' })
    );
    assert.equal(idConflict?.type, 'id');
    assert.equal(idConflict?.existing.id, 'esp32_custom_alpha');
    assert.equal(idConflict?.incoming.version, '1.2.3');

    const displayNameConflict = await store.findTargetConfigConflict(
        buildInput({
            id: 'esp32_custom_gamma',
            displayName: '  esp32 custom beta  ',
            targetData: {
                id: 'esp32_custom_gamma',
                displayName: '  esp32 custom beta  ',
                description: 'Custom board gamma',
                pinCapabilities: {
                    2: {
                        digital: {
                            input: true,
                            output: true,
                        },
                    },
                },
            },
        })
    );
    assert.equal(displayNameConflict?.type, 'displayName');
    assert.equal(displayNameConflict?.existing.id, 'esp32_custom_beta');
    assert.equal(displayNameConflict?.existing.displayName, 'ESP32 Custom Beta');
});
