export interface WorkspaceConfigData {
	activeCollectionId?: string | null;
	selectedDeviceRuntimeId?: string | null;
	viewLayout?: Record<string, unknown> | null;
	locale?: string | null;
	theme?: string | null;
	collectionManager?: Record<string, unknown> | null;
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeOptionalObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	return value as Record<string, unknown>;
}

export class WorkspaceConfig {
	activeCollectionId: string | null;

	selectedDeviceRuntimeId: string | null;

	viewLayout: Record<string, unknown> | null;

	locale: string | null;

	theme: string | null;

	collectionManager: Record<string, unknown> | null;

	constructor({
		activeCollectionId = null,
		selectedDeviceRuntimeId = null,
		viewLayout = null,
		locale = null,
		theme = null,
		collectionManager = null,
	}: WorkspaceConfigData = {}) {
		this.activeCollectionId = normalizeOptionalString(activeCollectionId);
		this.selectedDeviceRuntimeId = normalizeOptionalString(selectedDeviceRuntimeId);
		this.viewLayout = normalizeOptionalObject(viewLayout);
		this.locale = normalizeOptionalString(locale);
		this.theme = normalizeOptionalString(theme);
		this.collectionManager = normalizeOptionalObject(collectionManager);
	}

	toData(): Required<WorkspaceConfigData> {
		return {
			activeCollectionId: this.activeCollectionId,
			selectedDeviceRuntimeId: this.selectedDeviceRuntimeId,
			viewLayout: this.viewLayout,
			locale: this.locale,
			theme: this.theme,
			collectionManager: this.collectionManager,
		};
	}

	static fromData(data: WorkspaceConfigData = {}): WorkspaceConfig {
		return new WorkspaceConfig({
			activeCollectionId: normalizeOptionalString(data.activeCollectionId),
			selectedDeviceRuntimeId: normalizeOptionalString(data.selectedDeviceRuntimeId),
			viewLayout: normalizeOptionalObject(data.viewLayout),
			locale: normalizeOptionalString(data.locale),
			theme: normalizeOptionalString(data.theme),
			collectionManager: normalizeOptionalObject(data.collectionManager),
		});
	}
}
