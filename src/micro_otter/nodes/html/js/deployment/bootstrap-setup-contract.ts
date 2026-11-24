type LooseRecord = Record<string, unknown>;

export const BOOTSTRAP_SETUP_SCHEMA_VERSION = 1;

export const BOOTSTRAP_SETUP_REQUIRED_PATHS = [
    '/manifest.json',
    '/device.json',
    '/app/main_loop.py',
] as const;

export const BOOTSTRAP_SETUP_ACTION_RESULTS = ['created', 'updated', 'unchanged', 'error'] as const;

export const BOOTSTRAP_SETUP_ERROR_CATEGORIES = [
    'validation',
    'filesystem',
    'runtime',
    'unsupported',
    'internal',
] as const;

export type BootstrapSetupActionResult = (typeof BOOTSTRAP_SETUP_ACTION_RESULTS)[number];

export type BootstrapSetupErrorCategory = (typeof BOOTSTRAP_SETUP_ERROR_CATEGORIES)[number];

export type BootstrapSetupStatusFile = {
    path: string;
    exists: boolean;
    valid: boolean;
    reason: string | null;
};

export type BootstrapSetupMissingOrInvalid = {
    path: string;
    reason: string;
};

export type BootstrapSetupError = {
    category: BootstrapSetupErrorCategory;
    message: string;
    path: string | null;
};

export type BootstrapSetupStatusPayload = {
    schemaVersion: number;
    ready: boolean;
    files: BootstrapSetupStatusFile[];
    missingOrInvalid: BootstrapSetupMissingOrInvalid[];
    errors: BootstrapSetupError[];
};

export type BootstrapSetupResult = {
    path: string;
    action: BootstrapSetupActionResult;
    reason: string | null;
};

export type BootstrapSetupApplyPayload = {
    schemaVersion: number;
    ok: boolean;
    results: BootstrapSetupResult[];
    errors: BootstrapSetupError[];
};

function isPlainObject(value: unknown): value is LooseRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isActionResult(value: unknown): value is BootstrapSetupActionResult {
    return (
        typeof value === 'string' &&
        BOOTSTRAP_SETUP_ACTION_RESULTS.includes(value as BootstrapSetupActionResult)
    );
}

function isErrorCategory(value: unknown): value is BootstrapSetupErrorCategory {
    return (
        typeof value === 'string' &&
        BOOTSTRAP_SETUP_ERROR_CATEGORIES.includes(value as BootstrapSetupErrorCategory)
    );
}

function normalizeErrorRow(value: unknown): BootstrapSetupError | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const category = value.category;
    const message = normalizeString(value.message);
    const path = normalizeString(value.path);

    if (!isErrorCategory(category) || !message) {
        return null;
    }

    return {
        category,
        message,
        path,
    };
}

function normalizeStatusFileRow(value: unknown): BootstrapSetupStatusFile | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const path = normalizeString(value.path);
    if (!path || typeof value.exists !== 'boolean' || typeof value.valid !== 'boolean') {
        return null;
    }

    return {
        path,
        exists: value.exists,
        valid: value.valid,
        reason: normalizeString(value.reason),
    };
}

function normalizeMissingRow(value: unknown): BootstrapSetupMissingOrInvalid | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const path = normalizeString(value.path);
    const reason = normalizeString(value.reason);
    if (!path || !reason) {
        return null;
    }

    return { path, reason };
}

function normalizeResultRow(value: unknown): BootstrapSetupResult | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const path = normalizeString(value.path);
    const action = value.action;
    if (!path || !isActionResult(action)) {
        return null;
    }

    return {
        path,
        action,
        reason: normalizeString(value.reason),
    };
}

export function normalizeBootstrapSetupStatusPayload(
    payload: unknown
): BootstrapSetupStatusPayload | null {
    if (!isPlainObject(payload)) {
        return null;
    }

    const filesRaw = payload.files;
    const missingRaw = payload.missingOrInvalid;
    const errorsRaw = payload.errors;

    if (
        payload.schemaVersion !== BOOTSTRAP_SETUP_SCHEMA_VERSION ||
        typeof payload.ready !== 'boolean' ||
        !Array.isArray(filesRaw) ||
        !Array.isArray(missingRaw) ||
        !Array.isArray(errorsRaw)
    ) {
        return null;
    }

    const files: BootstrapSetupStatusFile[] = [];
    for (const row of filesRaw) {
        const normalized = normalizeStatusFileRow(row);
        if (!normalized) {
            return null;
        }
        files.push(normalized);
    }

    const missingOrInvalid: BootstrapSetupMissingOrInvalid[] = [];
    for (const row of missingRaw) {
        const normalized = normalizeMissingRow(row);
        if (!normalized) {
            return null;
        }
        missingOrInvalid.push(normalized);
    }

    const errors: BootstrapSetupError[] = [];
    for (const row of errorsRaw) {
        const normalized = normalizeErrorRow(row);
        if (!normalized) {
            return null;
        }
        errors.push(normalized);
    }

    return {
        schemaVersion: BOOTSTRAP_SETUP_SCHEMA_VERSION,
        ready: payload.ready,
        files,
        missingOrInvalid,
        errors,
    };
}

export function normalizeBootstrapSetupApplyPayload(
    payload: unknown
): BootstrapSetupApplyPayload | null {
    if (!isPlainObject(payload)) {
        return null;
    }

    const resultsRaw = payload.results;
    const errorsRaw = payload.errors;

    if (
        payload.schemaVersion !== BOOTSTRAP_SETUP_SCHEMA_VERSION ||
        typeof payload.ok !== 'boolean' ||
        !Array.isArray(resultsRaw) ||
        !Array.isArray(errorsRaw)
    ) {
        return null;
    }

    const results: BootstrapSetupResult[] = [];
    for (const row of resultsRaw) {
        const normalized = normalizeResultRow(row);
        if (!normalized) {
            return null;
        }
        results.push(normalized);
    }

    const errors: BootstrapSetupError[] = [];
    for (const row of errorsRaw) {
        const normalized = normalizeErrorRow(row);
        if (!normalized) {
            return null;
        }
        errors.push(normalized);
    }

    return {
        schemaVersion: BOOTSTRAP_SETUP_SCHEMA_VERSION,
        ok: payload.ok,
        results,
        errors,
    };
}
