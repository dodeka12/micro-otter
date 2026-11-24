import { ViewBase } from './view-base.js';
import { TextControl, DropdownControl } from './controls/custom-runtime-controls.js';
import { assertAppEventPayloadType } from '../core/app-event.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

interface RuntimeTargetOption {
    id: string;
    name: string;
}

interface AppEventLike<TDetail = unknown> {
    name?: string;
    detail?: TDetail;
}

interface CollectionManagerActiveCollectionChangedPayload {
    payloadTypeId: 'CollectionManager.ActiveCollectionChanged.v1';
    collectionId: string | null;
}

interface CollectionTitleChangedPayload {
    payloadTypeId: 'Collection.TitleChanged.v1';
    collectionId: string;
    title: string;
}

interface CollectionTargetIdChangedPayload {
    payloadTypeId: 'Collection.TargetIdChanged.v1';
    collectionId: string;
    targetId: string | null;
}

interface CollectionVersionChangedPayload {
    payloadTypeId: 'Collection.VersionChanged.v1';
    collectionId: string;
    version: string;
}

interface CollectionWebAssetGenerationModeChangedPayload {
    payloadTypeId: 'Collection.WebAssetGenerationModeChanged.v1';
    collectionId: string;
    webAssetGenerationMode: 'compressed' | 'plain';
}

interface CollectionLike {
    getTitle: () => string;
    getVersionString: () => string;
    getDeviceRuntimeId: () => string;
    getTargetId: () => string | null;
    getWebAssetGenerationMode: () => 'compressed' | 'plain';
    setTitle: (title: string) => void;
    setDeviceRuntimeId: (runtimeId: string | null) => void;
    setTargetId: (targetId: string | null) => void;
    setWebAssetGenerationMode: (mode: 'compressed' | 'plain' | string | null) => void;
    on: (eventName: string, listener: (event: AppEventLike) => void) => () => void;
}

interface CollectionManagerLike {
    getActiveCollection: () => CollectionLike | null;
    listAvailableRuntimes: () => RuntimeTargetOption[];
    listTargetsForRuntime: (runtimeId: string) => RuntimeTargetOption[];
    on: (eventName: string, listener: (event: AppEventLike) => void) => () => void;
}

interface TextControlLike {
    render: (container: HTMLElement) => void;
}

interface DropdownControlLike {
    render: (container: HTMLElement) => void;
}

interface CollectionSettingsViewOptions {
    collectionManager: CollectionManagerLike;
    collection?: CollectionLike | null;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    title?: string | null;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    showTitle?: boolean;
}

interface CollectionSettingsSerializedData extends Record<string, unknown> {
    title?: string | null;
    icon?: string | null;
    id?: string | null;
}

interface CollectionSettingsDeserializeContext {
    collectionManager?: CollectionManagerLike | null;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

export class CollectionSettingsView extends ViewBase {
    private _collectionManager: CollectionManagerLike;
    private _collection: CollectionLike | null;
    private _showTitle: boolean;

    private _nameInput: HTMLInputElement | null;
    private _runtimeSelect: HTMLSelectElement | null;
    private _targetSelect: HTMLSelectElement | null;
    private _webAssetModeSelect: HTMLSelectElement | null;
    private _nameControl: TextControlLike | null;
    private _runtimeControl: DropdownControlLike | null;
    private _targetControl: DropdownControlLike | null;
    private _webAssetModeControl: DropdownControlLike | null;
    private _versionValue: HTMLDivElement | null;
    private _titleElement: HTMLHeadingElement | null;
    private _nameLabel: HTMLLabelElement | null;
    private _runtimeLabel: HTMLLabelElement | null;
    private _targetLabel: HTMLLabelElement | null;
    private _webAssetModeLabel: HTMLLabelElement | null;
    private _versionLabel: HTMLDivElement | null;
    private _unsubscribeCollection: (() => void) | null;
    private _unsubscribeCollectionManager: (() => void) | null;

