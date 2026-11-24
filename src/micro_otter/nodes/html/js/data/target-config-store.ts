import { IndexedStore, type IndexedStoreAdapter } from './indexed-store.js';
import DeviceTargetInfo, { type DeviceTargetPayload } from './device-target.js';

const DB_NAME = 'micro-otter-target-configs';
const DB_VERSION = 1;
const STORE_NAME = 'target-configs';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface TargetConfigRecord {
    id: string;
    displayName: string;
    version: string;
    source: 'user';
    created: string;
    baseTargetId?: string | null;
    targetData: Record<string, unknown>;
}

export interface TargetConfigInput {
    id?: unknown;
    displayName?: unknown;
    version?: unknown;
    created?: unknown;
    baseTargetId?: unknown;
    targetData?: unknown;
    source?: unknown;
}

/** Resolution hooks the store needs to validate a derived target's base. */
export interface TargetConfigStoreOptions {
    /** Returns true when *targetId* is a shipped (runtime-provided) target. */
    isShippedTarget?: (targetId: string) => boolean;
    /** Returns true when *targetId* is itself a user target (chains are forbidden). */
    isUserTarget?: (targetId: string) => boolean;
}

interface SaveOptions {
    allowOverwrite?: boolean;
}

export interface TargetConfigConflict {
    type: 'id' | 'displayName';
    existing: TargetConfigRecord;
    incoming: TargetConfigRecord;
}

type CodedError = Error & { code?: string };

function codedError(code: string, message: string): CodedError {
    const error = new Error(message) as CodedError;
    error.code = code;
    return error;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeDisplayNameKey(value: unknown): string | null {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLocaleLowerCase() : null;
}

function normalizeVersion(versionValue: unknown): string {
    const version = normalizeString(versionValue);
    if (!version || !VERSION_PATTERN.test(version)) {
        throw codedError(
            'ERR_TARGET_VERSION_INVALID',
            'Target config version must use x.y.z format.'
        );
    }
    return version;
}

function normalizeCreated(createdValue: unknown): string {
    const created = normalizeString(createdValue);
    if (!created) {
        throw codedError(
            'ERR_TARGET_CREATED_INVALID',
            'Target config created field must be a human-readable date string.'
        );
    }
    if (Number.isNaN(Date.parse(created))) {
        throw codedError(
            'ERR_TARGET_CREATED_INVALID',
            'Target config created field must be a parseable human-readable date string.'
        );
    }
    return created;
}

function ensureRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw codedError('ERR_TARGET_SCHEMA_INVALID', 'Target config payload must be an object.');
    }
    return value as Record<string, unknown>;
}

function normalizeTargetData(
    targetData: Record<string, unknown>,
    id: string
): Record<string, unknown> {
    return {
        ...targetData,
        id,
        targetId: id,
    };
}

export class TargetConfigStore extends IndexedStore<TargetConfigRecord, string> {
    #isShippedTarget: ((targetId: string) => boolean) | null;
    #isUserTarget: ((targetId: string) => boolean) | null;

    constructor(options: TargetConfigStoreOptions = {}) {
        super({ dbName: DB_NAME, dbVersion: DB_VERSION, storeName: STORE_NAME, keyPath: 'id' });
        this.#isShippedTarget = options.isShippedTarget ?? null;
        this.#isUserTarget = options.isUserTarget ?? null;
    }

