import { ViewBase } from './view-base.js';
import { SplitView } from './split-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { GeneralSettingsView } from './general-settings-view.js';
import { CollectionSettingsView } from './collection-settings-view.js';
import { GraphSettingsView } from './graph-settings-view.js';

const SETTINGS_MIN_PANE_HEIGHT = 72;

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type CollectionSettingsViewOptions = ConstructorParameters<typeof CollectionSettingsView>[0];
type GraphSettingsViewOptions = ConstructorParameters<typeof GraphSettingsView>[0];

type LoggerOption = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceOption = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
type CollectionManagerLike =
    (CollectionSettingsViewOptions extends { collectionManager: infer T } ? T : unknown) &
    (GraphSettingsViewOptions extends { collectionManager: infer T } ? T : unknown);

interface WorkspaceLike {
    i18nService?: I18nServiceOption;
}

interface AllSettingsViewOptions {
    workspace?: WorkspaceLike | null;
    collectionManager?: CollectionManagerLike | null;
    i18nService?: I18nServiceOption;
    title?: string | null;
    icon?: string | null;
    id?: string | null;
    logger?: LoggerOption;
}

interface ChildGeneralSettingsViewOptions {
    workspace: WorkspaceLike;
    i18nService?: I18nServiceOption;
    id?: string | null;
    logger?: LoggerOption;
    showTitle?: boolean;
}

interface AllSettingsViewSerialized extends Record<string, unknown> {
    type: 'AllSettingsView';
    id: string;
    title: string;
    icon: string | null;
}

interface AllSettingsViewDeserializeData {
    title?: string | null;
    icon?: string | null;
    id?: string | null;
}

interface AllSettingsViewDeserializeContext {
    workspace?: WorkspaceLike | null;
    collectionManager?: CollectionManagerLike | null;
    i18nService?: I18nServiceOption;
    logger?: LoggerOption;
}

type GeneralSettingsViewCtor = new (options: ChildGeneralSettingsViewOptions) => ViewBase;

const GeneralSettingsViewClass = GeneralSettingsView as unknown as GeneralSettingsViewCtor;

export class AllSettingsView extends ViewBase {
    private _workspace: WorkspaceLike;
    private _collectionManager: CollectionManagerLike;
    private _loggerRef: LoggerOption;

    private _generalSettingsView: ViewBase | null;
    private _collectionSettingsView: ViewBase | null;
    private _graphSettingsView: ViewBase | null;
    private _generalCollapsible: CollapsibleView | null;
    private _collectionCollapsible: CollapsibleView | null;
    private _graphCollapsible: CollapsibleView | null;
    private _splitView: SplitView | null;

    constructor({
        workspace,
        collectionManager,
        i18nService = null,
        title = null,
        icon = 'settings',
        id = null,
        logger = null,
    }: AllSettingsViewOptions = {}) {
        if (!workspace) {
            throw new Error('AllSettingsView requires a workspace instance');
        }
        if (!collectionManager) {
            throw new Error('AllSettingsView requires a collectionManager instance');
        }

        super({
            title: title || 'All Settings',
            icon,
            id,
            logger,
            i18nService: i18nService || workspace.i18nService || null,
        });

        this._workspace = workspace;
        this._collectionManager = collectionManager;
        this._loggerRef = logger;

        this._generalSettingsView = null;
        this._collectionSettingsView = null;
        this._graphSettingsView = null;
        this._generalCollapsible = null;
        this._collectionCollapsible = null;
        this._graphCollapsible = null;
        this._splitView = null;
    }

    override render(container: HTMLElement): void {
        void container;

        const root = document.createElement('div');
        root.className = 'view-all-settings';
        const splitHost = document.createElement('div');
        splitHost.className = 'view-all-settings__split-host';
        root.appendChild(splitHost);

        this.mountContent(root);

        if (!this._generalSettingsView) {
            this._generalSettingsView = new GeneralSettingsViewClass({
                workspace: this._workspace,
                i18nService: this._i18nService,
                id: `${this.id}-general-settings`,
                logger: this._loggerRef,
                showTitle: false,
            });
        }

        if (!this._collectionSettingsView) {
            this._collectionSettingsView = new CollectionSettingsView({
                collectionManager: this._collectionManager,
                i18nService: this._i18nService,
                id: `${this.id}-collection-settings`,
                logger: this._loggerRef,
                showTitle: false,
            });
        }

        if (!this._graphSettingsView) {
            this._graphSettingsView = new GraphSettingsView({
                collectionManager: this._collectionManager,
                i18nService: this._i18nService,
                id: `${this.id}-graph-settings`,
                logger: this._loggerRef,
                showTitle: false,
            });
        }

        if (!this._generalCollapsible) {
            this._generalCollapsible = new CollapsibleView({
                headerTitle: this.t('settings.section.general'),
                collapsed: false,
                contentView: this._generalSettingsView,
                sizeToContent: true,
                i18nService: this._i18nService,
                id: `${this.id}-general-collapsible`,
                logger: this._loggerRef,
            });
        }

        if (!this._collectionCollapsible) {
            this._collectionCollapsible = new CollapsibleView({
                headerTitle: this.t('settings.section.collection'),
                collapsed: false,
                contentView: this._collectionSettingsView,
                sizeToContent: true,
                i18nService: this._i18nService,
                id: `${this.id}-collection-collapsible`,
                logger: this._loggerRef,
            });
        }

        if (!this._graphCollapsible) {
            this._graphCollapsible = new CollapsibleView({
                headerTitle: this.t('settings.section.graph'),
                collapsed: false,
                contentView: this._graphSettingsView,
                sizeToContent: true,
                i18nService: this._i18nService,
                id: `${this.id}-graph-collapsible`,
                logger: this._loggerRef,
            });
        }

        if (!this._splitView) {
            this._splitView = new SplitView({
                title: this.title,
                id: `${this.id}-split`,
                orientation: 'vertical',
                minPaneSize: SETTINGS_MIN_PANE_HEIGHT,
                gap: 0,
                views: [this._generalCollapsible, this._collectionCollapsible, this._graphCollapsible],
                i18nService: this._i18nService,
                logger: this._loggerRef,
            });
        }

        this._splitView.attachTo(splitHost);
    }

    override afterAttach(): void {
        super.afterAttach();
    }

    override beforeDetach(): void {
        if (this._splitView) {
            this._splitView.detach();
        }

        super.beforeDetach();
    }

    override serialize(): AllSettingsViewSerialized {
        return {
            ...super.serialize(),
            type: 'AllSettingsView',
        };
    }

    static deserialize(
        data: AllSettingsViewDeserializeData = {},
        viewFactory: unknown = null,
        context: AllSettingsViewDeserializeContext = {}
    ): AllSettingsView {
        void viewFactory;

        const { title = null, icon = 'settings', id = null } = data;
        const { workspace = null, collectionManager = null, i18nService = null, logger = null } = context;

        if (!workspace) {
            throw new Error('AllSettingsView requires workspace in deserialize context');
        }
        if (!collectionManager) {
            throw new Error('AllSettingsView requires collectionManager in deserialize context');
        }

        return new AllSettingsView({
            workspace,
            collectionManager,
            i18nService,
            title,
            icon,
            id,
            logger,
        });
    }
}