    constructor(
        {
            collectionManager,
            collection = null,
            i18nService = null,
            title = null,
            icon = 'settings',
            id = null,
            logger = null,
            showTitle = true,
        }: CollectionSettingsViewOptions = {} as CollectionSettingsViewOptions
    ) {
        if (!collectionManager) {
            throw new Error('CollectionSettingsView requires a collectionManager instance');
        }

        super({
            title: title || 'Collection Settings',
            icon,
            id,
            logger,
            i18nService,
        });

        this._collectionManager = collectionManager;
        this._collection = collection || this._collectionManager.getActiveCollection() || null;
        this._showTitle = Boolean(showTitle);
        this._nameInput = null;
        this._runtimeSelect = null;
        this._targetSelect = null;
        this._webAssetModeSelect = null;
        this._nameControl = null;
        this._runtimeControl = null;
        this._targetControl = null;
        this._webAssetModeControl = null;
        this._versionValue = null;
        this._titleElement = null;
        this._nameLabel = null;
        this._runtimeLabel = null;
        this._targetLabel = null;
        this._webAssetModeLabel = null;
        this._versionLabel = null;
        this._unsubscribeCollection = null;
        this._unsubscribeCollectionManager = null;
    }

    override render(_container: HTMLElement): void {
        const root = document.createElement('section');
        root.className = 'view-collection-settings';

        if (this._showTitle) {
            this._titleElement = document.createElement('h3');
            this._titleElement.className = 'view-collection-settings__title';
            root.appendChild(this._titleElement);
        }

        const controls = document.createElement('div');
        controls.className = 'view-collection-settings__controls';

        const nameGroup = document.createElement('div');
        nameGroup.className = 'view-collection-settings__group';
        this._nameControl = new TextControl({
            label: this.t('settings.collection.name.label'),
            defaultValue: '',
        }) as TextControlLike;
        this._nameControl.render(nameGroup);
        this._nameLabel = nameGroup.querySelector('.custom-control__label');
        this._nameLabel?.classList.add('view-collection-settings__label');
        this._nameInput = nameGroup.querySelector('input[type="text"]');
        if (this._nameInput) {
            this._nameInput.classList.add('view-collection-settings__input');
            this._nameInput.id = `${this.id}-collection-name`;
        }
        this._nameLabel?.setAttribute('for', `${this.id}-collection-name`);

        const runtimeGroup = document.createElement('div');
        runtimeGroup.className = 'view-collection-settings__group';
        this._runtimeControl = new DropdownControl({
            label: this.t('settings.collection.runtime.label'),
            options: [],
            defaultValue: '',
        }) as DropdownControlLike;
        this._runtimeControl.render(runtimeGroup);
        this._runtimeLabel = runtimeGroup.querySelector('.custom-control__label');
        this._runtimeLabel?.classList.add('view-collection-settings__label');
        this._runtimeSelect = runtimeGroup.querySelector('select');
        if (this._runtimeSelect) {
            this._runtimeSelect.classList.add('view-collection-settings__select');
            this._runtimeSelect.id = `${this.id}-collection-runtime`;
        }
        this._runtimeLabel?.setAttribute('for', `${this.id}-collection-runtime`);

        const targetGroup = document.createElement('div');
        targetGroup.className = 'view-collection-settings__group';
        this._targetControl = new DropdownControl({
            label: this.t('settings.collection.target.label'),
            options: [],
            defaultValue: '',
        }) as DropdownControlLike;
        this._targetControl.render(targetGroup);
        this._targetLabel = targetGroup.querySelector('.custom-control__label');
        this._targetLabel?.classList.add('view-collection-settings__label');
        this._targetSelect = targetGroup.querySelector('select');
        if (this._targetSelect) {
            this._targetSelect.classList.add('view-collection-settings__select');
            this._targetSelect.id = `${this.id}-collection-target`;
        }
        this._targetLabel?.setAttribute('for', `${this.id}-collection-target`);

        const webAssetModeGroup = document.createElement('div');
        webAssetModeGroup.className = 'view-collection-settings__group';
        this._webAssetModeControl = new DropdownControl({
            label: this.t('settings.collection.webAssetGenerationMode.label'),
            options: [],
            defaultValue: 'compressed',
        }) as DropdownControlLike;
        this._webAssetModeControl.render(webAssetModeGroup);
        this._webAssetModeLabel = webAssetModeGroup.querySelector('.custom-control__label');
        this._webAssetModeLabel?.classList.add('view-collection-settings__label');
        this._webAssetModeSelect = webAssetModeGroup.querySelector('select');
        if (this._webAssetModeSelect) {
            this._webAssetModeSelect.classList.add('view-collection-settings__select');
            this._webAssetModeSelect.id = `${this.id}-collection-web-asset-mode`;
        }
        this._webAssetModeLabel?.setAttribute('for', `${this.id}-collection-web-asset-mode`);

        const versionGroup = document.createElement('div');
        versionGroup.className =
            'view-collection-settings__group view-collection-settings__group--readonly';
        this._versionLabel = document.createElement('div');
        this._versionLabel.className = 'view-collection-settings__label';
        this._versionValue = document.createElement('div');
        this._versionValue.className = 'view-collection-settings__readonly';
        versionGroup.appendChild(this._versionLabel);
        versionGroup.appendChild(this._versionValue);

        controls.appendChild(nameGroup);
        controls.appendChild(runtimeGroup);
        controls.appendChild(targetGroup);
        controls.appendChild(webAssetModeGroup);
        controls.appendChild(versionGroup);

        root.appendChild(controls);
        this.mountContent(root);

        this._bindControlEvents();
        this._applyLocalizedText();
        this._refreshAllControls();
    }

