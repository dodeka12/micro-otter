import { ViewBase } from './view-base.js';
import { SplitView } from './split-view.js';
import { ToolbarView } from './toolbar-view.js';
import { CodeView } from './code-view.js';
import { IconProvider } from './icon-provider.js';
import { ErrorDialogView } from './error-dialog-view.js';
import { AppEvent, AppPayload, assertAppEventPayloadType } from '../core/app-event.js';
import { ProgressEvent, ProgressEventBus, ProgressEventType } from '../core/progress-events.js';
import {
    createTranspileDebugDumpPayload,
    isTranspileDebugChannelEnabled,
    sendTranspileDebugDump,
} from '../dev/transpile-debug-channel.js';

type Unsubscribe = (() => void) | null;
type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
type I18nServiceWithLocale = (I18nServiceLike & { currentLocale?: string }) | null;

interface CollectionLike {
    getId?: () => string;
    getTitle?: () => string;
    getVersionString?: () => string;
    on?: (eventName: string, listener: (event: AppEvent) => void) => Unsubscribe;
    onChange: (listener: (event: AppEvent) => void, namespace?: string) => Unsubscribe;
}

interface GeneratedCollectionArtifact {
    targetPath: string;
    content: string | Uint8Array;
    contentType?: string;
    contentEncoding?: 'identity' | 'gzip';
    role?: string;
}

interface TranspilerHelperGroupHandoff {
    mergedData: Record<string, unknown>;
    artifacts: GeneratedCollectionArtifact[];
    webserverSpecPatch: Record<string, unknown>;
}

interface TranspilerHelperHandoffV1 {
    schemaVersion: 'transpiler-helper-handoff/v1';
    helperGroups: Record<string, TranspilerHelperGroupHandoff>;
}

interface TranspileResult {
    code: string;
    assets?: Record<string, unknown>;
    generatedArtifacts?: GeneratedCollectionArtifact[];
    helperHandoff?: TranspilerHelperHandoffV1;
}

interface CollectionManagerLike {
    getActiveCollection: () => CollectionLike | null;
    transpileActiveCollection: () => Promise<TranspileResult>;
    on?: (eventName: string, listener: (event: AppEvent) => void) => Unsubscribe;
    onChange: (listener: (event: AppEvent) => void) => Unsubscribe;
}

interface TranspilerLike {
    clearCache: () => void;
    needsTranspile: (collection: CollectionLike) => boolean;
}

interface ViewManagerLike {
    showModal?: (view: unknown) => void;
}

interface ToolbarButtonControlLike {
    element: HTMLButtonElement | null;
}

interface ActiveCollectionChangedDetail extends AppPayload {
    collectionId: string | null;
}

interface CollectionVersionChangedDetail extends AppPayload {
    version?: string;
}

interface TranspilerViewOptions {
    collectionManager: CollectionManagerLike;
    runtimeCollection: unknown;
    transpiler: TranspilerLike;
    viewManager?: ViewManagerLike | null;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerLike | null;
    [key: string]: unknown;
}

interface ErrorDialogOptions {
    title: string;
    message: string;
    detail?: string | null;
}

interface TranspilerViewDeserializeData {
    [key: string]: unknown;
}

interface TranspilerViewDeserializeContext {
    collectionManager: CollectionManagerLike;
    runtimeCollection: unknown;
    transpiler: TranspilerLike;
    viewManager?: ViewManagerLike | null;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerLike | null;
}

interface SerializedTranspilerView extends ReturnType<ViewBase['serialize']> {
    type: 'TranspilerView';
}

export class TranspilerView extends ViewBase {
    #collectionManager: CollectionManagerLike;
    #runtimeCollection: unknown;
    #viewManager: ViewManagerLike | null;
    #transpiler: TranspilerLike;
    #activeCollectionId: string | null = null;

    #activeCollectionListener: ((event: AppEvent) => void) | null = null;
    #activeCollectionUnsubscribe: Unsubscribe = null;
    #collectionVersionListener: ((event: AppEvent) => void) | null = null;
    #collectionVersionUnsubscribe: Unsubscribe = null;
    #progressListener: ((event: ProgressEvent) => void) | null = null;

