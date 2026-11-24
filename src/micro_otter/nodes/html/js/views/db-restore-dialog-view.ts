import { ModalDialogView } from './modal-dialog-view.js';
import { Collection } from '../data/collection.js';
import { FlaggedVersion } from '../data/flagged-version.js';
import { TextDialogView } from './text-dialog-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { ErrorDialogView } from './error-dialog-view.js';
import {
    ManualCollectionSelectionDialogView,
    type CollectionAnalysisItem,
} from './manual-collection-selection-dialog-view.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import type { Workspace } from '../core/workspace.js';
import type { ViewManager } from './view-manager.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

type RestoreMode = 'replace' | 'merge' | 'manual';
type MergeStrategy = 'overwrite-newer' | 'keep-local';
type RestoreScope = 'all' | 'targetConfigsOnly';
type CollectionStatus = 'new' | 'newer' | 'older' | 'conflict';

interface DirtyVersionFlags {
    major: boolean;
    minor: boolean;
    patch: boolean;
}

interface VersionData {
    major: number;
    minor: number;
    patch: number;
    dirty?: Partial<DirtyVersionFlags>;
}

type VersionLike = VersionData | FlaggedVersion;

interface BackupCollectionData extends Record<string, unknown> {
    id: string;
    title?: string;
    version: VersionData;
}

interface BackupData extends Record<string, unknown> {
    timestamp: string | number | Date;
    collections: BackupCollectionData[];
    targetConfigs?: {
        count?: number;
        items?: BackupTargetConfigData[];
    };
}

interface BackupTargetConfigData extends Record<string, unknown> {
    id: string;
    displayName?: string;
    version: string;
    created?: string;
    targetData: Record<string, unknown>;
}

interface LocalCollectionVersionData {
    title: string;
    version: FlaggedVersion;
}

interface LocalTargetConfigVersionData {
    title: string;
    version: string;
}

interface BackupAnalysisItem {
    kind?: 'collection' | 'targetConfig';
    id: string;
    title: string;
    backupVersion: string;
    localVersion: string | null;
    status: CollectionStatus;
    backupData: BackupCollectionData;
}

interface BackupAnalysis {
    backupCount: number;
    localCount: number;
    conflicts: number;
    items: BackupAnalysisItem[];
}

interface TargetConfigAnalysis {
    backupCount: number;
    localCount: number;
    conflicts: number;
    items: BackupAnalysisItem[];
}

interface RestoreErrorItem {
    title: string;
    error: unknown;
}

interface ReplaceResults {
    imported: string[];
    errors: RestoreErrorItem[];
}

interface MergeResults {
    imported: string[];
    overwritten: string[];
    skipped: string[];
    errors: RestoreErrorItem[];
}

type RestoreResults = ReplaceResults | MergeResults;

interface RestoreConfirmResult {
    confirmed: boolean;
    openedManual?: boolean;
    mode?: RestoreMode;
    results?: RestoreResults;
    error?: unknown;
}

interface DBRestoreDialogOptions {
    backupData: BackupData;
    workspace: Workspace;
    viewManager: ViewManager;
    restoreScope?: RestoreScope;
    title?: string;
    icon?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    id?: string | null;
    i18nService?: I18nServiceLike;
    logger?: LoggerLike;
}

/**
 * DB Restore Dialog View - restore collection database from backup.
 *
 * Provides three restore modes:
 * 1. Replace Entire Database - destructive full replacement
 * 2. Merge with Conflict Handling - smart merge with version comparison
 * 3. Manual Selection - user chooses which collections to import
 *
 * Implements modal dialog pattern with ViewManager integration.
 */
export class DBRestoreDialogView extends ModalDialogView {
    backupData: BackupData;
    workspace: Workspace;
    viewManager: ViewManager;

    _analysis: BackupAnalysis | null;
    _selectedMode: RestoreMode;
    _mergeStrategy: MergeStrategy;
    _restoreScope: RestoreScope;
    _localCollectionVersions: Map<string, LocalCollectionVersionData>;
    _localTargetConfigVersions: Map<string, LocalTargetConfigVersionData>;
    _targetConfigAnalysis: TargetConfigAnalysis;
    _initialized: boolean;