    prepareTargetConfigRecord(input: TargetConfigInput): TargetConfigRecord {
        const inputRecord = ensureRecord(input);
        const rawTargetData = ensureRecord(inputRecord.targetData);

        if (rawTargetData.openPins) {
            throw codedError(
                'ERR_TARGET_OPEN_PINS',
                'User target configs cannot declare openPins; upload a specific capability map instead.'
            );
        }

        const rawMetadata = rawTargetData.metadata;
        if (
            rawMetadata &&
            typeof rawMetadata === 'object' &&
            !Array.isArray(rawMetadata) &&
            (rawMetadata as Record<string, unknown>).isCustomTarget === true
        ) {
            throw codedError(
                'ERR_TARGET_CUSTOM_DEPRECATED',
                'The Custom target is removed; import a derived target (baseTargetId + overrides) instead.'
            );
        }

        const baseTargetId = normalizeString(inputRecord.baseTargetId);
        if (baseTargetId) {
            const isCustomBase = baseTargetId.toLowerCase() === 'custom';
            const isShipped = this.#isShippedTarget
                ? this.#isShippedTarget(baseTargetId)
                : false;
            if (isCustomBase || !isShipped) {
                throw codedError(
                    'ERR_TARGET_BASE_UNKNOWN',
                    `Target config base '${baseTargetId}' is not a shipped target.`
                );
            }
            if (this.#isUserTarget && this.#isUserTarget(baseTargetId)) {
                throw codedError(
                    'ERR_TARGET_BASE_CHAINED',
                    `Target config base '${baseTargetId}' is itself a user target; a base must be a shipped target.`
                );
            }
        }

        let targetInfo: DeviceTargetInfo;
        try {
            targetInfo = new DeviceTargetInfo(rawTargetData as DeviceTargetPayload);
        } catch {
            throw codedError(
                'ERR_TARGET_SCHEMA_INVALID',
                'Target config payload is not valid for DeviceTargetInfo.'
            );
        }

        const payloadId = normalizeString(targetInfo.id);
        if (!payloadId) {
            throw codedError('ERR_TARGET_ID_MISSING', 'Target config payload is missing target id.');
        }

        const providedId = normalizeString(inputRecord.id);
        if (providedId && providedId !== payloadId) {
            throw codedError(
                'ERR_TARGET_ID_MISMATCH',
                `Target config id '${providedId}' does not match payload id '${payloadId}'.`
            );
        }

        const id = providedId || payloadId;
        const displayName =
            normalizeString(inputRecord.displayName) || normalizeString(targetInfo.displayName) || id;
        const version = normalizeVersion(inputRecord.version);
        const created = normalizeCreated(inputRecord.created);

        return {
            id,
            displayName,
            version,
            source: 'user',
            created,
            baseTargetId,
            targetData: normalizeTargetData(rawTargetData, id),
        };
    }

    async saveTargetConfig(
        input: TargetConfigInput | TargetConfigRecord,
        options: SaveOptions = {}
    ): Promise<TargetConfigRecord> {
        const record = this.prepareTargetConfigRecord(input as TargetConfigInput);
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<TargetConfigRecord>;

        const existing = await adapter.get(record.id);
        if (existing && !options.allowOverwrite) {
            throw codedError(
                'ERR_TARGET_DUPLICATE_ID',
                `Target config '${record.id}' already exists in user store.`
            );
        }

        await adapter.put(record);
        return record;
    }

    async findTargetConfigConflict(
        input: TargetConfigInput | TargetConfigRecord
    ): Promise<TargetConfigConflict | null> {
        const incoming = this.prepareTargetConfigRecord(input as TargetConfigInput);

        const existingById = await this.getTargetConfig(incoming.id);
        if (existingById) {
            return {
                type: 'id',
                existing: existingById,
                incoming,
            };
        }

        const incomingDisplayNameKey = normalizeDisplayNameKey(incoming.displayName);
        if (!incomingDisplayNameKey) {
            return null;
        }

        const records = await this.listTargetConfigs();
        for (const record of records) {
            if (record.id === incoming.id) {
                continue;
            }

            const recordDisplayNameKey = normalizeDisplayNameKey(record.displayName);
            if (recordDisplayNameKey && recordDisplayNameKey === incomingDisplayNameKey) {
                return {
                    type: 'displayName',
                    existing: record,
                    incoming,
                };
            }
        }

        return null;
    }

    async getTargetConfig(id: string | null | undefined): Promise<TargetConfigRecord | null> {
        const normalizedId = normalizeString(id);
        if (!normalizedId) {
            return null;
        }
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<TargetConfigRecord>;
        return (await adapter.get(normalizedId)) || null;
    }

    async listTargetConfigs(): Promise<TargetConfigRecord[]> {
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<TargetConfigRecord>;
        const records = await adapter.list();
        if (!Array.isArray(records)) {
            return [];
        }

        const validRecords: TargetConfigRecord[] = [];
        for (const record of records) {
            try {
                validRecords.push(this.prepareTargetConfigRecord(record));
            } catch {
                continue;
            }
        }

        return validRecords;
    }

    async deleteTargetConfig(id: string | null | undefined): Promise<void> {
        const normalizedId = normalizeString(id);
        if (!normalizedId) {
            return;
        }
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<TargetConfigRecord>;
        await adapter.delete(normalizedId);
    }

    async clearTargetConfigs(): Promise<void> {
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<TargetConfigRecord>;
        await adapter.clear();
    }
}
