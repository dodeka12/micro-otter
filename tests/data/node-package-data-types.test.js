import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';

function createJsonResponse(payload) {
    return {
        ok: true,
        json: async () => payload,
    };
}

function createFetchFromMap(payloadByUrl) {
    return async (input) => {
        const url = String(input);
        if (!payloadByUrl.has(url)) {
            return { ok: false, json: async () => ({}) };
        }
        return createJsonResponse(payloadByUrl.get(url));
    };
}

describe('NodePackage data type loading', () => {
    it('keeps webview web.element kind metadata as structure from package declaration', async () => {
        const packageRoot = '/device/node_pkgs/webview/';
        const webviewDataTypes = JSON.parse(
            readFileSync(
                path.resolve('src/micro_otter/nodes/device/node_pkgs/webview/data_types.json'),
                'utf8'
            )
        );
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/webview/manifest.json',
                    {
                        id: 'webview',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/webview/node_definitions.json', { nodeTypes: {} }],
                ['/device/node_pkgs/webview/data_types.json', webviewDataTypes],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.equal(dataTypes['web.element']?.kind, 'structure');
        assert.equal(dataTypes['web.rgba']?.kind, 'value');
        assert.equal(dataTypes['web.rgba']?.name?.en, 'RGBA Color');
    });

    it('loads data types from manifest-declared declaration file', async () => {
        const packageRoot = '/device/node_pkgs/webview/';
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/webview/manifest.json',
                    {
                        id: 'webview',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/webview/node_definitions.json', { nodeTypes: {} }],
                [
                    '/device/node_pkgs/webview/data_types.json',
                    {
                        types: {
                            'web.element': {
                                name: { en: 'Web Element', de: 'Web-Element' },
                                description: {
                                    en: 'Reference to a rendered web element',
                                    de: 'Referenz auf ein gerendertes Web-Element',
                                },
                                color: '#ff00ff',
                                kind: 'structure',
                            },
                        },
                    },
                ],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.ok(dataTypes['web.element']);
        assert.equal(dataTypes['web.element'].name.en, 'Web Element');
        assert.equal(dataTypes['web.element'].color, '#ff00ff');
        assert.equal(dataTypes['web.element'].kind, 'structure');
    });

    it('supports inline manifest data type declarations', async () => {
        const packageRoot = '/device/node_pkgs/inline/';
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/inline/manifest.json',
                    {
                        id: 'inline',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: {
                            'ui.element': {
                                name: 'UI Element',
                                color: '#bb22cc',
                            },
                        },
                    },
                ],
                ['/device/node_pkgs/inline/node_definitions.json', { nodeTypes: {} }],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.ok(dataTypes['ui.element']);
        assert.equal(dataTypes['ui.element'].name, 'UI Element');
        assert.equal(dataTypes['ui.element'].color, '#bb22cc');
        assert.equal(dataTypes['ui.element'].kind, 'value');
    });

    it('rejects invalid kind values declared by package data types', async () => {
        const packageRoot = '/device/node_pkgs/kind-invalid/';
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/kind-invalid/manifest.json',
                    {
                        id: 'kind-invalid',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/kind-invalid/node_definitions.json', { nodeTypes: {} }],
                [
                    '/device/node_pkgs/kind-invalid/data_types.json',
                    {
                        types: {
                            'valid.value': {
                                name: 'Valid Value',
                                kind: 'value',
                            },
                            'invalid.kind': {
                                name: 'Invalid Kind',
                                kind: 'hybrid',
                            },
                        },
                    },
                ],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.ok(dataTypes['valid.value']);
        assert.equal(dataTypes['valid.value'].kind, 'value');
        assert.equal(dataTypes['invalid.kind'], undefined);
    });

    it('accepts integer maxConnections policies (0, 1, and positive fixed values)', async () => {
        const packageRoot = '/device/node_pkgs/policy-valid/';
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/policy-valid/manifest.json',
                    {
                        id: 'policy-valid',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/policy-valid/node_definitions.json', { nodeTypes: {} }],
                [
                    '/device/node_pkgs/policy-valid/data_types.json',
                    {
                        types: {
                            'web.element': {
                                name: 'Web Element',
                                color: '#ff00ff',
                                connectionPolicy: {
                                    input: { maxConnections: 0 },
                                    output: { maxConnections: 1 },
                                },
                            },
                            'ui.slot': {
                                name: 'UI Slot',
                                color: '#bb22cc',
                                connectionPolicy: {
                                    input: { maxConnections: 2 },
                                    output: { maxConnections: 4 },
                                },
                            },
                        },
                    },
                ],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.deepEqual(dataTypes['web.element'].connectionPolicy, {
            input: { maxConnections: 0 },
            output: { maxConnections: 1 },
        });
        assert.deepEqual(dataTypes['ui.slot'].connectionPolicy, {
            input: { maxConnections: 2 },
            output: { maxConnections: 4 },
        });
    });

    it('rejects negative and non-integer maxConnections policies', async () => {
        const packageRoot = '/device/node_pkgs/policy-invalid/';
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/policy-invalid/manifest.json',
                    {
                        id: 'policy-invalid',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/policy-invalid/node_definitions.json', { nodeTypes: {} }],
                [
                    '/device/node_pkgs/policy-invalid/data_types.json',
                    {
                        types: {
                            'valid.type': {
                                name: 'Valid Type',
                                color: '#00aacc',
                                connectionPolicy: {
                                    input: { maxConnections: 1 },
                                    output: { maxConnections: 0 },
                                },
                            },
                            'invalid.negative': {
                                name: 'Invalid Negative',
                                color: '#aa0000',
                                connectionPolicy: {
                                    input: { maxConnections: -1 },
                                },
                            },
                            'invalid.decimal': {
                                name: 'Invalid Decimal',
                                color: '#aa1100',
                                connectionPolicy: {
                                    output: { maxConnections: 1.5 },
                                },
                            },
                        },
                    },
                ],
            ])
        );

        const pkg = new NodePackage(packageRoot);
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.ok(dataTypes['valid.type']);
        assert.equal(dataTypes['invalid.negative'], undefined);
        assert.equal(dataTypes['invalid.decimal'], undefined);
    });
});
