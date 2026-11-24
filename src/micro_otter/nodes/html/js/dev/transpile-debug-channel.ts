type GeneratedCollectionArtifact = {
    targetPath: string;
    content: string | Uint8Array;
    contentType?: string;
    contentEncoding?: 'identity' | 'gzip';
    role?: string;
};

type TranspilerHelperGroupHandoff = {
    mergedData: Record<string, unknown>;
    artifacts: GeneratedCollectionArtifact[];
    webserverSpecPatch: Record<string, unknown>;
};

type TranspilerHelperHandoffV1 = {
    schemaVersion: 'transpiler-helper-handoff/v1';
    helperGroups: Record<string, TranspilerHelperGroupHandoff>;
};

type TranspileResult = {
    code: string;
    artifacts?: GeneratedCollectionArtifact[];
    assets?: {
        generatedArtifacts?: GeneratedCollectionArtifact[];
        [key: string]: unknown;
    };
    generatedArtifacts?: GeneratedCollectionArtifact[];
    helperHandoff?: TranspilerHelperHandoffV1;
};

type CollectionLike = {
    getId?: () => string;
    getTitle?: () => string;
    getVersionString?: () => string;
};

type EncodedArtifactContent = {
    kind: 'text' | 'base64';
    value: string;
};

type DebugDumpArtifactPayload = {
    targetPath: string;
    contentType: string;
    contentEncoding: 'identity' | 'gzip';
    role: string;
    content: EncodedArtifactContent;
};

type DebugDumpPayload = {
    schemaVersion: 'transpile-debug-dump/v1';
    createdAtIso: string;
    collection: {
        id: string | null;
        title: string | null;
        version: string | null;
    };
    transpile: {
        code: string;
        generatedArtifacts: DebugDumpArtifactPayload[];
        helperHandoffSummary: {
            schemaVersion: string | null;
            helperGroups: Array<{
                helperGroup: string;
                mergedDataKeyCount: number;
                artifactCount: number;
                webserverSpecPatchKeys: string[];
            }>;
        };
    };
};

type DebugDumpResponse = {
    dumpId?: string;
    dumpDirectory?: string;
    filesWritten?: number;
    [key: string]: unknown;
};

const DEBUG_DUMP_ENDPOINT = '/__debug/transpile-dump';

function encodeUint8ToBase64(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const byte0 = bytes[index];
        const hasByte1 = index + 1 < bytes.length;
        const hasByte2 = index + 2 < bytes.length;
        const byte1 = hasByte1 ? bytes[index + 1] : 0;
        const byte2 = hasByte2 ? bytes[index + 2] : 0;

        const block = (byte0 << 16) | (byte1 << 8) | byte2;

        output += alphabet[(block >> 18) & 0x3f];
        output += alphabet[(block >> 12) & 0x3f];
        output += hasByte1 ? alphabet[(block >> 6) & 0x3f] : '=';
        output += hasByte2 ? alphabet[block & 0x3f] : '=';
    }

    return output;
}

function encodeArtifactContent(content: string | Uint8Array): EncodedArtifactContent {
    if (typeof content === 'string') {
        return {
            kind: 'text',
            value: content,
        };
    }

    return {
        kind: 'base64',
        value: encodeUint8ToBase64(content),
    };
}

function summarizeHelperHandoff(helperHandoff?: TranspilerHelperHandoffV1) {
    const helperGroups = helperHandoff?.helperGroups || {};

    return {
        schemaVersion: helperHandoff?.schemaVersion || null,
        helperGroups: Object.keys(helperGroups)
            .sort()
            .map((helperGroup) => {
                const group = helperGroups[helperGroup] || {
                    mergedData: {},
                    artifacts: [],
                    webserverSpecPatch: {},
                };
                return {
                    helperGroup,
                    mergedDataKeyCount: Object.keys(group.mergedData || {}).length,
                    artifactCount: Array.isArray(group.artifacts) ? group.artifacts.length : 0,
                    webserverSpecPatchKeys: Object.keys(group.webserverSpecPatch || {}).sort(),
                };
            }),
    };
}

function collectGeneratedArtifacts(result: TranspileResult): GeneratedCollectionArtifact[] {
    const directArtifacts = Array.isArray(result?.generatedArtifacts)
        ? result.generatedArtifacts
        : [];
    const rootArtifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
    const nestedArtifacts = Array.isArray(result?.assets?.generatedArtifacts)
        ? result.assets.generatedArtifacts
        : [];

    const deduped = new Set<GeneratedCollectionArtifact>();
    [...directArtifacts, ...rootArtifacts, ...nestedArtifacts].forEach((artifact) => {
        if (artifact && typeof artifact === 'object') {
            deduped.add(artifact);
        }
    });

    return Array.from(deduped);
}

export function createTranspileDebugDumpPayload(
    collection: CollectionLike,
    result: TranspileResult
): DebugDumpPayload {
    const generatedArtifacts = collectGeneratedArtifacts(result);

    return {
        schemaVersion: 'transpile-debug-dump/v1',
        createdAtIso: new Date().toISOString(),
        collection: {
            id: collection?.getId?.() || null,
            title: collection?.getTitle?.() || null,
            version: collection?.getVersionString?.() || null,
        },
        transpile: {
            code: typeof result?.code === 'string' ? result.code : '',
            generatedArtifacts: generatedArtifacts.map((artifact) => ({
                targetPath: String(artifact?.targetPath || ''),
                contentType: String(artifact?.contentType || 'application/octet-stream'),
                contentEncoding: artifact?.contentEncoding === 'gzip' ? 'gzip' : 'identity',
                role: String(artifact?.role || 'generated-artifact'),
                content: encodeArtifactContent(artifact.content),
            })),
            helperHandoffSummary: summarizeHelperHandoff(result?.helperHandoff),
        },
    };
}

export function isTranspileDebugChannelEnabled(): boolean {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

    if (env?.DEV === true) {
        return true;
    }

    try {
        if (
            globalThis.localStorage?.getItem('microOtter.debug.transpileDump') === '1' ||
            new URLSearchParams(globalThis.location?.search || '').has('debugTranspileDump')
        ) {
            return true;
        }
    } catch {
        return false;
    }

    return false;
}

export async function sendTranspileDebugDump(payload: DebugDumpPayload): Promise<DebugDumpResponse> {
    const response = await fetch(DEBUG_DUMP_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Debug dump failed: HTTP ${response.status} ${errorBody}`);
    }

    return (await response.json()) as DebugDumpResponse;
}