    override afterAttach(): void {
        super.afterAttach();

        this._subscribeCollection();
        this._unsubscribeCollectionManager = this._collectionManager.on(
            '*',
            (event: AppEventLike) => {
                if (event?.name !== 'activeCollectionChanged') {
                    return;
                }
                assertAppEventPayloadType(
                    event,
                    'CollectionManager.ActiveCollectionChanged.v1',
                    'CollectionSettingsView collection manager listener'
                );
                const activeCollectionChangedEvent =
                    event as AppEventLike<CollectionManagerActiveCollectionChangedPayload>;
                void activeCollectionChangedEvent.detail?.collectionId;
                this.setCollection(this._collectionManager.getActiveCollection());
            }
        );

        this._subscribeToLanguageChanges(() => {
            this._applyLocalizedText();
            this._refreshAllControls();
        });
    }

    override beforeDetach(): void {
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;
        this._unsubscribeCollectionManager?.();
        this._unsubscribeCollectionManager = null;
        super.beforeDetach();
    }

    setCollection(collection: CollectionLike | null): void {
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;
        this._collection = collection || null;
        this._subscribeCollection();
        this._refreshAllControls();
    }

    private _subscribeCollection(): void {
        if (!this._collection || typeof this._collection.on !== 'function') {
            return;
        }
        this._unsubscribeCollection = this._collection.on('*', (event: AppEventLike) => {
            if (!event?.name) {
                return;
            }
            if (event.name === 'title') {
                assertAppEventPayloadType(
                    event,
                    'Collection.TitleChanged.v1',
                    'CollectionSettingsView collection listener'
                );
                const titleChangedEvent = event as AppEventLike<CollectionTitleChangedPayload>;
                void titleChangedEvent.detail?.title;
                this._refreshAllControls();
                return;
            }

            if (event.name === 'targetId') {
                assertAppEventPayloadType(
                    event,
                    'Collection.TargetIdChanged.v1',
                    'CollectionSettingsView collection listener'
                );
                const targetChangedEvent = event as AppEventLike<CollectionTargetIdChangedPayload>;
                void targetChangedEvent.detail?.targetId;
                this._refreshAllControls();
                return;
            }

            if (event.name === 'version') {
                assertAppEventPayloadType(
                    event,
                    'Collection.VersionChanged.v1',
                    'CollectionSettingsView collection listener'
                );
                const versionChangedEvent = event as AppEventLike<CollectionVersionChangedPayload>;
                void versionChangedEvent.detail?.version;
                this._refreshAllControls();
                return;
            }

            if (event.name === 'webAssetGenerationMode') {
                assertAppEventPayloadType(
                    event,
                    'Collection.WebAssetGenerationModeChanged.v1',
                    'CollectionSettingsView collection listener'
                );
                const modeChangedEvent =
                    event as AppEventLike<CollectionWebAssetGenerationModeChangedPayload>;
                void modeChangedEvent.detail?.webAssetGenerationMode;
                this._refreshAllControls();
            }
        });
    }

