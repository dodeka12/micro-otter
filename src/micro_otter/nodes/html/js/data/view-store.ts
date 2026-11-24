import { IndexedStore } from './indexed-store.js';

const DB_NAME = 'micro-otter-views';
const DB_VERSION = 1;
const STORE_NAME = 'view-layouts';
const DEFAULT_SCHEMA = 'view-layout';
const DEFAULT_SCHEMA_VERSION = 1;

interface IndexedStoreAdapter<TRecord> {
	put(record: TRecord): Promise<void>;
	get(key: string): Promise<TRecord | null | undefined>;
	delete(key: string): Promise<void>;
}

export interface ViewLayoutRecord {
	id: string;
	schema: string;
	schemaVersion: number;
	payload: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	updatedAt: string;
}

export interface ViewStoreOptions {
	schema?: string;
	schemaVersion?: number;
}

export class ViewStore extends IndexedStore {
	schema: string;

	schemaVersion: number;

	constructor({ schema = DEFAULT_SCHEMA, schemaVersion = DEFAULT_SCHEMA_VERSION }: ViewStoreOptions = {}) {
		const options = {
			dbName: DB_NAME,
			dbVersion: DB_VERSION,
			storeName: STORE_NAME,
			keyPath: 'id',
		};
		super(options);
		this.schema = schema;
		this.schemaVersion = schemaVersion;
	}

	async saveLayout(
		id: string,
		payload: Record<string, unknown>,
		metadata: Record<string, unknown> | undefined = undefined
	): Promise<ViewLayoutRecord> {
		if (!id || typeof id !== 'string') {
			throw new Error('saveLayout requires a string id');
		}
		if (!payload || typeof payload !== 'object') {
			throw new Error('saveLayout requires a serialized view payload object');
		}

		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<ViewLayoutRecord>;
		const record = this.#buildRecord(id, payload, metadata);
		await adapter.put(record);
		return record;
	}

	async getLayout(id: string): Promise<ViewLayoutRecord | null> {
		if (!id) {
			return null;
		}
		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<ViewLayoutRecord>;
		const record = await adapter.get(id);
		return record || null;
	}

	async deleteLayout(id: string): Promise<void> {
		if (!id) {
			return;
		}
		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<ViewLayoutRecord>;
		await adapter.delete(id);
	}

	#buildRecord(
		id: string,
		payload: Record<string, unknown>,
		metadata?: Record<string, unknown>
	): ViewLayoutRecord {
		const record: ViewLayoutRecord = {
			id,
			schema: this.schema,
			schemaVersion: this.schemaVersion,
			payload,
			updatedAt: new Date().toISOString(),
		};
		if (metadata && typeof metadata === 'object') {
			record.metadata = metadata;
		}
		return record;
	}
}
