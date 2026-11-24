// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Generic IndexedDB-backed store wrapper.
 *
 * Responsibilities:
 * - Create an IndexedDB object store with a predictable keyPath.
 * - Expose a simple adapter interface ({ list, get, put, delete, clear }).
 * - Surface a consistent error when IndexedDB is unavailable.
 */

export interface IndexedStoreOptions {
    dbName?: string;
    storeName?: string;
    dbVersion?: number;
    keyPath?: string;
}

export interface IndexedStoreAdapter<
    TRecord = Record<string, unknown>,
    TKey extends IDBValidKey = IDBValidKey,
> {
    type: 'indexeddb';
    close(): void;
    list(): Promise<TRecord[]>;
    get(id: TKey): Promise<TRecord | undefined>;
    put(record: TRecord): Promise<TRecord>;
    delete(id: TKey): Promise<unknown>;
    clear(): Promise<unknown>;
}

export class IndexedStore<
    TRecord = Record<string, unknown>,
    TKey extends IDBValidKey = IDBValidKey,
> {
    #adapterPromise: Promise<IndexedStoreAdapter<TRecord, TKey>> | null = null;

    dbName: string;
    storeName: string;
    dbVersion: number;
    keyPath: string;

    constructor({ dbName, storeName, dbVersion = 1, keyPath = 'id' }: IndexedStoreOptions = {}) {
        if (!dbName || !storeName) {
            throw new Error('IndexedStore requires dbName and storeName');
        }
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbVersion = dbVersion;
        this.keyPath = keyPath;

        if (!this.hasIndexedDb()) {
            throw new Error('IndexedDB is not supported in this environment');
        }

        this.#adapterPromise = this.createIndexedDbAdapter().catch((error: unknown) => {
            console.warn('[indexed-store] IndexedDB unavailable', error);
            throw new Error('IndexedDB unavailable');
        });
    }

    resetForTest(): void {
        this.#adapterPromise = null;
    }

    hasIndexedDb(): boolean {
        return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
    }

    async getAdapter(): Promise<IndexedStoreAdapter<TRecord, TKey> | null> {
        return this.#adapterPromise;
    }

    promisifyRequest<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
        return new Promise<TResult>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }

    createIndexedDbAdapter(): Promise<IndexedStoreAdapter<TRecord, TKey>> {
        const promisifyRequest = this.promisifyRequest.bind(this);
        const { dbName, dbVersion, storeName, keyPath } = this;

        return new Promise<IndexedStoreAdapter<TRecord, TKey>>((resolve, reject) => {
            const request = indexedDB.open(dbName, dbVersion);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath });
                }
            };

            request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));

            request.onsuccess = () => {
                const db = request.result;

                db.onversionchange = () => {
                    try {
                        db.close();
                    } catch (error: unknown) {
                        console.warn('[indexed-store] Failed to close DB on versionchange', error);
                    }
                };

                const withStore = <TResult>(
                    mode: IDBTransactionMode,
                    fn: (store: IDBObjectStore) => TResult | Promise<TResult> | IDBRequest<TResult>
                ): Promise<TResult> =>
                    new Promise<TResult>((resolveTx, rejectTx) => {
                        const tx = db.transaction(storeName, mode);
                        const store = tx.objectStore(storeName);
                        const maybeRequest = fn(store);
                        if (
                            maybeRequest &&
                            typeof (maybeRequest as IDBRequest<TResult>).onsuccess === 'function'
                        ) {
                            promisifyRequest(maybeRequest as IDBRequest<TResult>)
                                .then(resolveTx)
                                .catch(rejectTx);
                        } else {
                            Promise.resolve(maybeRequest as TResult | Promise<TResult>)
                                .then(resolveTx)
                                .catch(rejectTx);
                        }
                        tx.onerror = () =>
                            rejectTx(tx.error || new Error('IndexedDB transaction failed'));
                    });

                resolve({
                    type: 'indexeddb',
                    close() {
                        try {
                            db.close();
                        } catch (error: unknown) {
                            console.warn('[indexed-store] Failed to close DB', error);
                        }
                    },
                    async list() {
                        return withStore('readonly', (store) => promisifyRequest(store.getAll())).then(
                            (records) => records as TRecord[]
                        );
                    },
                    async get(id) {
                        return withStore('readonly', (store) =>
                            promisifyRequest(store.get(id))
                        ).then((record) => record as TRecord | undefined);
                    },
                    async put(record) {
                        return withStore('readwrite', (store) =>
                            promisifyRequest(store.put(record))
                        ).then(() => record);
                    },
                    async delete(id) {
                        return withStore('readwrite', (store) =>
                            promisifyRequest(store.delete(id))
                        );
                    },
                    async clear() {
                        return withStore('readwrite', (store) => promisifyRequest(store.clear()));
                    },
                });
            };
        });
    }
}
