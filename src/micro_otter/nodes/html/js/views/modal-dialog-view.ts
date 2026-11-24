import { ViewBase } from './view-base.js';
import { AppPayload } from '../core/app-event.js';
import { IconProvider } from './icon-provider.js';

const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

type ModalDialogPayloadData = Record<string, unknown>;
type ModalDialogCleanup = () => void;

interface ModalDialogOptions {
    title?: string;
    icon?: string | null;
    id?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    destructive?: boolean;
    disableEscape?: boolean;
    autofocus?: boolean;
    /**
     * When `false`, the header renders no dismiss button. Use it for dialogs that must not be
     * closed by the user; such a dialog then always has to be closed programmatically.
     */
    showDismiss?: boolean;
    logger?: ((message: string, level?: unknown, ...data: unknown[]) => void) | null;
    i18nService?: {
        t: (key: string, params?: Record<string, unknown>) => string;
        addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
        removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    } | null;
}

interface ModalDialogDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    showDismiss?: boolean;
}

interface ModalDialogDeserializeContext {
    i18nService?: ModalDialogOptions['i18nService'];
    logger?: ModalDialogOptions['logger'];
}

/**
 * Payload for `confirm` events emitted by ModalDialogView.
 */
class ModalDialogViewConfirmPayload extends AppPayload {
    /**
    * @param {object} params - Dialog-specific fields forwarded with confirm events.
     */
    constructor(params: ModalDialogPayloadData = {}) {
        super('ModalDialogView.Confirm.v1');
        Object.assign(this, params);
    }
}

/**
 * Payload for `cancel` events emitted by ModalDialogView.
 */
class ModalDialogViewCancelPayload extends AppPayload {
    /**
    * @param {object} params - Dialog-specific fields forwarded with cancel events.
     */
    constructor(params: ModalDialogPayloadData = {}) {
        super('ModalDialogView.Cancel.v1');
        Object.assign(this, params);
    }
}

/**
 * Payload for `close` events emitted by ModalDialogView.
 */
class ModalDialogViewClosePayload extends AppPayload {
    /**
    * @param {object} params - Dialog-specific fields forwarded with close events.
     */
    constructor(params: ModalDialogPayloadData = {}) {
        super('ModalDialogView.Close.v1');
        Object.assign(this, params);
    }
}

/**
 * Base class for modal dialogs providing common infrastructure.
 *
 * Handles:
 * - Modal overlay and surface structure
 * - Header with title, icon, and dismiss button
 * - Focus trap and keyboard navigation (Tab cycling, Escape handling)
 * - Event emission system (confirm, cancel, close)
 * - Common lifecycle hooks
 *
 * Emitted Events:
 * - `confirm` -> `payloadTypeId: ModalDialogView.Confirm.v1` -> `ModalDialogViewConfirmPayload`
 * - `cancel` -> `payloadTypeId: ModalDialogView.Cancel.v1` -> `ModalDialogViewCancelPayload`
 * - `close` -> `payloadTypeId: ModalDialogView.Close.v1` -> `ModalDialogViewClosePayload`
 *
 * Subclasses must implement:
 * - `_buildBody()` - return a DOM node or element for the dialog body
 *
 * Subclasses may override:
 * - `_buildFooter()` - return custom footer element (default provides confirm/cancel buttons)
 * - `_onConfirm()` - handle confirm action before event emission
 * - `_onCancel()` - handle cancel action before event emission
 */
export class ModalDialogView extends ViewBase {
    confirmLabel: string;
    cancelLabel: string;
    showCancel: boolean;
    destructive: boolean;
    disableEscape: boolean;
    autofocus: boolean;
    /** Whether the header shows the `×` dismiss button. `false` means close programmatically only. */
    showDismiss: boolean;

    protected _cleanup: ModalDialogCleanup[];
    protected _dialogEl: HTMLDivElement | null;
    protected _focusable: HTMLElement[];

