import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    createTranspileDebugDumpPayload,
    sendTranspileDebugDump,
} from '../../src/micro_otter/nodes/html/js/dev/transpile-debug-channel.js';

describe('transpile debug channel payload', () => {
    it('serializes transpile output and generated artifacts for dump transport', () => {
        const payload = createTranspileDebugDumpPayload(
            {
                getId: () => 'collection-1',
                getTitle: () => 'Main Collection',
                getVersionString: () => '1.0.0',
            },
            {
                code: 'print("hello")\n',
                generatedArtifacts: [
                    {
                        targetPath: 'app/webserver_hooks_generated.py',
                        content: 'def handle_index(request, context):\n    return None\n',
                        contentType: 'text/x-python',
                        contentEncoding: 'identity',
                        role: 'generated-hook-module',
                    },
                    {
                        targetPath: 'collection/webview/demo/index.html.gz',
                        content: new Uint8Array([0x1f, 0x8b, 0x08]),
                        contentType: 'text/html; charset=utf-8',
                        contentEncoding: 'gzip',
                        role: 'web-html',
                    },
                ],
                helperHandoff: {
                    schemaVersion: 'transpiler-helper-handoff/v1',
                    helperGroups: {
                        'web-runtime': {
                            mergedData: {
                                'webNode:1': { id: '1' },
                            },
                            artifacts: [],
                            webserverSpecPatch: {
                                postRefreshRoute: '/api/webview/refresh',
                            },
                        },
                    },
                },
            }
        );

        assert.equal(payload.schemaVersion, 'transpile-debug-dump/v1');
        assert.equal(payload.collection.id, 'collection-1');
        assert.equal(payload.transpile.code, 'print("hello")\n');
        assert.equal(payload.transpile.generatedArtifacts.length, 2);

        const textArtifact = payload.transpile.generatedArtifacts[0];
        assert.equal(textArtifact.content.kind, 'text');
        assert.ok(textArtifact.content.value.includes('handle_index'));

        const binaryArtifact = payload.transpile.generatedArtifacts[1];
        assert.equal(binaryArtifact.content.kind, 'base64');
        assert.equal(binaryArtifact.content.value, 'H4sI');

        assert.equal(payload.transpile.helperHandoffSummary.schemaVersion, 'transpiler-helper-handoff/v1');
        assert.equal(payload.transpile.helperHandoffSummary.helperGroups.length, 1);
        assert.equal(payload.transpile.helperHandoffSummary.helperGroups[0].helperGroup, 'web-runtime');
    });

    it('collects artifacts from nested transpile result shapes', () => {
        const payload = createTranspileDebugDumpPayload(
            {
                getId: () => 'collection-2',
                getTitle: () => 'Nested Artifact Collection',
                getVersionString: () => '2.0.0',
            },
            {
                code: 'print("nested")\n',
                assets: {
                    generatedArtifacts: [
                        {
                            targetPath: 'collection/webview/demo/index.html',
                            content: '<html>demo</html>',
                            contentType: 'text/html; charset=utf-8',
                            contentEncoding: 'identity',
                            role: 'web-html',
                        },
                    ],
                },
            }
        );

        assert.equal(payload.transpile.generatedArtifacts.length, 1);
        assert.equal(
            payload.transpile.generatedArtifacts[0].targetPath,
            'collection/webview/demo/index.html'
        );
        assert.equal(payload.transpile.generatedArtifacts[0].content.kind, 'text');
    });
});

describe('transpile debug channel transport', () => {
    it('posts payload to debug endpoint and returns parsed response', async () => {
        const originalFetch = globalThis.fetch;

        try {
            globalThis.fetch = async (url, options) => {
                assert.equal(String(url), '/__debug/transpile-dump');
                assert.equal(options?.method, 'POST');
                assert.equal(options?.headers?.['Content-Type'], 'application/json');

                return {
                    ok: true,
                    async json() {
                        return {
                            success: true,
                            dumpId: 'dump-1',
                            filesWritten: 3,
                        };
                    },
                };
            };

            const response = await sendTranspileDebugDump({
                schemaVersion: 'transpile-debug-dump/v1',
                createdAtIso: '2026-03-06T00:00:00.000Z',
                collection: {
                    id: 'collection-1',
                    title: 'Main Collection',
                    version: '1.0.0',
                },
                transpile: {
                    code: 'print("ok")\n',
                    generatedArtifacts: [],
                    helperHandoffSummary: {
                        schemaVersion: null,
                        helperGroups: [],
                    },
                },
            });

            assert.equal(response.success, true);
            assert.equal(response.dumpId, 'dump-1');
        } finally {
            if (originalFetch === undefined) {
                delete globalThis.fetch;
            } else {
                globalThis.fetch = originalFetch;
            }
        }
    });
});