    /**
     * Create a DB restore dialog.
     * @param {object} options
     * @param {object} options.backupData Parsed backup JSON.
     * @param {object} options.workspace Workspace instance.
     * @param {object} options.viewManager ViewManager for sub-dialogs.
     * @param {string} [options.title] Dialog title.
     * @param {string} [options.icon] Dialog icon.
     * @param {string} [options.confirmLabel] Restore button label.
     * @param {string} [options.cancelLabel] Cancel button label.
     * @param {string|null} [options.id] View id.
     * @param {object|null} [options.i18nService] I18n service.
     * @param {Function|null} [options.logger] Logger function.
     */
    constructor({
        backupData,
        workspace,
        viewManager,
        restoreScope = 'all',
        title = 'Restore Collection Database',
        icon = '📥',
        confirmLabel = 'Restore',
        cancelLabel = 'Cancel',
        id = null,
        i18nService = null,
        logger = null,
    }: DBRestoreDialogOptions = {} as DBRestoreDialogOptions) {
        super({
            title,
            icon,
            confirmLabel,
            cancelLabel,
            id,
            i18nService,
            logger,
        });

        this.backupData = backupData;
        this.workspace = workspace;
        this.viewManager = viewManager;
        this._analysis = null;
        this._selectedMode = 'manual'; // 'replace' | 'merge' | 'manual'
        this._mergeStrategy = 'overwrite-newer'; // 'overwrite-newer' | 'keep-local'
        this._restoreScope = restoreScope;
        this._localCollectionVersions = new Map(); // collectionId -> {title, version}
        this._localTargetConfigVersions = new Map(); // targetId -> {title, version}
        this._targetConfigAnalysis = {
            backupCount: 0,
            localCount: 0,
            conflicts: 0,
            items: [],
        };
        this._initialized = false;
    }

    /**
     * Initialize by loading local collection versions.
     * Must be called before showing the dialog.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) {
            return;
        }

        if (this._shouldRestoreCollections()) {
            const localIds = this.workspace.getCollectionIds();
            for (const id of localIds) {
                try {
                    const collection = await this.workspace.getCollection(id);
                    if (collection) {
                        this._localCollectionVersions.set(id, {
                            title: collection.getTitle(),
                            version: collection.getVersion(),
                        });
                    }
                } catch {
                    // Silently skip collections that fail to load
                }
            }
        }

        if (typeof this.workspace.listUserTargetConfigs === 'function') {
            const localTargetConfigs = await this.workspace.listUserTargetConfigs();
            for (const targetConfig of localTargetConfigs || []) {
                this._localTargetConfigVersions.set(targetConfig.id, {
                    title: targetConfig.displayName || targetConfig.id,
                    version: targetConfig.version,
                });
            }
        }

        this._initialized = true;
    }

    _shouldRestoreCollections(): boolean {
        return this._restoreScope !== 'targetConfigsOnly';
    }

    _shouldRestoreTargetConfigs(): boolean {
        return true;
    }

    _getBackupTargetConfigItems(): BackupTargetConfigData[] {
        const items = this.backupData?.targetConfigs?.items;
        if (!Array.isArray(items)) {
            return [];
        }
        return items;
    }

    _compareSimpleVersions(versionA: string, versionB: string): number {
        const parse = (value: string): [number, number, number] | null => {
            if (typeof value !== 'string') {
                return null;
            }
            const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
            if (!match) {
                return null;
            }
            return [Number(match[1]), Number(match[2]), Number(match[3])];
        };

        const a = parse(versionA);
        const b = parse(versionB);
        if (!a || !b) {
            return 0;
        }

        if (a[0] !== b[0]) {
            return a[0] > b[0] ? 1 : -1;
        }
        if (a[1] !== b[1]) {
            return a[1] > b[1] ? 1 : -1;
        }
        if (a[2] !== b[2]) {
            return a[2] > b[2] ? 1 : -1;
        }
        return 0;
    }

    /**
     * Render the dialog with custom width.
     * @param {HTMLElement} container Host element.
     * @override
     */
    render(container: HTMLElement): void {
        super.render(container);
        // Add custom class for wider dialog
        const dialog = this._dialogEl;
        if (dialog) {
            dialog.classList.add('db-restore-dialog-root');
        }
    }

    /**
     * Build the dialog body with restore options.
     * @returns {HTMLElement}
     * @protected
     */
    protected _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body db-restore-dialog';

