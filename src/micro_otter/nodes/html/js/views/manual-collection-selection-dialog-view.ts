import { ModalDialogView } from './modal-dialog-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { TextDialogView } from './text-dialog-view.js';
import { ErrorDialogView } from './error-dialog-view.js';
import { Collection } from '../data/collection.js';
import { assertAppEventPayloadType } from '../core/app-event.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

type CollectionStatus = 'new' | 'newer' | 'older' | 'conflict';
type ModalDialogPayloadTypeId =
    | 'ModalDialogView.Confirm.v1'
    | 'ModalDialogView.Cancel.v1'
    | 'ModalDialogView.Close.v1';

export interface ManualCollectionSelectionDialogOptions {
    items: CollectionAnalysisItem[];
    backupData: BackupData;
    workspace: WorkspaceCollectionStore;
    viewManager: ViewManagerLike;
    title?: string;
    icon?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    id?: string | null;
    i18nService?: I18nServiceLike;
    logger?: LoggerLike;
}

export interface CollectionAnalysisItem {
    kind?: 'collection' | 'targetConfig';
    id: string;
    title: string;
    backupVersion: string;
    localVersion?: string | null;
    status: CollectionStatus;
}

export interface CheckedCollectionItem {
    kind?: 'collection' | 'targetConfig';
    id?: string;
    title?: string;
    status?: string;
    selectionKey?: string;
}

export interface ManualRestoreError {
    title?: string;
    error: unknown;
}

export interface ManualRestoreResults {
    imported: string[];
    overwritten: string[];
    errors: ManualRestoreError[];
}

export interface ManualRestoreConfirmPayload {
    confirmed: boolean;
    results?: ManualRestoreResults;
    error?: unknown;
}

export interface BackupData {
    collections: BackupCollectionData[];
    targetConfigs?: {
        items?: Array<Record<string, unknown>>;
    };
    [key: string]: unknown;
}

export interface BackupCollectionData extends Record<string, unknown> {
    id?: unknown;
}