    #splitView: SplitView | null = null;
    #toolbarView: ToolbarView | null = null;
    #codeView: CodeView | null = null;
    #transpileButton: HTMLButtonElement | null = null;
    #copyButton: HTMLButtonElement | null = null;
    #clearButton: HTMLButtonElement | null = null;
    #dumpGeneratedButton: HTMLButtonElement | null = null;
    #isDebugDumpEnabled: boolean;
    #lastTranspileResult: TranspileResult | null = null;

    declare protected _i18nService: I18nServiceWithLocale;

    constructor({
        collectionManager,
        runtimeCollection,
        transpiler,
        viewManager = null,
        i18nService = null,
        logger = null,
        ...rest
    }: TranspilerViewOptions) {
        super({
            title: 'Transpiler',
            icon: 'codeGenerator',
            minWidth: 300,
            i18nService,
            logger,
            ...rest,
        });

        if (!collectionManager) {
            throw new Error('TranspilerView requires a collection manager');
        }
        if (!runtimeCollection) {
            throw new Error('TranspilerView requires a runtime collection');
        }
        if (!transpiler) {
            throw new Error('TranspilerView requires a transpiler instance');
        }

        this.#collectionManager = collectionManager;
        this.#runtimeCollection = runtimeCollection;
        this.#viewManager = viewManager;
        this.#transpiler = transpiler;
        this.#isDebugDumpEnabled = isTranspileDebugChannelEnabled();
    }

    override render(container: HTMLElement): void {
        this._log('render', 'debug');

        if (!this.#toolbarView) {
            this.#toolbarView = new ToolbarView({
                title: 'Transpiler Controls',
                minHeight: 60,
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this.#codeView) {
            this.#codeView = new CodeView({
                code: '',
                language: 'python',
                scrollable: true,
                title: 'Generated Code',
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this.#splitView) {
            this.#splitView = new SplitView({
                orientation: 'vertical',
                ratio: 0.12,
                views: [this.#toolbarView, this.#codeView],
                i18nService: this._i18nService,
                logger: this._logger,
            } as unknown as ConstructorParameters<typeof SplitView>[0]);
        }

        this.#splitView.attachTo(container);

        if (!this.#transpileButton) {
            this.#createButtons();
        }