        // Analyze backup vs local
        this._analysis = this._analyzeBackup();
        this._targetConfigAnalysis = this._analyzeTargetConfigs();

        // Backup info section
        const infoSection = this._createInfoSection();
        body.appendChild(infoSection);

        // Restore options
        const optionsSection = this._createOptionsSection();
        body.appendChild(optionsSection);

        return body;
    }

    /**
     * Analyze backup data and compare with local collections.
     * @returns {object} Analysis results.
     * @private
     */
    _analyzeBackup(): BackupAnalysis {
        const backupCollections = this._shouldRestoreCollections() ? this.backupData.collections || [] : [];
        
        const analysis: BackupAnalysis = {
            backupCount: backupCollections.length,
            localCount: this._shouldRestoreCollections() ? this._localCollectionVersions.size : 0,
            conflicts: 0,
            items: [],
        };

        for (const backupData of backupCollections) {
            const backupId = backupData.id;
            const localCollectionData = this._localCollectionVersions.get(backupId);

            let status: CollectionStatus = 'new';
            if (localCollectionData) {
                const backupVer = backupData.version;
                const localVer = localCollectionData.version.toData();
                
                // Check if versions are numerically equal
                const numericallyEqual =
                    backupVer.major === localVer.major &&
                    backupVer.minor === localVer.minor &&
                    backupVer.patch === localVer.patch;
                
                // If numerically equal but local has dirty flags, it's a conflict
                const localDirty = localVer.dirty.major || localVer.dirty.minor || localVer.dirty.patch;
                
                if (numericallyEqual && localDirty) {
                    status = 'conflict';
                    analysis.conflicts++;
                } else {
                    const comparison = this._compareVersions(
                        backupData.version,
                        localCollectionData.version
                    );
                    
                    if (comparison > 0) {
                        status = 'newer';
                    } else if (comparison < 0) {
                        status = 'older';
                    } else {
                        status = 'conflict';
                        analysis.conflicts++;
                    }
                }
            }

            analysis.items.push({
                kind: 'collection',
                id: backupId,
                title: backupData.title || 'Untitled',
                backupVersion: this._formatVersion(backupData.version),
                localVersion: localCollectionData
                    ? this._formatVersion(localCollectionData.version)
                    : null,
                status,
                backupData,
            });
        }

        return analysis;
    }

    _analyzeTargetConfigs(): TargetConfigAnalysis {
        const backupTargetConfigs = this._shouldRestoreTargetConfigs()
            ? this._getBackupTargetConfigItems()
            : [];

        const analysis: TargetConfigAnalysis = {
            backupCount: backupTargetConfigs.length,
            localCount: this._localTargetConfigVersions.size,
            conflicts: 0,
            items: [],
        };

        for (const backupTargetConfig of backupTargetConfigs) {
            const backupId = backupTargetConfig.id;
            const localTargetData = this._localTargetConfigVersions.get(backupId);

            let status: CollectionStatus = 'new';
            if (localTargetData) {
                const comparison = this._compareSimpleVersions(
                    backupTargetConfig.version,
                    localTargetData.version
                );

                if (comparison > 0) {
                    status = 'newer';
                } else if (comparison < 0) {
                    status = 'older';
                } else {
                    status = 'conflict';
                    analysis.conflicts++;
                }
            }

            analysis.items.push({
                kind: 'targetConfig',
                id: backupId,
                title: backupTargetConfig.displayName || backupId,
                backupVersion: backupTargetConfig.version,
                localVersion: localTargetData ? localTargetData.version : null,
                status,
                backupData: backupTargetConfig as unknown as BackupCollectionData,
            });
        }

        return analysis;
    }

    /**
     * Compare two version objects.
     * @param {object} versionA Backup version (clean).
     * @param {FlaggedVersion} versionB Local version (may be dirty).
     * @returns {number} 1 if A > B, -1 if A < B, 0 if equal.
     * @private
     */
    _compareVersions(versionA: VersionLike, versionB: VersionLike): number {
        // Get version data for comparison
        const vA = versionA;
        const vB = versionB instanceof FlaggedVersion ? versionB.toData() : versionB;

        // Compare major.minor.patch
        if (vA.major !== vB.major) {
            return vA.major > vB.major ? 1 : -1;
        }
        if (vA.minor !== vB.minor) {
            return vA.minor > vB.minor ? 1 : -1;
        }
        if (vA.patch !== vB.patch) {
            return vA.patch > vB.patch ? 1 : -1;
        }

        // If versions are numerically equal, check if local has dirty flag
        const localDirty = vB.dirty && (vB.dirty.major || vB.dirty.minor || vB.dirty.patch);
        if (localDirty) {
            return -1; // Local is "newer" due to uncommitted changes
        }

        return 0; // Exactly equal
    }

    /**
     * Format version for display.
     * @param {object|FlaggedVersion} version Version object.
     * @returns {string} Formatted version string.
     * @private
     */
    _formatVersion(version: VersionLike): string {
        const vData = version instanceof FlaggedVersion ? version.toData() : version;
        const v = `${vData.major}.${vData.minor}.${vData.patch}`;
        const isDirty = vData.dirty && (vData.dirty.major || vData.dirty.minor || vData.dirty.patch);
        return isDirty ? `${v}*` : v;
    }

    /**
     * Create backup info section.
     * @returns {HTMLElement}
     * @private
     */
    _createInfoSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'db-restore-dialog__info';

        const backupDate = new Date(this.backupData.timestamp);
        const dateStr = backupDate.toLocaleString();

        const infoLines = [
            '<div><strong>Backup Information</strong></div>',
            `<div>• Created: ${dateStr}</div>`,
        ];

        if (this._shouldRestoreCollections()) {
            infoLines.push(`<div>• Contains: ${this._analysis?.backupCount ?? 0} collection(s)</div>`);
            infoLines.push(`<div>• Local database: ${this._analysis?.localCount ?? 0} collection(s)</div>`);
        }

        if (this._shouldRestoreTargetConfigs()) {
            infoLines.push(
                `<div>• Contains: ${this._getBackupTargetConfigItems().length} target config(s)</div>`
            );
            infoLines.push(
                `<div>• Local database: ${this._localTargetConfigVersions.size} target config(s)</div>`
            );
        }

        const totalConflicts =
            (this._analysis?.conflicts ?? 0) + (this._targetConfigAnalysis?.conflicts ?? 0);
        if (totalConflicts > 0) {
            infoLines.push(`<div>• Conflicts detected: ${totalConflicts}</div>`);
        }

        section.innerHTML = infoLines.join('');

        return section;
    }

    /**
     * Create restore options section.
     * @returns {HTMLElement}
     * @private
     */
    _createOptionsSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'db-restore-dialog__options';

        // Option 1: Replace
        const replaceOption = this._createOption(
            'replace',
            'Replace Entire Database',
            'Delete all local collections and import backup. ⚠️ This action is destructive!'
        );
        replaceOption.classList.add('db-restore-dialog__option--destructive');
        section.appendChild(replaceOption);

        // Option 2: Merge
        const mergeOption = this._createOption(
            'merge',
            'Merge with Conflict Handling',
            'Import backup and handle conflicts:'
        );
        
        const mergeStrategies = document.createElement('div');
        mergeStrategies.className = 'db-restore-dialog__merge-strategies';
        mergeStrategies.style.marginTop = '8px';
        mergeStrategies.style.paddingLeft = '20px';
        
        const overwriteStrategy = document.createElement('label');
        overwriteStrategy.style.display = 'block';
        overwriteStrategy.innerHTML = `
            <input type="radio" name="merge-strategy" value="overwrite-newer" checked>
            Overwrite if backup is newer
        `;
        mergeStrategies.appendChild(overwriteStrategy);
        
        const keepLocalStrategy = document.createElement('label');
        keepLocalStrategy.style.display = 'block';
        keepLocalStrategy.innerHTML = `
            <input type="radio" name="merge-strategy" value="keep-local">
            Keep local if conflict exists
        `;
        mergeStrategies.appendChild(keepLocalStrategy);
        
        mergeOption.appendChild(mergeStrategies);
        section.appendChild(mergeOption);

        // Option 3: Manual
        const manualOption = this._createOption(
            'manual',
            'Manual Selection',
            'Review and select collections to import'
        );
        section.appendChild(manualOption);

        // Set default selection
        this._selectMode('manual');

        return section;
    }

    /**
     * Create a restore option card.
     * @param {string} mode Mode identifier.
     * @param {string} title Option title.
     * @param {string} description Option description.
     * @returns {HTMLElement}
     * @private
     */
    _createOption(mode: RestoreMode, title: string, description: string): HTMLElement {
        const option = document.createElement('div');
        option.className = 'db-restore-dialog__option';
        option.dataset.mode = mode;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'restore-mode';
        radio.value = mode;
        radio.id = `restore-mode-${mode}`;

        const label = document.createElement('label');
        label.htmlFor = `restore-mode-${mode}`;
        label.style.cursor = 'pointer';
        label.innerHTML = `<strong>${title}</strong><br>${description}`;

        option.appendChild(radio);
        option.appendChild(label);

        // Click handler for entire option card
        option.addEventListener('click', (e: MouseEvent) => {
            if (e.target !== radio) {
                radio.checked = true;
            }
            this._selectMode(mode);
        });

        radio.addEventListener('change', () => {
            if (radio.checked) {
                this._selectMode(mode);
            }
        });

        return option;
    }

    /**
     * Select a restore mode.
     * @param {string} mode Mode to select.
     * @private
     */
    _selectMode(mode: RestoreMode): void {
        this._selectedMode = mode;
        
        // Update visual state
        const options = this.container?.querySelectorAll<HTMLElement>('.db-restore-dialog__option') ?? [];
        options.forEach((opt) => {
            if (opt.dataset.mode === mode) {
                opt.classList.add('db-restore-dialog__option--selected');
            } else {
                opt.classList.remove('db-restore-dialog__option--selected');
            }
        });

        // Update merge strategy if merge mode
        if (mode === 'merge') {
            const checkedStrategy = this.container?.querySelector<HTMLInputElement>(
                'input[name="merge-strategy"]:checked'
            );
            if (checkedStrategy) {
                this._mergeStrategy = checkedStrategy.value as MergeStrategy;
            }
        }
    }

    /**
     * Handle confirm action - execute restore.
     * @returns {Promise<object>} Result payload.
     * @protected
     */
    _onConfirm(): Record<string, unknown> {
        return this._onConfirmAsync() as unknown as Record<string, unknown>;
    }

    async _onConfirmAsync(): Promise<RestoreConfirmResult> {
        const mode = this._selectedMode;

        try {
            // Manual mode opens separate dialog
            if (mode === 'manual') {
                // Close this dialog and open manual selection dialog
                this._openManualSelectionDialog();
                return { confirmed: false, openedManual: true };
            }

            // Double confirmation for replace mode
            if (mode === 'replace') {
                const confirmed = await this._showDeleteConfirmation();
                if (!confirmed) {
                    return { confirmed: false };
                }
            }

            let results: ReplaceResults | MergeResults | undefined;
            if (mode === 'replace') {
                results = await this._executeReplaceMode();
            } else if (mode === 'merge') {
                results = await this._executeMergeMode();
            }

            // Show results summary
            if (results) {
                await this._showResultsSummary(results);
            }

            return { confirmed: true, mode, results };
        } catch (error: unknown) {
            const errorMessage = (error as { message?: string }).message;
            await this._showError('Restore Failed', errorMessage ?? 'Unknown error');
            return { confirmed: false, error: errorMessage };
        }
    }

    /**
     * Execute replace mode.
     * @returns {Promise<object>} Results.
     * @private
     */
    async _executeReplaceMode(): Promise<ReplaceResults> {
        const results: ReplaceResults = {
            imported: [],
            errors: [],
        };

        if (this._shouldRestoreCollections()) {
            const localIds = this.workspace.getCollectionIds();
            for (const id of localIds) {
                await this.workspace.deleteCollection(id);
            }
        }

        if (this._shouldRestoreCollections()) {
            for (const collectionData of this.backupData.collections) {
                try {
                    const collection = await this._importCollection(collectionData);
                    results.imported.push(collection.getTitle());
                } catch (error: unknown) {
                    results.errors.push({
                        title: collectionData.title || 'Unknown',
                        error: (error as { message?: unknown }).message,
                    });
                }
            }
        }

        if (this._shouldRestoreTargetConfigs()) {
            if (typeof this.workspace.clearUserTargetConfigs === 'function') {
                await this.workspace.clearUserTargetConfigs();
            }

            for (const targetConfig of this._getBackupTargetConfigItems()) {
                try {
                    const saved = await this._importTargetConfig(targetConfig);
                    results.imported.push(`Target: ${saved.displayName || saved.id}`);
                } catch (error: unknown) {
                    results.errors.push({
                        title: `Target: ${targetConfig.displayName || targetConfig.id || 'Unknown'}`,
                        error: (error as { message?: unknown }).message,
                    });
                }
            }
        }

        if (this._shouldRestoreCollections() && this.backupData.collections.length > 0) {
            const firstId = this.backupData.collections[0].id;
            if (firstId) {
                await this.workspace.setActiveCollectionId(firstId);
            }
        }

        return results;
    }

    /**
     * Execute merge mode.
     * @returns {Promise<object>} Results.
     * @private
     */
    async _executeMergeMode(): Promise<MergeResults> {
        const strategy = this._mergeStrategy;
        const results: MergeResults = {
            imported: [],
            overwritten: [],
            skipped: [],
            errors: [],
        };

        if (this._shouldRestoreCollections()) {
            for (const backupData of this.backupData.collections) {
                const backupId = backupData.id;
                const localCollectionData = this._localCollectionVersions.get(backupId);

                try {
                    if (!localCollectionData) {
                        const collection = await this._importCollection(backupData);
                        results.imported.push(collection.getTitle());
                    } else {
                        const comparison = this._compareVersions(
                            backupData.version,
                            localCollectionData.version
                        );

                        if (strategy === 'overwrite-newer' && comparison > 0) {
                            await this.workspace.deleteCollection(backupId);
                            const collection = await this._importCollection(backupData);
                            results.overwritten.push(collection.getTitle());
                        } else {
                            results.skipped.push(localCollectionData.title);
                        }
                    }
                } catch (error: unknown) {
                    results.errors.push({
                        title: backupData.title || 'Unknown',
                        error: (error as { message?: unknown }).message,
                    });
                }
            }
        }

        if (this._shouldRestoreTargetConfigs()) {
            for (const targetConfig of this._getBackupTargetConfigItems()) {
                const backupId = targetConfig.id;
                const localTargetData = this._localTargetConfigVersions.get(backupId);

                try {
                    if (!localTargetData) {
                        const saved = await this._importTargetConfig(targetConfig);
                        results.imported.push(`Target: ${saved.displayName || saved.id}`);
                    } else {
                        const comparison = this._compareSimpleVersions(
                            targetConfig.version,
                            localTargetData.version
                        );

                        if (strategy === 'overwrite-newer' && comparison > 0) {
                            if (typeof this.workspace.deleteUserTargetConfig === 'function') {
                                await this.workspace.deleteUserTargetConfig(backupId);
                            }
                            const saved = await this._importTargetConfig(targetConfig);
                            results.overwritten.push(`Target: ${saved.displayName || saved.id}`);
                        } else {
                            results.skipped.push(`Target: ${localTargetData.title}`);
                        }
                    }
                } catch (error: unknown) {
                    results.errors.push({
                        title: `Target: ${targetConfig.displayName || backupId || 'Unknown'}`,
                        error: (error as { message?: unknown }).message,
                    });
                }
            }
        }

        return results;
    }

    /**
     * Open manual selection dialog.
     * @private
     */
    _openManualSelectionDialog(): void {
        const manualItems: CollectionAnalysisItem[] = [];
        if (this._shouldRestoreCollections()) {
            manualItems.push(
                ...(this._analysis?.items ?? []).map(
                    (item): CollectionAnalysisItem => ({ ...item, kind: 'collection' })
                )
            );
        }
        if (this._shouldRestoreTargetConfigs()) {
            manualItems.push(
                ...(this._targetConfigAnalysis?.items ?? []).map(
                    (item): CollectionAnalysisItem => ({
                        ...item,
                        kind: 'targetConfig',
                    })
                )
            );
        }

        const dialog = new ManualCollectionSelectionDialogView({
            items: manualItems,
            backupData: this.backupData,
            workspace: this.workspace,
            viewManager: this.viewManager,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Show the dialog
        this.viewManager.showModal(dialog);
    }



    /**
     * Import a single collection from backup data.
     * @param {object} collectionData Collection data.
     * @returns {Promise<Collection>} Imported collection.
     * @private
     */
    async _importCollection(collectionData: BackupCollectionData): Promise<Collection> {
        // Use Collection.fromData() for deserialization
        const collection = Collection.fromData(collectionData as Record<string, unknown>);

        // Save to workspace
        await this.workspace.saveCollection(collection);

        return collection;
    }

    async _importTargetConfig(targetConfigData: BackupTargetConfigData) {
        if (typeof this.workspace.saveUserTargetConfig !== 'function') {
            throw new Error('Workspace target config API unavailable');
        }

        return this.workspace.saveUserTargetConfig(targetConfigData);
    }

    /**
     * Show delete confirmation dialog.
     * @returns {Promise<boolean>} True if confirmed.
     * @private
     */
    async _showDeleteConfirmation(): Promise<boolean> {
        return new Promise((resolve) => {
            const deleteMessage = this._shouldRestoreCollections()
                ? 'This will DELETE all local collections.'
                : 'This will DELETE all local target configs.';
            const dialog = new ConfirmationDialogView({
                title: 'Confirm Database Replacement',
                message: deleteMessage,
                detail: 'This action cannot be undone. Are you sure?',
                confirmLabel: 'Delete All',
                cancelLabel: 'Cancel',
                destructive: true,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('confirm', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.deleteConfirmationConfirmListener'
                );
                resolve(true);
            });
            dialog.on('cancel', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.deleteConfirmationCancelListener'
                );
                resolve(false);
            });
            dialog.on('close', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.deleteConfirmationCloseListener'
                );
                resolve(false);
            });

            this.viewManager.showModal(dialog);
        });
    }

    /**
     * Show overwrite confirmation dialog.
     * @param {Array<object>} items Items that will be overwritten.
     * @returns {Promise<boolean>} True if confirmed.
     * @private
     */
    async _showOverwriteConfirmation(items: Array<{ title: string }>): Promise<boolean> {
        return new Promise((resolve) => {
            const list = items.map((item) => `• ${item.title}`).join('\n');
            const dialog = new ConfirmationDialogView({
                title: 'Confirm Overwrite',
                message: 'The following items will be overwritten:',
                detail: `\n${list}\n\nContinue?`,
                confirmLabel: 'Overwrite',
                cancelLabel: 'Cancel',
                destructive: false,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('confirm', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.overwriteConfirmationConfirmListener'
                );
                resolve(true);
            });
            dialog.on('cancel', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.overwriteConfirmationCancelListener'
                );
                resolve(false);
            });
            dialog.on('close', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.overwriteConfirmationCloseListener'
                );
                resolve(false);
            });

            this.viewManager.showModal(dialog);
        });
    }

    /**
     * Show results summary dialog.
     * @param {object} results Results object.
     * @returns {Promise<void>}
     * @private
     */
    async _showResultsSummary(results: RestoreResults): Promise<void> {
        const messages: string[] = [];

        if (results.imported?.length > 0) {
            messages.push(
                `✓ Imported ${results.imported.length} item(s):\n  ${results.imported.join(', ')}`
            );
        }
        if ('overwritten' in results && results.overwritten?.length > 0) {
            messages.push(`✓ Overwritten ${results.overwritten.length} item(s):\n  ${results.overwritten.join(', ')}`);
        }
        if ('skipped' in results && results.skipped?.length > 0) {
            messages.push(`○ Skipped ${results.skipped.length} item(s):\n  ${results.skipped.join(', ')}`);
        }
        if (results.errors?.length > 0) {
            messages.push(`✗ Failed ${results.errors.length} item(s):`);
            results.errors.forEach((err: RestoreErrorItem) => {
                messages.push(`  • ${err.title}: ${err.error}`);
            });
        }

        return new Promise((resolve) => {
            const dialog = new TextDialogView({
                title: 'Restore Complete',
                message: messages.join('\n\n'),
                confirmLabel: 'OK',
                showCancel: false,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('close', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.resultsSummaryCloseListener'
                );
                resolve();
            });

            this.viewManager.showModal(dialog);
        });
    }

    /**
     * Show error dialog.
     * @param {string} title Error title.
     * @param {string} message Error message.
     * @returns {Promise<void>}
     * @private
     */
    async _showError(title: string, message: string): Promise<void> {
        return new Promise((resolve) => {
            const dialog = new ErrorDialogView({
                title,
                message,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('close', (event: unknown) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
                        { name: 'id', validate: (value: unknown) => typeof value === 'string' },
                    ],
                    'DBRestoreDialogView.errorDialogCloseListener'
                );
                resolve();
            });

            this.viewManager.showModal(dialog);
        });
    }
}