export interface WorkspaceCollectionStore {
    deleteCollection: (collectionId: string | null | undefined) => Promise<unknown> | unknown;
    saveCollection: (collection: Collection) => Promise<unknown> | unknown;
    deleteUserTargetConfig?: (targetId: string | null | undefined) => Promise<unknown> | unknown;
    saveUserTargetConfig?: (targetConfig: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ViewManagerLike {
    showModal: (content: unknown, options?: { scrim?: boolean }) => unknown;
}

export interface ModalDialogEventPayload {
    payloadTypeId: ModalDialogPayloadTypeId;
    reason: string;
    id: string;
    [key: string]: unknown;
}

export interface ModalDialogEvent {
    detail: ModalDialogEventPayload;
    [key: string]: unknown;
}

function messageFromUnknownLikeJs(error: unknown): unknown {
    if (error === null || error === undefined) {
        return undefined;
    }

    if (typeof error === 'object' || typeof error === 'function') {
        return Reflect.get(error, 'message');
    }

    return undefined;
}

function assertModalDialogEvent(
    event: unknown,
    payloadTypeId: ModalDialogPayloadTypeId,
    context: string,
): ModalDialogEvent {
    assertAppEventPayloadType(
        event,
        payloadTypeId,
        [
            { name: 'reason', validate: (value: unknown) => typeof value === 'string' },
            { name: 'id', validate: (value: unknown) => typeof value === 'string' },
        ],
        context,
    );

    return event as ModalDialogEvent;
}

export class ManualCollectionSelectionDialogView extends ModalDialogView {
    items: CollectionAnalysisItem[];
    backupData: BackupData;
    workspace: WorkspaceCollectionStore;
    viewManager: ViewManagerLike;

    private _manualSelections: Map<string, boolean>;
    private _tableBody: HTMLDivElement | null;

    constructor({
        items,
        backupData,
        workspace,
        viewManager,
        title = 'Select Collections to Restore',
        icon = '📋',
        confirmLabel = 'Restore Selected',
        cancelLabel = 'Cancel',
        id = null,
        i18nService = null,
        logger = null,
    }: ManualCollectionSelectionDialogOptions = {} as ManualCollectionSelectionDialogOptions) {
        super({
            title,
            icon,
            confirmLabel,
            cancelLabel,
            id,
            i18nService,
            logger,
        });

        this.items = items;
        this.backupData = backupData;
        this.workspace = workspace;
        this.viewManager = viewManager;
        this._manualSelections = new Map<string, boolean>();
        this._tableBody = null;

        for (const item of items) {
            this._manualSelections.set(
                this._selectionKeyForItem(item),
                item.status === 'new' || item.status === 'newer'
            );
        }
    }

    private _selectionKeyForItem(item: { kind?: string; id?: string }): string {
        const kind = item.kind === 'targetConfig' ? 'targetConfig' : 'collection';
        const itemId = item.id || '';
        return kind === 'collection' ? itemId : `${kind}:${itemId}`;
    }

    private _kindLabel(item: CollectionAnalysisItem): string {
        return item.kind === 'targetConfig' ? 'Target Config' : 'Collection';
    }

    override render(container: HTMLElement): void {
        super.render(container);
        const dialog = container.querySelector('.modal-dialog');
        if (dialog) {
            dialog.classList.add('manual-selection-dialog-root');
        }
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'manual-selection-dialog';

        const tableContainer = this._createManualTable();
        body.appendChild(tableContainer);

        return body;
    }

    private _createManualTable(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'manual-selection-dialog__table-container';

        const table = document.createElement('div');
        table.className = 'manual-selection-dialog__table';

        const header = document.createElement('div');
        header.className = 'manual-selection-dialog__table-row manual-selection-dialog__table-header';
        header.innerHTML = `
            <div></div>
            <div><strong>Type</strong></div>
            <div><strong>Name</strong></div>
            <div><strong>Backup</strong></div>
            <div><strong>Local</strong></div>
            <div><strong>Status</strong></div>
        `;
        table.appendChild(header);

        for (const item of this.items) {
            const row = this._createTableRow(item);
            table.appendChild(row);
        }

        container.appendChild(table);
        this._tableBody = table;

        return container;
    }

    private _createTableRow(item: CollectionAnalysisItem): HTMLElement {
        const row = document.createElement('div');
        row.className = 'manual-selection-dialog__table-row';
        const selectionKey = this._selectionKeyForItem(item);
        row.dataset.collectionId = item.id;
        row.dataset.selectionKey = selectionKey;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this._manualSelections.get(selectionKey) ?? false;
        checkbox.dataset.collectionId = item.id;
        checkbox.dataset.selectionKey = selectionKey;
        checkbox.dataset.collectionTitle = item.title;
        checkbox.dataset.status = item.status;
        checkbox.dataset.kind = item.kind || 'collection';

        checkbox.addEventListener('change', () => {
            this._manualSelections.set(selectionKey, checkbox.checked);
        });

        const checkboxCell = document.createElement('div');
        checkboxCell.appendChild(checkbox);

        const typeCell = document.createElement('div');
        typeCell.textContent = this._kindLabel(item);

        const nameCell = document.createElement('div');
        nameCell.textContent = item.title;

        const backupCell = document.createElement('div');
        backupCell.textContent = item.backupVersion;

        const localCell = document.createElement('div');
        localCell.textContent = item.localVersion || '—';

        const statusCell = document.createElement('div');
        statusCell.className = `db-restore-status db-restore-status--${item.status}`;

        const statusIcons: Record<CollectionStatus, string> = {
            new: '🆕',
            newer: '⬆️',
            older: '⬇️',
            conflict: '⚠️',
        };
        const statusLabels: Record<CollectionStatus, string> = {
            new: 'New',
            newer: 'Newer',
            older: 'Older',
            conflict: 'Conflict',
        };

        statusCell.innerHTML = `${statusIcons[item.status]} ${statusLabels[item.status]}`;

        row.appendChild(checkboxCell);
        row.appendChild(typeCell);
        row.appendChild(nameCell);
        row.appendChild(backupCell);
        row.appendChild(localCell);
        row.appendChild(statusCell);

        return row;
    }

    protected override _onConfirm(): Record<string, unknown> {
        void this._handleConfirmAsync();
        return {};
    }

    private async _handleConfirmAsync(): Promise<ManualRestoreConfirmPayload> {
        try {
            const checkedItems = this._getCheckedTableItems();

            if (checkedItems.length === 0) {
                await this._showError(
                    'No Selection',
                    'No collections selected. Please select at least one collection to restore.',
                );
                return { confirmed: false };
            }

            const overwriteItems = checkedItems.filter((item) => item.status !== 'new');
            if (overwriteItems.length > 0) {
                const confirmed = await this._showOverwriteConfirmation(overwriteItems);
                if (!confirmed) {
                    return { confirmed: false };
                }
            }

            const results = await this._executeManualRestore(checkedItems);
            await this._showResultsSummary(results);

            return { confirmed: true, results };
        } catch (error) {
            const message = messageFromUnknownLikeJs(error);
            await this._showError('Restore Failed', message);
            return { confirmed: false, error: message };
        }
    }

    private async _executeManualRestore(checkedItems: CheckedCollectionItem[]): Promise<ManualRestoreResults> {
        const results: ManualRestoreResults = {
            imported: [],
            overwritten: [],
            errors: [],
        };

        for (const item of checkedItems) {
            try {
                if (item.kind === 'targetConfig') {
                    const backupTargetData = this.backupData.targetConfigs?.items?.find(
                        (targetConfig) => targetConfig.id === item.id
                    );

                    if (item.status !== 'new') {
                        await this.workspace.deleteUserTargetConfig?.(item.id);
                        const targetConfig = await this._importTargetConfig(backupTargetData);
                        results.overwritten.push(`Target: ${targetConfig.displayName || targetConfig.id}`);
                    } else {
                        const targetConfig = await this._importTargetConfig(backupTargetData);
                        results.imported.push(`Target: ${targetConfig.displayName || targetConfig.id}`);
                    }
                } else {
                    const backupData = this.backupData.collections.find(
                        (collection) => collection.id === item.id
                    );

                    if (item.status !== 'new') {
                        await this.workspace.deleteCollection(item.id);
                        const collection = await this._importCollection(backupData);
                        results.overwritten.push(collection.getTitle());
                    } else {
                        const collection = await this._importCollection(backupData);
                        results.imported.push(collection.getTitle());
                    }
                }
            } catch (error) {
                results.errors.push({
                    title: item.title,
                    error: messageFromUnknownLikeJs(error),
                });
            }
        }

        return results;
    }

    private _getCheckedTableItems(): CheckedCollectionItem[] {
        const checkboxes = this._tableBody!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map((checkbox) => ({
            kind: (checkbox.dataset.kind as 'collection' | 'targetConfig') || 'collection',
            id: checkbox.dataset.collectionId,
            title: checkbox.dataset.collectionTitle,
            status: checkbox.dataset.status,
            selectionKey: checkbox.dataset.selectionKey,
        }));
    }

    private async _importCollection(collectionData: unknown): Promise<Collection> {
        const collection = Collection.fromData(collectionData as Record<string, unknown>);
        await this.workspace.saveCollection(collection);
        return collection;
    }

    private async _importTargetConfig(targetConfigData: unknown): Promise<Record<string, unknown>> {
        if (!this.workspace.saveUserTargetConfig) {
            throw new Error('Workspace target config API unavailable');
        }
        return (await this.workspace.saveUserTargetConfig(
            targetConfigData as Record<string, unknown>
        )) as Record<string, unknown>;
    }

    private async _showOverwriteConfirmation(items: CheckedCollectionItem[]): Promise<boolean> {
        return new Promise((resolve) => {
            const list = items.map((item) => `• ${item.title}`).join('\n');
            const dialog = new ConfirmationDialogView({
                title: 'Confirm Overwrite',
                message: 'The following collections will be overwritten:',
                detail: `\n${list}\n\nContinue?`,
                confirmLabel: 'Overwrite',
                cancelLabel: 'Cancel',
                destructive: false,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('confirm', (event: unknown) => {
                assertModalDialogEvent(
                    event,
                    'ModalDialogView.Confirm.v1',
                    'ManualSelectionDialog.overwriteConfirmationConfirmListener',
                );
                resolve(true);
            });
            dialog.on('cancel', (event: unknown) => {
                assertModalDialogEvent(
                    event,
                    'ModalDialogView.Cancel.v1',
                    'ManualSelectionDialog.overwriteConfirmationCancelListener',
                );
                resolve(false);
            });
            dialog.on('close', (event: unknown) => {
                assertModalDialogEvent(
                    event,
                    'ModalDialogView.Close.v1',
                    'ManualSelectionDialog.overwriteConfirmationCloseListener',
                );
                resolve(false);
            });

            this.viewManager.showModal(dialog);
        });
    }

    private async _showResultsSummary(results: ManualRestoreResults): Promise<void> {
        const messages: string[] = [];

        if (results.imported?.length > 0) {
            messages.push(
                `✓ Imported ${results.imported.length} collection(s):\n  ${results.imported.join(', ')}`,
            );
        }
        if (results.overwritten?.length > 0) {
            messages.push(
                `✓ Overwritten ${results.overwritten.length} collection(s):\n  ${results.overwritten.join(', ')}`,
            );
        }
        if (results.errors?.length > 0) {
            messages.push(`✗ Failed ${results.errors.length} collection(s):`);
            results.errors.forEach((errorEntry) => {
                messages.push(`  • ${errorEntry.title}: ${errorEntry.error}`);
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
                assertModalDialogEvent(
                    event,
                    'ModalDialogView.Close.v1',
                    'ManualSelectionDialog.resultsSummaryCloseListener',
                );
                resolve();
            });

            this.viewManager.showModal(dialog);
        });
    }

    private async _showError(title: string, message: unknown): Promise<void> {
        return new Promise((resolve) => {
            const dialog = new ErrorDialogView({
                title,
                message: message as string,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            dialog.on('close', (event: unknown) => {
                assertModalDialogEvent(
                    event,
                    'ModalDialogView.Close.v1',
                    'ManualSelectionDialog.errorDialogCloseListener',
                );
                resolve();
            });

            this.viewManager.showModal(dialog);
        });
    }
}
