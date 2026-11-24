export function createMockDeviceConnection(overrides = {}) {
    const calls = {
        ensureDirectory: [],
        writeTextFile: [],
        removeFile: [],
    };

    const mock = {
        calls,
        async ensureDirectory(path) {
            calls.ensureDirectory.push(path);
            return true;
        },
        async writeTextFile(path, content) {
            calls.writeTextFile.push({ path, content });
            return { bytesWritten: typeof content === 'string' ? content.length : 0 };
        },
        async removeFile(path) {
            calls.removeFile.push(path);
            return true;
        },
        ...overrides,
    };

    return mock;
}

export function createMockDeviceTarget(overrides = {}) {
    return {
        id: 'custom',
        displayName: 'Custom Device',
        metadata: {
            isCustomTarget: true,
            disableValidation: true,
        },
        ...overrides,
    };
}