    private _bindControlEvents(): void {
        if (this._nameInput) {
            this._nameInput.addEventListener('change', () => {
                this._handleCollectionNameCommit();
            });
            this._nameInput.addEventListener('blur', () => {
                this._handleCollectionNameCommit();
            });
        }

        if (this._runtimeSelect) {
            this._runtimeSelect.addEventListener('change', (event: Event) => {
                this._handleRuntimeChanged((event.target as HTMLSelectElement).value);
            });
        }

        if (this._targetSelect) {
            this._targetSelect.addEventListener('change', (event: Event) => {
                this._handleTargetChanged((event.target as HTMLSelectElement).value);
            });
        }

        if (this._webAssetModeSelect) {
            this._webAssetModeSelect.addEventListener('change', (event: Event) => {
                this._handleWebAssetGenerationModeChanged(
                    (event.target as HTMLSelectElement).value
                );
            });
        }
    }

    private _applyLocalizedText(): void {
        if (this._titleElement) {
            this._titleElement.textContent = this.t('settings.collection.title');
        }
        if (this._nameLabel) {
            this._nameLabel.textContent = this.t('settings.collection.name.label');
        }
        if (this._runtimeLabel) {
            this._runtimeLabel.textContent = this.t('settings.collection.runtime.label');
        }
        if (this._targetLabel) {
            this._targetLabel.textContent = this.t('settings.collection.target.label');
        }
        if (this._webAssetModeLabel) {
            this._webAssetModeLabel.textContent = this.t(
                'settings.collection.webAssetGenerationMode.label'
            );
        }
        if (this._versionLabel) {
            this._versionLabel.textContent = this.t('settings.collection.version.label');
        }
    }

    private _refreshAllControls(): void {
        if (
            !this._nameInput ||
            !this._runtimeSelect ||
            !this._targetSelect ||
            !this._webAssetModeSelect ||
            !this._versionValue
        ) {
            return;
        }

        const collection = this._collection;
        const hasCollection = !!collection;

        this._nameInput.disabled = !hasCollection;
        this._runtimeSelect.disabled = !hasCollection;
        this._targetSelect.disabled = !hasCollection;
        this._webAssetModeSelect.disabled = !hasCollection;

        if (!collection) {
            this._nameInput.value = '';
            this._runtimeSelect.replaceChildren();
            this._targetSelect.replaceChildren();
            this._webAssetModeSelect.replaceChildren();
            this._versionValue.textContent = '—';
            return;
        }

        this._nameInput.value = collection.getTitle();
        this._versionValue.textContent = collection.getVersionString();

        this._refreshRuntimeOptions();
        this._refreshTargetOptions(collection.getDeviceRuntimeId());
        this._refreshWebAssetGenerationModeOptions(collection.getWebAssetGenerationMode());
    }

