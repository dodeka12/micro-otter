import { ViewBase } from './view-base.js';
import { SplitView } from './split-view.js';
import { TabbedView } from './tabbed-view.js';
import { TextView } from './text-view.js';
import { CodeView } from './code-view.js';
import { MarkdownView } from './markdown-view.js';
import { ModalDialogView } from './modal-dialog-view.js';
import { TextDialogView } from './text-dialog-view.js';
import { WorkspaceView } from './workspace-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { FormDialogView } from './form-dialog-view.js';
import { FileImportDialogView } from './file-import-dialog-view.js';
import { FilePickerDialogView } from './file-picker-dialog-view.js';
import { DeviceConnectionDialogView } from './device-connection-dialog-view.js';
import { ConnectingProgressDialogView } from './connecting-progress-dialog-view.js';
import { DeploymentProgressDialogView } from './deployment-progress-dialog-view.js';
import { ErrorDialogView } from './error-dialog-view.js';
import { NodePaletteView } from './node-palette-view.js';
import { CollectionView } from './collection-view.js';
import { TranspilerView } from './transpiler-view.js';
import { ConsoleLogView } from './console-log-view.js';
import { DeviceConnectionView } from './device-connection-view.js';
import { DeviceDeploymentView } from './device-deployment-view.js';
import { FirmwareBuildView } from './firmware-build-view.js';
import { CustomRuntimeView } from './custom-runtime-view.js';
import { GeneralSettingsView } from './general-settings-view.js';
import { CollectionSettingsView } from './collection-settings-view.js';
import { GraphSettingsView } from './graph-settings-view.js';
import { AllSettingsView } from './all-settings-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { StackView } from './stack-view.js';
import { MessageView } from './message-view.js';
import { ProgressDetailView } from './progress-detail-view.js';

type LoggerFunction = (...args: unknown[]) => void;

type SerializedView = {
    type?: string;
    [key: string]: unknown;
};

type ViewClassContext = Record<string, unknown>;

type ViewDeserializeContext = {
    i18nService: unknown;
    logger: LoggerFunction | null;
    workspace: unknown;
    viewManager: unknown;
    deviceRuntime: unknown;
    runtimeCollection: unknown;
    workspaceConfig: unknown;
    collectionManager: unknown;
    transpiler: unknown;
    deviceConnection: unknown;
    deviceDeployment: unknown;
};

interface ViewClass {
    deserialize: (...args: unknown[]) => unknown;
}

export interface ViewFactoryOptions {
    i18nService?: unknown;
    logger?: LoggerFunction | null;
    workspace?: unknown;
    viewManager?: unknown;
    deviceRuntime?: unknown;
    runtimeCollection?: unknown;
    workspaceConfig?: unknown;
    collectionManager?: unknown;
    transpiler?: unknown;
    deviceConnection?: unknown;
    deviceDeployment?: unknown;
}

/**
 * Factory that rehydrates serialized view trees into ViewBase instances.
 */
export class ViewFactory {
    private _registry: Map<string, ViewClass>;
    private _i18nService: unknown;
    private _logger: LoggerFunction | null;
    private _workspace: unknown;
    private _viewManager: unknown;
    private _deviceRuntime: unknown;
    private _runtimeCollection: unknown;
    private _workspaceConfig: unknown;
    private _collectionManager: unknown;
    private _transpiler: unknown;
    private _deviceConnection: unknown;
    private _deviceDeployment: unknown;