    /**
     * Create a modal dialog view.
     * @param {object} [options]
     * @param {string} [options.title='Modal Dialog'] Dialog title.
     * @param {string|null} [options.icon=null] Optional icon for header.
     * @param {string|null} [options.id=null] Explicit view id.
     * @param {string} [options.confirmLabel='OK'] Text for confirm button.
     * @param {string} [options.cancelLabel='Cancel'] Text for cancel button.
     * @param {boolean} [options.showCancel=true] Whether to show cancel button.
     * @param {boolean} [options.destructive=false] Apply destructive styling to confirm button.
     * @param {boolean} [options.disableEscape=false] Prevent Escape key from canceling.
     * @param {boolean} [options.autofocus=true] Auto-focus first focusable element.
     * @param {boolean} [options.showDismiss=true] Render the header dismiss button.
     * @param {Function|null} [options.logger=null] Optional logger function.
     * @param {object|null} [options.i18nService=null] I18n service for translations.
     */
    constructor({
        title = 'Modal Dialog',
        icon = null,
        id = null,
        confirmLabel = 'OK',
        cancelLabel = 'Cancel',
        showCancel = true,
        destructive = false,
        disableEscape = false,
        autofocus = true,
        showDismiss = true,
        logger = null,
        i18nService = null,
    }: ModalDialogOptions = {}) {
        super({ title, icon, id, logger, i18nService });
        this.confirmLabel = confirmLabel;
        this.cancelLabel = cancelLabel;
        this.showCancel = Boolean(showCancel);
        this.destructive = Boolean(destructive);
        this.disableEscape = Boolean(disableEscape);
        this.autofocus = Boolean(autofocus);
        this.showDismiss = Boolean(showDismiss);
        this._cleanup = [];
        this._dialogEl = null;
        this._focusable = [];
    }

    static deserialize(
        data: ModalDialogDeserializeData = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: ModalDialogDeserializeContext = {}
    ): any {
        void viewFactory;
        const { title = 'Modal Dialog', icon = null, id = null, showDismiss = true } = data;
        const { i18nService = null, logger = null } = context;
        return new ModalDialogView({ title, icon, id, showDismiss, i18nService, logger });
    }