    private _refreshWebAssetGenerationModeOptions(currentMode: 'compressed' | 'plain'): void {
        const options = [
            {
                id: 'compressed',
                label: this.t('settings.collection.webAssetGenerationMode.compressed'),
            },
            {
                id: 'plain',
                label: this.t('settings.collection.webAssetGenerationMode.plain'),
            },
        ];

        (this._webAssetModeSelect as HTMLSelectElement).replaceChildren();

        options.forEach((modeOption) => {
            const option = document.createElement('option');
            option.value = modeOption.id;
            option.textContent = modeOption.label;
            option.selected = modeOption.id === currentMode;
            (this._webAssetModeSelect as HTMLSelectElement).appendChild(option);
        });
    }

    private _refreshRuntimeOptions(): void {
        const runtimes = this._collectionManager.listAvailableRuntimes();
        const currentRuntimeId = this._collection?.getDeviceRuntimeId() || null;
        (this._runtimeSelect as HTMLSelectElement).replaceChildren();

        for (const runtime of runtimes) {
            const option = document.createElement('option');
            option.value = runtime.id;
            option.textContent = runtime.name || runtime.id;
            if (runtime.id === currentRuntimeId) {
                option.selected = true;
            }
            (this._runtimeSelect as HTMLSelectElement).appendChild(option);
        }
    }

    private _refreshTargetOptions(runtimeId: string): void {
        const targets = this._collectionManager.listTargetsForRuntime(runtimeId);
        const currentTargetId = this._collection?.getTargetId() || null;
        (this._targetSelect as HTMLSelectElement).replaceChildren();

        for (const target of targets) {
            const option = document.createElement('option');
            option.value = target.id;
            option.textContent = target.name || target.id;
            if (target.id === currentTargetId) {
                option.selected = true;
            }
            (this._targetSelect as HTMLSelectElement).appendChild(option);
        }
    }

    private _handleCollectionNameCommit(): void {
        if (!this._collection || !this._nameInput) {
            return;
        }
        const nextValue = this._nameInput.value.trim();
        if (!nextValue) {
            this._nameInput.value = this._collection.getTitle();
            return;
        }
        if (nextValue !== this._collection.getTitle()) {
            this._collection.setTitle(nextValue);
        }
    }

    private _handleRuntimeChanged(runtimeId: string): void {
        if (!this._collection || !runtimeId) {
            return;
        }
        if (runtimeId !== this._collection.getDeviceRuntimeId()) {
            this._collection.setDeviceRuntimeId(runtimeId);
        }

        const availableTargets = this._collectionManager.listTargetsForRuntime(runtimeId);
        const currentTargetId = this._collection.getTargetId();
        const targetStillValid = availableTargets.some((target) => target.id === currentTargetId);
        if (!targetStillValid) {
            this._collection.setTargetId(availableTargets[0]?.id || null);
        }

        this._refreshTargetOptions(runtimeId);
    }

    private _handleTargetChanged(targetId: string): void {
        if (!this._collection) {
            return;
        }
        this._collection.setTargetId(targetId || null);
    }

    private _handleWebAssetGenerationModeChanged(mode: string): void {
        if (!this._collection) {
            return;
        }

        const normalizedMode = mode === 'plain' ? 'plain' : 'compressed';
        if (normalizedMode !== this._collection.getWebAssetGenerationMode()) {
            this._collection.setWebAssetGenerationMode(normalizedMode);
        }
    }

    override serialize(): ReturnType<ViewBase['serialize']> {
        return {
            ...super.serialize(),
            type: 'CollectionSettingsView',
        };
    }

    static deserialize(
        data: CollectionSettingsSerializedData = {},
        viewFactory: unknown = null,
        context: CollectionSettingsDeserializeContext = {}
    ): CollectionSettingsView {
        void viewFactory;
        const { title = null, icon = 'settings', id = null } = data;
        const { collectionManager = null, i18nService = null, logger = null } = context;
        if (!collectionManager) {
            throw new Error(
                'CollectionSettingsView requires collectionManager in deserialize context'
            );
        }
        return new CollectionSettingsView({
            collectionManager,
            i18nService,
            title,
            icon,
            id,
            logger,
        });
    }
}