        this._log('render-complete', 'debug');
    }

    #createButtons(): void {
        if (!this.#toolbarView) {
            return;
        }

        const transpileControl = this.#toolbarView.addButton({
            icon: IconProvider.codeGenerator,
            label: this.t('transpiler.buttons.transpile'),
            onClick: () => {
                void this._onTranspile();
            },
            className: 'transpile-btn',
        }) as ToolbarButtonControlLike;

        const copyControl = this.#toolbarView.addButton({
            icon: IconProvider.contentCopy,
            label: this.t('transpiler.buttons.copy'),
            onClick: () => {
                void this._onCopy();
            },
            className: 'copy-btn',
        }) as ToolbarButtonControlLike;

        const clearControl = this.#toolbarView.addButton({
            icon: IconProvider.delete,
            label: this.t('transpiler.buttons.clear'),
            onClick: () => this._onClear(),
            className: 'clear-btn',
        }) as ToolbarButtonControlLike;

        let dumpControl: ToolbarButtonControlLike | null = null;
        if (this.#isDebugDumpEnabled) {
            dumpControl = this.#toolbarView.addButton({
                icon: IconProvider.fileSave,
                label: this.t('transpiler.buttons.dumpGenerated'),
                onClick: () => {
                    void this._onDumpGenerated();
                },
                className: 'dump-generated-btn',
            }) as ToolbarButtonControlLike;
        }

        this.#toolbarView.renderControls();

        this.#transpileButton = transpileControl.element;
        this.#copyButton = copyControl.element;
        this.#clearButton = clearControl.element;
        this.#dumpGeneratedButton = dumpControl?.element || null;
        if (this.#dumpGeneratedButton) {
            this.#dumpGeneratedButton.disabled = true;
        }
    }

    async _onTranspile(): Promise<void> {
        const collection = this.#collectionManager.getActiveCollection();
        if (!collection) {
            this._log('transpile-no-collection', 'warn');
            return;
        }

        const transpileButton = this.#transpileButton;
        const copyButton = this.#copyButton;
        const clearButton = this.#clearButton;
        const toolbarView = this.#toolbarView;

        if (!transpileButton || !copyButton || !clearButton || !toolbarView || !this.#codeView) {
            return;
        }

        try {
            transpileButton.disabled = true;
            copyButton.disabled = true;
            clearButton.disabled = true;
            toolbarView.showProgress(0);

            this._log('transpile-start', { collectionId: collection.getId?.() });

            const result = await this.#collectionManager.transpileActiveCollection();

            this.#codeView.setCode(result.code);
            this.#lastTranspileResult = result;

            this._log('transpile-success', {
                collectionId: collection.getId?.(),
                codeLength: result.code.length,
            });

            this._updateTranspileNeededState();
        } catch (error: unknown) {
            const errorLike = error as { message?: string; stack?: string };
            await this.#showErrorDialog({
                title: this.t('transpiler.errors.title'),
                message: errorLike?.message || 'Unknown error',
                detail: errorLike?.stack,
            });

            this._log('transpile-error', 'error', error);
        } finally {
            transpileButton.disabled = false;
            copyButton.disabled = false;
            clearButton.disabled = false;
            toolbarView.showProgress(null);
        }
    }

    async _onCopy(): Promise<void> {
        if (!this.#codeView) {
            return;
        }

        const code = this.#codeView.getCode();
        if (!code) {
            this._log('copy-nothing', 'warn');
            return;
        }

        try {
            await navigator.clipboard.writeText(code);
            this._log('copy-success', { length: code.length });
        } catch (error: unknown) {
            const errorLike = error as { stack?: string };
            this._log('copy-error', 'error', error);
            await this.#showErrorDialog({
                title: this.t('transpiler.errors.title'),
                message: this.t('transpiler.clipboard.copyFailed'),
                detail: errorLike?.stack,
            });
        }
    }

    _onClear(): void {
        if (!this.#codeView) {
            return;
        }

        this.#codeView.setCode('');
        this.#lastTranspileResult = null;

        this.#transpiler.clearCache();
        this._log('clear-cache');

        this._updateTranspileNeededState();

        this._log('clear-code');
    }

    async _onDumpGenerated(): Promise<void> {
        if (!this.#dumpGeneratedButton || !this.#isDebugDumpEnabled) {
            return;
        }

        const collection = this.#collectionManager.getActiveCollection();
        if (!collection || !this.#lastTranspileResult) {
            await this.#showErrorDialog({
                title: this.t('transpiler.errors.title'),
                message: this.t('transpiler.debug.dumpUnavailable'),
            });
            return;
        }

        const dumpButton = this.#dumpGeneratedButton;
        const transpileButton = this.#transpileButton;
        const copyButton = this.#copyButton;
        const clearButton = this.#clearButton;

        try {
            dumpButton.disabled = true;
            if (transpileButton) transpileButton.disabled = true;
            if (copyButton) copyButton.disabled = true;
            if (clearButton) clearButton.disabled = true;

            const payload = createTranspileDebugDumpPayload(collection, this.#lastTranspileResult);
            const response = await sendTranspileDebugDump(payload);

            this._log('debug-dump-success', {
                collectionId: collection.getId?.(),
                dumpId: response?.dumpId,
                dumpDirectory: response?.dumpDirectory,
                filesWritten: response?.filesWritten,
            });
        } catch (error: unknown) {
            const errorLike = error as { message?: string; stack?: string };
            await this.#showErrorDialog({
                title: this.t('transpiler.errors.title'),
                message: this.t('transpiler.debug.dumpFailed'),
                detail: errorLike?.stack || errorLike?.message,
            });

            this._log('debug-dump-error', 'error', error);
        } finally {
            if (transpileButton) transpileButton.disabled = false;
            if (copyButton) copyButton.disabled = false;
            if (clearButton) clearButton.disabled = false;
            this._updateTranspileNeededState();
        }
    }

    override afterAttach(): void {
        super.afterAttach();

        this._log('after-attach', 'info');

        this._subscribeToLanguageChanges(() => {
            this._updateButtonLabels();
        });

        this._updateButtonLabels();

        this.#activeCollectionListener = (event: AppEvent) => {
            if (!event) {
                return;
            }

            if (event.name !== 'activeCollectionChanged') {
                if (
                    event.name === 'collectionAdded' ||
                    event.name === 'collectionUpdated' ||
                    event.name === 'collectionRemoved'
                ) {
                    const expectedPayloadTypeId =
                        event.name === 'collectionAdded'
                            ? 'CollectionManager.CollectionAdded.v1'
                            : event.name === 'collectionUpdated'
                              ? 'CollectionManager.CollectionUpdated.v1'
                              : 'CollectionManager.CollectionRemoved.v1';
                    assertAppEventPayloadType(
                        event,
                        expectedPayloadTypeId,
                        'TranspilerView collection manager listener'
                    );
                    this._updateTranspileNeededState();
                }
                return;
            }

            const validated = assertAppEventPayloadType(
                event,
                'CollectionManager.ActiveCollectionChanged.v1',
                'TranspilerView collection manager listener'
            ) as AppEvent<ActiveCollectionChangedDetail>;

            const newCollectionId = validated.detail?.collectionId || null;

            if (this.#collectionVersionUnsubscribe) {
                this.#collectionVersionUnsubscribe();
                this.#collectionVersionUnsubscribe = null;
            }

            this.#activeCollectionId = newCollectionId;
            this.#lastTranspileResult = null;

            const activeCollection = this.#collectionManager.getActiveCollection();
            if (activeCollection) {
                this.#collectionVersionUnsubscribe =
                    typeof activeCollection.on === 'function'
                        ? activeCollection.on('*', this.#collectionVersionListener as (event: AppEvent) => void)
                        : activeCollection.onChange(this.#collectionVersionListener as (event: AppEvent) => void, 'transpiler-view');
                this._log('subscribed-to-version-events', { collectionId: newCollectionId });
            }

            this._updateTranspileNeededState();

            this._log('active-collection-changed', { collectionId: newCollectionId });
        };

        this.#activeCollectionUnsubscribe =
            typeof this.#collectionManager.on === 'function'
                ? this.#collectionManager.on('*', this.#activeCollectionListener)
                : this.#collectionManager.onChange(this.#activeCollectionListener);

        this.#collectionVersionListener = (event: AppEvent) => {
            if (event?.name !== 'version') {
                return;
            }
            const validated = assertAppEventPayloadType(
                event,
                'Collection.VersionChanged.v1',
                'TranspilerView collection version listener'
            ) as AppEvent<CollectionVersionChangedDetail>;
            this._log('collection-version-changed', { version: validated.detail?.version });
            this._updateTranspileNeededState();
        };

        const activeCollection = this.#collectionManager.getActiveCollection();
        if (activeCollection) {
            this.#activeCollectionId = activeCollection.getId?.() ?? null;
            this.#collectionVersionUnsubscribe =
                typeof activeCollection.on === 'function'
                    ? activeCollection.on('*', this.#collectionVersionListener)
                    : activeCollection.onChange(this.#collectionVersionListener, 'transpiler-view');
            this._log('initial-version-subscription', { collectionId: this.#activeCollectionId });
        }

        this._updateTranspileNeededState();

        this.#progressListener = (event: ProgressEvent) => {
            if (event.source !== 'transpiler') {
                return;
            }

            if (event.type === ProgressEventType.UPDATE) {
                if (event.progress !== undefined) {
                    this.#toolbarView?.showProgress(event.progress);
                    this._log('transpile-progress', {
                        progress: event.progress,
                        message: event.message,
                        detail: event.detail || null,
                    });
                }
            } else if (
                event.type === ProgressEventType.COMPLETE ||
                event.type === ProgressEventType.ERROR
            ) {
                this._log('transpile-progress-complete', {
                    type: event.type,
                    message: event.message,
                    detail: event.detail || null,
                });
            }
        };

        ProgressEventBus.subscribe(this.#progressListener);
        this._log('subscribed-to-progress-events');
    }

    override beforeDetach(): void {
        if (this.#activeCollectionUnsubscribe) {
            this.#activeCollectionUnsubscribe();
            this.#activeCollectionUnsubscribe = null;
        }
        this.#activeCollectionListener = null;

        if (this.#collectionVersionUnsubscribe) {
            this.#collectionVersionUnsubscribe();
            this.#collectionVersionUnsubscribe = null;
        }
        this.#collectionVersionListener = null;

        if (this.#progressListener) {
            ProgressEventBus.unsubscribe(this.#progressListener);
            this.#progressListener = null;
        }

        super.beforeDetach();
    }

    _updateButtonLabels(): void {
        if (!this.#transpileButton || !this.#copyButton || !this.#clearButton) {
            return;
        }

        const transpileLabel = this.t('transpiler.buttons.transpile');
        this.#transpileButton.setAttribute('aria-label', transpileLabel);
        this.#transpileButton.title = transpileLabel;

        const copyLabel = this.t('transpiler.buttons.copy');
        this.#copyButton.setAttribute('aria-label', copyLabel);
        this.#copyButton.title = copyLabel;

        const clearLabel = this.t('transpiler.buttons.clear');
        this.#clearButton.setAttribute('aria-label', clearLabel);
        this.#clearButton.title = clearLabel;

        if (this.#dumpGeneratedButton) {
            const dumpLabel = this.t('transpiler.buttons.dumpGenerated');
            this.#dumpGeneratedButton.setAttribute('aria-label', dumpLabel);
            this.#dumpGeneratedButton.title = dumpLabel;
        }

        this._log('labels-updated', { locale: this._i18nService?.currentLocale });
    }

    _updateTranspileNeededState(): void {
        if (!this.#transpileButton) {
            return;
        }

        const collection = this.#collectionManager.getActiveCollection();

        if (!collection) {
            this.#transpileButton.disabled = true;
            this.#transpileButton.classList.remove('transpile-needed');
            if (this.#dumpGeneratedButton) {
                this.#dumpGeneratedButton.disabled = true;
            }
            this._log('no-active-collection');
            return;
        }

        const needsTranspile = this.#transpiler.needsTranspile(collection);

        if (needsTranspile) {
            this.#transpileButton.classList.add('transpile-needed');
        } else {
            this.#transpileButton.classList.remove('transpile-needed');
        }

        this.#transpileButton.disabled = false;

        if (this.#dumpGeneratedButton) {
            this.#dumpGeneratedButton.disabled =
                this.#lastTranspileResult === null || needsTranspile;
        }
    }

    async #showErrorDialog({ title, message, detail = null }: ErrorDialogOptions): Promise<void> {
        const showModal = this.#viewManager?.showModal;
        if (typeof showModal !== 'function') {
            this._log('error-dialog-no-view-manager', 'warn', { title, message });
            return;
        }

        const dialog = new ErrorDialogView({
            title,
            message,
            detail,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        showModal.call(this.#viewManager, dialog);
    }

    override serialize(): SerializedTranspilerView {
        return {
            ...super.serialize(),
            type: 'TranspilerView',
        } as SerializedTranspilerView;
    }

    static deserialize(
        data: TranspilerViewDeserializeData,
        createChild: (data: unknown, context: unknown) => unknown,
        context: TranspilerViewDeserializeContext
    ): TranspilerView {
        void data;
        void createChild;

        return new TranspilerView({
            collectionManager: context.collectionManager,
            runtimeCollection: context.runtimeCollection,
            transpiler: context.transpiler,
            viewManager: context.viewManager,
            i18nService: context.i18nService,
            logger: context.logger,
        });
    }
}