    /**
     * Render the modal dialog structure into the container.
     * @param {HTMLElement} container Host element.
     */
    render(container: HTMLElement): void {
        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', this.title);

        const surface = document.createElement('div');
        surface.className = 'modal-dialog__surface';

        const header = this._buildHeader();
        surface.appendChild(header);

        const body = this._buildBody();
        surface.appendChild(body);

        const footer = this._buildFooter();
        surface.appendChild(footer);

        dialog.appendChild(surface);

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && !this.disableEscape) {
                event.preventDefault();
                this.cancel();
                return;
            }
            if (event.key === 'Tab') {
                this._trapFocus(event);
            }
        };
        dialog.addEventListener('keydown', onKeyDown);
        this._cleanup.push(() => dialog.removeEventListener('keydown', onKeyDown));

        container.replaceChildren(dialog);
        this._dialogEl = dialog;
        this._focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));

        if (this.autofocus) {
            setTimeout(() => this._focusDefault(), 0);
        }
    }

    /**
     * Cleanup before detachment.
     */
    override beforeDetach(): void {
        this._cleanup.forEach((fn) => {
            try {
                fn();
            } catch (err) {
                this._log('cleanup error', err);
            }
        });
        this._cleanup = [];
        this._dialogEl = null;
        this._focusable = [];
    }

    /**
     * Trigger confirm action. Calls `_onConfirm()` hook, then emits confirm/close events.
     */
    confirm(): void {
        const payload = this._onConfirm();
        const finalPayload = { reason: 'confirm', id: this.id, ...payload };
        this._emit('confirm', new ModalDialogViewConfirmPayload(finalPayload));
        this.close(finalPayload);
    }

    /**
     * Trigger cancel action. Calls `_onCancel()` hook, then emits cancel/close events.
     */
    cancel(): void {
        const payload = this._onCancel();
        const finalPayload = { reason: 'cancel', id: this.id, ...payload };
        this._emit('cancel', new ModalDialogViewCancelPayload(finalPayload));
        this.close(finalPayload);
    }

    /**
     * Close the dialog by emitting a close event.
     * @param {object|null} payload Optional event payload.
     */
    close(payload: ModalDialogPayloadData | null = null): void {
        const payloadReason = payload && typeof payload === 'object' ? payload.reason : null;
        const finalPayload =
            payload && typeof payload === 'object'
                ? { reason: payloadReason || 'close', id: this.id, ...payload }
                : { reason: 'close', id: this.id };
        this._emit('close', new ModalDialogViewClosePayload(finalPayload));
    }

    /**
     * Build the dialog header with title, icon, and the optional dismiss button.
     *
     * The header icon accepts the same values every other view takes: an `IconProvider`
     * value, a served path or a URL (rendered as an `<img>`, because registered SVGs are
     * inlined `data:` URIs), or a text/emoji glyph such as the `❌`/`⚠️`/`📝` defaults of the
     * confirmation, error and form dialogs. The rule lives in `IconProvider.isImageSource()`.
     *
     * The `×` dismiss button is rendered only when `showDismiss` is set; a dialog that reports a
     * running, non-cancellable operation passes `showDismiss: false` and is closed programmatically.
     * @returns {HTMLElement}
     * @protected
     */
    protected _buildHeader(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'modal-dialog__header';

        const iconEl = document.createElement('div');
        iconEl.className = 'modal-dialog__icon';
        iconEl.setAttribute('aria-hidden', 'true');
        if (this.icon) {
            // The icon is either an image source - every registered `IconProvider` SVG is an
            // inlined `data:` URI - or a text/emoji glyph, which is what the confirmation,
            // error, form and file dialogs pass. `IconProvider.isImageSource()` owns that
            // distinction; classifying by file extension would print the whole base64
            // document into the header.
            if (IconProvider.isImageSource(this.icon)) {
                const iconImg = document.createElement('img');
                iconImg.className = 'modal-dialog__icon-img';
                iconImg.src = this.icon;
                iconImg.alt = '';
                iconEl.appendChild(iconImg);
            } else {
                iconEl.textContent = this.icon;
            }
        } else {
            iconEl.style.display = 'none';
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'modal-dialog__title';
        titleEl.textContent = this.title;

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'modal-dialog__btn modal-dialog__btn--ghost modal-dialog__btn--icon';
        dismissBtn.title = 'Close dialog';
        dismissBtn.textContent = '×';
        dismissBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.cancel();
        });

        header.appendChild(iconEl);
        header.appendChild(titleEl);
        if (this.showDismiss) {
            header.appendChild(dismissBtn);
        }

        return header;
    }

    /**
     * Build the dialog body. Subclasses must implement this method.
     * @returns {HTMLElement}
     * @protected
     * @abstract
     */
    protected _buildBody(): HTMLElement {
        throw new Error('Subclasses must implement _buildBody()');
    }

    /**
     * Build the dialog footer with confirm/cancel buttons.
     * Subclasses can override for custom footer layouts.
     * @returns {HTMLElement}
     * @protected
     */
    protected _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'modal-dialog__btn modal-dialog__btn--primary';
        if (this.destructive) {
            confirmBtn.classList.add('is-destructive');
        }
        confirmBtn.textContent = this.confirmLabel;
        confirmBtn.addEventListener('click', () => this.confirm());
        footer.appendChild(confirmBtn);

        if (this.showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'modal-dialog__btn modal-dialog__btn--ghost';
            cancelBtn.textContent = this.cancelLabel;
            cancelBtn.addEventListener('click', () => this.cancel());
            footer.appendChild(cancelBtn);
        }

        return footer;
    }

    /**
     * Hook called when confirm action is triggered. Override in subclasses.
     * Should return an object with any additional payload data.
     * @returns {object} Additional payload data for confirm event.
     * @protected
     */
    protected _onConfirm(): ModalDialogPayloadData {
        return {};
    }

    /**
     * Hook called when cancel action is triggered. Override in subclasses.
     * Should return an object with any additional payload data.
     * @returns {object} Additional payload data for cancel event.
     * @protected
     */
    protected _onCancel(): ModalDialogPayloadData {
        return {};
    }

    /**
     * Trap Tab key focus within dialog elements.
     * @param {KeyboardEvent} event Tab key event.
     * @private
     */
    protected _trapFocus(event: KeyboardEvent): void {
        if (!this._focusable.length) {
            return;
        }
        event.preventDefault();
        const current = document.activeElement;
        const index = this._focusable.indexOf(current as HTMLElement);
        let nextIndex = index;
        if (event.shiftKey) {
            nextIndex = index <= 0 ? this._focusable.length - 1 : index - 1;
        } else {
            nextIndex = index === -1 || index >= this._focusable.length - 1 ? 0 : index + 1;
        }
        this._focusable[nextIndex].focus();
    }

    /**
     * Focus the first focusable element in the dialog.
     * @private
     */
    protected _focusDefault(): void {
        const target = this._focusable[0];
        if (target && typeof target.focus === 'function') {
            target.focus();
        }
    }

    /**
     * Serialize the base dialog state.
     * Subclasses should call super.serialize() and extend with their own properties.
     * @returns {object}
     */
    override serialize(): any {
        return {
            ...super.serialize(),
            confirmLabel: this.confirmLabel,
            cancelLabel: this.cancelLabel,
            showCancel: this.showCancel,
            destructive: this.destructive,
            disableEscape: this.disableEscape,
            autofocus: this.autofocus,
            showDismiss: this.showDismiss,
        };
    }
}