    /**
     * Create a ViewFactory instance.
     * @param options Factory dependencies forwarded to view deserializers.
     */
    constructor({
        i18nService = null,
        logger = null,
        workspace = null,
        viewManager = null,
        deviceRuntime = null,
        runtimeCollection = null,
        workspaceConfig = null,
        collectionManager = null,
        transpiler = null,
        deviceConnection = null,
        deviceDeployment = null,
    }: ViewFactoryOptions = {}) {
        this._registry = new Map();
        this._i18nService = i18nService;
        this._logger = logger;
        this._workspace = workspace;
        this._viewManager = viewManager;
        this._deviceRuntime = deviceRuntime;
        this._runtimeCollection = runtimeCollection;
        this._workspaceConfig = workspaceConfig;
        this._collectionManager = collectionManager;
        this._transpiler = transpiler;
        this._deviceConnection = deviceConnection;
        this._deviceDeployment = deviceDeployment;
        this.register('ViewBase', ViewBase);
        this.register('SplitView', SplitView);
        this.register('TabbedView', TabbedView);
        this.register('TextView', TextView);
        this.register('CodeView', CodeView);
        this.register('MarkdownView', MarkdownView);
        this.register('ModalDialogView', ModalDialogView);
        this.register('TextDialogView', TextDialogView);
        this.register('WorkspaceView', WorkspaceView);
        this.register('ConfirmationDialogView', ConfirmationDialogView);
        this.register('FormDialogView', FormDialogView);
        this.register('FileImportDialogView', FileImportDialogView);
        this.register('FilePickerDialogView', FilePickerDialogView);
        this.register('DeviceConnectionDialogView', DeviceConnectionDialogView);
        this.register('ConnectingProgressDialogView', ConnectingProgressDialogView);
        this.register('DeploymentProgressDialogView', DeploymentProgressDialogView);
        this.register('ErrorDialogView', ErrorDialogView);
        this.register('NodePaletteView', NodePaletteView);
        this.register('CollectionView', CollectionView);
        this.register('TranspilerView', TranspilerView);
        this.register('ConsoleLogView', ConsoleLogView);
        this.register('DeviceConnectionView', DeviceConnectionView);
        this.register('DeviceDeploymentView', DeviceDeploymentView);
        this.register('FirmwareBuildView', FirmwareBuildView);
        this.register('custom-runtime-view', CustomRuntimeView);
        this.register('GeneralSettingsView', GeneralSettingsView);
        this.register('CollectionSettingsView', CollectionSettingsView);
        this.register('GraphSettingsView', GraphSettingsView);
        this.register('AllSettingsView', AllSettingsView);
        this.register('CollapsibleView', CollapsibleView);
        this.register('StackView', StackView);
        this.register('MessageView', MessageView);
        this.register('ProgressDetailView', ProgressDetailView);
    }

    /**
     * Register a view constructor for a serialized type name.
     * @param type Serialized type discriminator.
     * @param ctor Class with a static deserialize method.
     */
    register(type: string, ctor: ViewClass | null | undefined): void {
        if (typeof type === 'string' && ctor && typeof ctor.deserialize === 'function') {
            this._registry.set(type, ctor);
        }
    }

    /**
     * Create a view instance from serialized data.
     * @param data Serialized view object containing a `type` field.
     * @returns Rehydrated view instance.
     */
    create(data: SerializedView = {}): ViewBase {
        const type = data?.type;
        const ctor = typeof type === 'string' ? this._registry.get(type) : null;
        const target: ViewClass =
            ctor && typeof ctor.deserialize === 'function'
                ? ctor
                : (ViewBase as unknown as ViewClass);
        const context: ViewDeserializeContext = {
            i18nService: this._i18nService,
            logger: this._logger,
            workspace: this._workspace,
            viewManager: this._viewManager,
            deviceRuntime: this._deviceRuntime,
            runtimeCollection: this._runtimeCollection,
            workspaceConfig: this._workspaceConfig,
            collectionManager: this._collectionManager,
            transpiler: this._transpiler,
            deviceConnection: this._deviceConnection,
            deviceDeployment: this._deviceDeployment,
        };
        return target.deserialize(
            data,
            (child: unknown) => this.create((child ?? {}) as SerializedView),
            context as unknown as ViewClassContext,
        ) as ViewBase;
    }

    /**
     * Rehydrate an array of serialized views.
     * @param list Serialized view objects.
     * @returns Rehydrated view instances.
     */
    createMany(list: SerializedView[] = []): ViewBase[] {
        if (!Array.isArray(list)) {
            return [];
        }
        return list.map((entry) => this.create(entry));
    }
}