// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { IndexedStore } from './indexed-store.js';
import { Collection } from './collection.js';

const DB_NAME = 'micro-otter-collections';
const DB_VERSION = 1;
const STORE_NAME = 'collections';

type CollectionRecord = ReturnType<Collection['toData']>;

interface CollectionRepair {
    code: string;
    field: string;
    previousValue: unknown;
    nextValue: unknown;
}

interface CollectionLoadRepairEntry {
    collectionId: string;
    repairs: CollectionRepair[];
}

interface CollectionFromDataWithRepairResult {
    collection: Collection;
    repairedData: CollectionRecord;
    repairs: CollectionRepair[];
}

interface IndexedStoreAdapter<TRecord> {
    put(record: TRecord): Promise<TRecord | void>;
    get(key: string): Promise<TRecord | null | undefined>;
    list(): Promise<TRecord[] | null | undefined>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

interface MicroOtterLogger {
    log?: (
        component: string,
        eventName: string,
        level: string,
        payload: unknown
    ) => void;
}

function getMicroOtterLogger(): MicroOtterLogger | undefined {
    return (globalThis as typeof globalThis & { __microOtterLog?: MicroOtterLogger })
        .__microOtterLog;
}

export class CollectionStore extends IndexedStore {
    _lastLoadRepairs: CollectionLoadRepairEntry[];

    constructor() {
        super({ dbName: DB_NAME, dbVersion: DB_VERSION, storeName: STORE_NAME, keyPath: 'id' });
        this._lastLoadRepairs = [];
    }

    getLastLoadRepairs(): CollectionLoadRepairEntry[] {
        return this._lastLoadRepairs.map((entry) => ({
            collectionId: entry.collectionId,
            repairs: Array.isArray(entry.repairs) ? [...entry.repairs] : [],
        }));
    }

    async saveCollection(collection: Collection): Promise<Collection> {
        if (!(collection instanceof Collection)) {
            throw new Error('saveCollection expects a Collection instance');
        }

        const data = collection.toData();
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<CollectionRecord>;
        await adapter.put(data);
        return collection;
    }

    async getCollection(id: string | null | undefined): Promise<Collection | null> {
        if (!id) {
            return null;
        }
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<CollectionRecord>;
        const data = await adapter.get(id);
        if (!data) {
            return null;
        }
        const parsed = Collection.fromDataWithRepair(data) as CollectionFromDataWithRepairResult;
        if (parsed.repairs.length > 0) {
            await adapter.put(parsed.repairedData);
            getMicroOtterLogger()?.log?.('CollectionStore', 'repaired-record', 'warn', {
                collectionId: parsed.repairedData.id,
                repairs: parsed.repairs,
            });
        }
        return parsed.collection;
    }

    async listCollections(): Promise<Collection[]> {
        this._lastLoadRepairs = [];
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<CollectionRecord>;
        const records = await adapter.list();
        if (!Array.isArray(records)) {
            return [];
        }
        const collectionList: Collection[] = [];
        for (const record of records) {
            try {
                const parsed = Collection.fromDataWithRepair(
                    record
                ) as CollectionFromDataWithRepairResult;
                collectionList.push(parsed.collection);

                if (parsed.repairs.length > 0) {
                    await adapter.put(parsed.repairedData);
                    const repairedCollectionId = parsed.collection.getId();
                    this._lastLoadRepairs.push({
                        collectionId: repairedCollectionId,
                        repairs: parsed.repairs,
                    });
                    getMicroOtterLogger()?.log?.('CollectionStore', 'repaired-record', 'warn', {
                        collectionId: repairedCollectionId,
                        repairs: parsed.repairs,
                    });
                }
            } catch (error: unknown) {
                getMicroOtterLogger()?.log?.('CollectionStore', 'malformed-record', 'warn', error);
            }
        }
        return collectionList;
    }

    async deleteCollection(id: string | null | undefined): Promise<void> {
        if (!id) {
            return;
        }
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<CollectionRecord>;
        await adapter.delete(id);
    }

    async clearCollections(): Promise<void> {
        const adapter = (await this.getAdapter()) as IndexedStoreAdapter<CollectionRecord>;
        await adapter.clear();
    }
}
