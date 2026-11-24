import { IndexedStore } from './indexed-store.js';
import { WorkspaceConfig } from './workspace-config.js';

const DB_NAME = 'micro-otter-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'workspace-config';
const WORKSPACE_KEY = 'workspace-config-singleton';

interface IndexedStoreAdapter<TRecord> {
	put(record: TRecord): Promise<void>;
	get(key: string): Promise<TRecord | null | undefined>;
	delete(key: string): Promise<void>;
}

type WorkspaceConfigRecord = { id: string } & ReturnType<WorkspaceConfig['toData']>;

export class WorkspaceConfigStore extends IndexedStore {
	constructor() {
		const options = {
			dbName: DB_NAME,
			dbVersion: DB_VERSION,
			storeName: STORE_NAME,
			keyPath: 'id',
		};
		super(options);
	}

	async saveConfig(config: WorkspaceConfig): Promise<WorkspaceConfig> {
		if (!(config instanceof WorkspaceConfig)) {
			throw new Error('saveConfig expects a WorkspaceConfig instance');
		}

		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<WorkspaceConfigRecord>;
		const record: WorkspaceConfigRecord = { id: WORKSPACE_KEY, ...config.toData() };
		await adapter.put(record);
		return config;
	}

	async getConfig(): Promise<WorkspaceConfig> {
		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<WorkspaceConfigRecord>;
		const data = await adapter.get(WORKSPACE_KEY);
		if (!data) {
			return new WorkspaceConfig();
		}
		return WorkspaceConfig.fromData(data);
	}

	async clearConfig(): Promise<void> {
		const adapter = (await this.getAdapter()) as unknown as IndexedStoreAdapter<WorkspaceConfigRecord>;
		await adapter.delete(WORKSPACE_KEY);
	}
}
