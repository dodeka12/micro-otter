import { ModalDialogView } from './modal-dialog-view.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;

type FileImportData = unknown;

type FileImportValidator = ((parsedData: FileImportData) => boolean | string | void) | null;

export interface FileImportDialogViewOptions {
    title?: string;
    message?: string | null;
    acceptedExtensions?: string[];
    maxSizeBytes?: number | null;
    parseJSON?: boolean;
    validator?: FileImportValidator;
    icon?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    id?: string | null;
    logger?: LoggerLike;
}

export interface FileImportDialogConfirmResult extends Record<string, unknown> {
    fileData: FileImportData;
    fileName: string | null;
}

export interface FileImportDialogSerialized extends Record<string, unknown> {
    type: 'FileImportDialogView';
    message: string | null;
    acceptedExtensions: string[];
    maxSizeBytes: number | null;
    parseJSON: boolean;
    fileName: string | null;
}

interface FileImportDialogDeserializeData {
    title?: string;
    icon?: string;
    id?: string | null;
    message?: string | null;
    acceptedExtensions?: string[];
    maxSizeBytes?: number | null;
    parseJSON?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
}

export class FileImportDialogView extends ModalDialogView {
    message: string | null;
    acceptedExtensions: string[];
    maxSizeBytes: number | null;
    parseJSON: boolean;
    validator: FileImportValidator;

    private _fileData: FileImportData | null;
    private _fileName: string | null;
    private _fileInput: HTMLInputElement | null;
    private _uploadArea: HTMLDivElement | null;
    private _previewArea: HTMLDivElement | null;
    private _errorEl: HTMLDivElement | null;

