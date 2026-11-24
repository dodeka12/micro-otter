import { webcrypto } from 'node:crypto';

export function withTemporaryGlobals(overrides, callback) {
    const previousValues = new Map();
    for (const [key, value] of Object.entries(overrides || {})) {
        previousValues.set(key, globalThis[key]);
        globalThis[key] = value;
    }

    try {
        return callback();
    } finally {
        for (const [key, value] of previousValues.entries()) {
            if (value === undefined) {
                delete globalThis[key];
            } else {
                globalThis[key] = value;
            }
        }
    }
}

export function ensureCryptoGlobal() {
    if (!globalThis.crypto) {
        globalThis.crypto = webcrypto;
    }
    return globalThis.crypto;
}

export function createFetchJsonResponse(body, init = {}) {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}