    constructor({
        title = 'Import File',
        message = null,
        acceptedExtensions = ['.json'],
        maxSizeBytes = null,
        parseJSON = true,
        validator = null,
        icon = '📤',
        confirmLabel = 'Import',
        cancelLabel = 'Cancel',
        id = null,
        logger = null,
    }: FileImportDialogViewOptions = {}) {
        super({
            title,
            icon,
            confirmLabel,
            cancelLabel,
            id,
            logger,
        });
        this.message = message !== null && message !== undefined ? String(message) : null;
        this.acceptedExtensions = acceptedExtensions;
        this.maxSizeBytes = maxSizeBytes;
        this.parseJSON = Boolean(parseJSON);
        this.validator = validator;

        this._fileData = null;
        this._fileName = null;
        this._fileInput = null;
        this._uploadArea = null;
        this._previewArea = null;
        this._errorEl = null;
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        if (this.message) {
            const messageEl = document.createElement('p');
            messageEl.className = 'file-import-dialog__message';
            messageEl.textContent = this.message;
            body.appendChild(messageEl);
        }

        const uploadArea = document.createElement('div');
        uploadArea.className = 'file-import-dialog__upload-area';
        uploadArea.textContent = 'Click to select a file or drag and drop here';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.className = 'file-import-dialog__file-input';
        fileInput.style.position = 'absolute';
        fileInput.style.opacity = '0';
        fileInput.style.pointerEvents = 'none';
        fileInput.style.width = '1px';
        fileInput.style.height = '1px';
        if (this.acceptedExtensions.length > 0) {
            fileInput.accept = this.acceptedExtensions.join(',');
        }

        uploadArea.addEventListener('dragover', (event: DragEvent) => {
            event.preventDefault();
            uploadArea.classList.add('is-dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('is-dragover');
        });
        uploadArea.addEventListener('drop', (event: DragEvent) => {
            event.preventDefault();
            uploadArea.classList.remove('is-dragover');
            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
                void this._handleFile(files[0]);
            }
        });

        body.appendChild(uploadArea);
        body.appendChild(fileInput);

        uploadArea.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this._log('upload-area-clicked', 'info');
            this._log('file-input-attached', 'info', {
                isConnected: fileInput.isConnected,
                parentElement: fileInput.parentElement?.nodeName,
            });
            setTimeout(() => {
                fileInput.click();
            }, 0);
        });
        fileInput.addEventListener('change', (event: Event) => {
            void this._handleFileSelect(event);
        });

        this._uploadArea = uploadArea;
        this._fileInput = fileInput;

        const errorEl = document.createElement('div');
        errorEl.className = 'file-import-dialog__error';
        errorEl.style.display = 'none';
        body.appendChild(errorEl);
        this._errorEl = errorEl;

        const previewArea = document.createElement('div');
        previewArea.className = 'file-import-dialog__preview';
        previewArea.style.display = 'none';
        body.appendChild(previewArea);
        this._previewArea = previewArea;

        return body;
    }

    private async _handleFileSelect(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement | null;
        const files = target?.files;
        if (files && files.length > 0) {
            await this._handleFile(files[0]);
        }
    }

    private async _handleFile(file: File): Promise<void> {
        this._clearError();
        this._clearPreview();

        const ext = this._getFileExtension(file.name);
        if (this.acceptedExtensions.length > 0 && !this.acceptedExtensions.includes(ext)) {
            this._showError(`Invalid file type. Expected: ${this.acceptedExtensions.join(', ')}`);
            return;
        }

        if (this.maxSizeBytes !== null && file.size > this.maxSizeBytes) {
            const maxMB = (this.maxSizeBytes / (1024 * 1024)).toFixed(2);
            this._showError(`File is too large. Maximum size: ${maxMB} MB`);
            return;
        }

        try {
            const content = await this._readFileContent(file);
            this._fileName = file.name;

            if (this.parseJSON) {
                try {
                    this._fileData = JSON.parse(content);
                } catch (err) {
                    this._showError('Invalid JSON format.');
                    this._log('JSON parse error', err);
                    return;
                }
            } else {
                this._fileData = content;
            }

            if (this.validator && typeof this.validator === 'function') {
                const result = this.validator(this._fileData);
                if (result !== true && result !== undefined) {
                    const errorMsg = typeof result === 'string' ? result : 'Validation failed.';
                    this._showError(errorMsg);
                    this._fileData = null;
                    this._fileName = null;
                    return;
                }
            }

            this._showPreview();
        } catch (err) {
            this._showError('Failed to read file.');
            this._log('File read error', err);
        }
    }

    private _readFileContent(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    private _getFileExtension(filename: string): string {
        const lastDot = filename.lastIndexOf('.');
        return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
    }

    private _showError(message: string): void {
        if (this._errorEl) {
            this._errorEl.textContent = message;
            this._errorEl.style.display = 'block';
        }
    }

    private _clearError(): void {
        if (this._errorEl) {
            this._errorEl.textContent = '';
            this._errorEl.style.display = 'none';
        }
    }

    private _showPreview(): void {
        if (!this._previewArea) {
            return;
        }

        this._previewArea.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'file-import-dialog__preview-header';
        header.textContent = `File: ${this._fileName}`;

        const content = document.createElement('pre');
        content.className = 'file-import-dialog__preview-content';
        const dataStr =
            typeof this._fileData === 'string'
                ? this._fileData
                : JSON.stringify(this._fileData, null, 2);
        content.textContent = this._truncatePreview(dataStr, 500);

        this._previewArea.appendChild(header);
        this._previewArea.appendChild(content);
        this._previewArea.style.display = 'block';
    }

    private _clearPreview(): void {
        if (this._previewArea) {
            this._previewArea.innerHTML = '';
            this._previewArea.style.display = 'none';
        }
    }

    private _truncatePreview(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '\n... (truncated)';
    }

    protected override _onConfirm(): FileImportDialogConfirmResult {
        if (this._fileData === null) {
            throw new Error('No file loaded');
        }
        return {
            fileData: this._fileData,
            fileName: this._fileName,
        };
    }

    override confirm(): void {
        try {
            super.confirm();
        } catch (err) {
            this._showError('Please select a valid file before importing.');
            this._log('Import prevented', err);
        }
    }

    override serialize(): FileImportDialogSerialized {
        return {
            ...super.serialize(),
            type: 'FileImportDialogView',
            message: this.message,
            acceptedExtensions: this.acceptedExtensions,
            maxSizeBytes: this.maxSizeBytes,
            parseJSON: this.parseJSON,
            fileName: this._fileName,
        };
    }

    static deserialize(
        data: FileImportDialogDeserializeData,
        logger: LoggerLike = null
    ): FileImportDialogView {
        return new FileImportDialogView({
            title: data.title,
            icon: data.icon,
            id: data.id,
            message: data.message,
            acceptedExtensions: data.acceptedExtensions,
            maxSizeBytes: data.maxSizeBytes,
            parseJSON: data.parseJSON,
            confirmLabel: data.confirmLabel,
            cancelLabel: data.cancelLabel,
            logger,
        });
    }
}
