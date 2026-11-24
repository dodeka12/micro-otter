// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file ViewBase-compatible console log view with timestamped messages and type icons.
 * @module views/console-log-view
 */

import { ViewBase } from './view-base.js';
import { SplitView } from './split-view.js';
import { ToolbarView } from './toolbar-view.js';
import { IconProvider } from './icon-provider.js';
import { DropdownControl } from './controls/dropdown-control.js';
import { AppPayload } from '../core/app-event.js';

type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

interface MessageTypeConfig {
    id?: MessageTypeValue | string;
    order?: number;
    icon?: string;
    iconPath?: string;
    color?: string;
    iconFilter?: string;
    className?: string;
    label: string;
}

type MessageTypeMap = Record<string, MessageTypeConfig>;
type MessageCounts = Record<string, number>;

interface LogEntry {
    type: string;
    message: string;
    timestamp: number;
    id: string;
}

interface AddMessageInput {
    type: string;
    message: string;
}

interface ConsoleFilterState {
    activeFilters: Set<string>;
    messageCounts: MessageCounts;
}

interface ConsoleLogViewMessageAddedPayloadParams {
    message: LogMessage;
}

interface ConsoleLogViewMessagesClearedPayloadParams {
    clearedCount: number;
}

interface ConsoleMessagesViewReadyPayload {
    messagesContainer: HTMLDivElement;
    messagesListDiv: HTMLDivElement;
}

interface ConsoleLogViewSerializedState {
    type: 'ConsoleLogView';
    maxMessages: number;
    showTimestamps: boolean;
    showIcons: boolean;
    autoScroll: boolean;
    messageTypes: MessageTypeMap;
}

interface DropdownFilterOption {
    value: string;
    label: string;
    icon?: string;
    iconPath?: string;
    iconFilter?: string;
    badge: string;
    order: number;
}

type JsonPayload = Record<string, unknown> | unknown[];

interface ToolbarButtonControl {
    element: HTMLButtonElement | null;
}

interface ConsoleLogViewOptions extends Record<string, unknown> {
    maxMessages?: number;
    showTimestamps?: boolean;
    showIcons?: boolean;
    messageTypes?: MessageTypeMap;
    autoScroll?: boolean;
    i18nService?: unknown;
    logger?: unknown;
}

/**
 * Message type enumeration for filtering and categorization.
 * @enum {string}
 */
export const MessageType = Object.freeze({
    ALL: 'all',
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    SUCCESS: 'success',
    USER: 'user',
    SYSTEM: 'system',
    DATA: 'data',
    OTTER: 'otter',
    RAW: 'raw',
});

/**
 * Default message type configurations with icons and CSS classes.
 */
const DEFAULT_MESSAGE_TYPES: MessageTypeMap = {
    system: {
        id: MessageType.SYSTEM,
        order: 1,
        iconPath: IconProvider.settings,
        color: '#4dd0e1',
        iconFilter: 'invert(79%) sepia(21%) saturate(1132%) hue-rotate(145deg) brightness(94%) contrast(88%)',
        className: 'msg-system',
        label: 'console.types.system',
    },
    otter: {
        id: MessageType.OTTER,
        order: 2,
        iconPath: IconProvider.otterHead64,
        color: '#9ad6a7',
        iconFilter: 'invert(79%) sepia(14%) saturate(617%) hue-rotate(92deg) brightness(93%) contrast(90%)',
        className: 'msg-otter',
        label: 'console.types.otter',
    },
    user: {
        id: MessageType.USER,
        order: 3,
        iconPath: IconProvider.person,
        color: '#ba68c8',
        iconFilter: 'invert(57%) sepia(29%) saturate(711%) hue-rotate(243deg) brightness(89%) contrast(89%)',
        className: 'msg-user',
        label: 'console.types.user',
    },
    info: {
        id: MessageType.INFO,
        order: 4,
        iconPath: IconProvider.info,
        color: '#64b5f6',
        iconFilter: 'invert(66%) sepia(51%) saturate(1507%) hue-rotate(184deg) brightness(100%) contrast(94%)',
        className: 'msg-info',
        label: 'console.types.info',
    },
    error: {
        id: MessageType.ERROR,
        order: 5,
        iconPath: IconProvider.error,
        color: '#ff5252',
        iconFilter: 'invert(48%) sepia(65%) saturate(4027%) hue-rotate(336deg) brightness(101%) contrast(101%)',
        className: 'msg-error',
        label: 'console.types.error',
    },
    warning: {
        id: MessageType.WARNING,
        order: 6,
        iconPath: IconProvider.warning,
        color: '#ffb74d',
        iconFilter: 'invert(74%) sepia(39%) saturate(1476%) hue-rotate(336deg) brightness(102%) contrast(101%)',
        className: 'msg-warning',
        label: 'console.types.warning',
    },
    success: {
        id: MessageType.SUCCESS,
        order: 7,
        iconPath: IconProvider.checkCircle,
        color: '#8bf0d2',
        iconFilter: 'invert(89%) sepia(16%) saturate(696%) hue-rotate(94deg) brightness(97%) contrast(93%)',
        className: 'msg-success',
        label: 'console.types.success',
    },
    data: {
        id: MessageType.DATA,
        order: 8,
        iconPath: IconProvider.dataObject,
        color: '#81c784',
        iconFilter: 'invert(78%) sepia(16%) saturate(826%) hue-rotate(74deg) brightness(85%) contrast(87%)',
        className: 'msg-data',
        label: 'console.types.data',
    },
    raw: {
        id: MessageType.RAW,
        order: 9,
        iconPath: IconProvider.codeGenerator,
        color: '#b0bec5',
        iconFilter: 'invert(76%) sepia(5%) saturate(16%) hue-rotate(169deg) brightness(92%) contrast(88%)',
        className: 'msg-raw',
        label: 'console.types.raw',
    },
};

/**
 * Internal message representation with timestamp and unique ID.
 */
class LogMessage implements LogEntry {
    type: string;
    message: string;
    timestamp: number;
    id: string;
    /**
     * @param {string} type - Message type key
     * @param {string} message - Message content
     * @param {number} [timestamp=Date.now()] - Unix timestamp in milliseconds
     */
    constructor(type: string, message: string, timestamp = Date.now()) {
        this.type = type;
        this.message = message;
        this.timestamp = timestamp;
        this.id = this._generateId();
    }

    /**
     * Generate a unique identifier for this message.
     * @private
     * @returns {string} Unique message ID
     */
    _generateId(): string {
        return `msg-${this.timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Convert message to string representation with timestamp and type.
     * @returns {string} Formatted message string
     */
    toString(): string {
        const date = new Date(this.timestamp);
        const time = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        return `[${time}] [${this.type}] ${this.message}`;
    }

    /**
     * Convert message to JSON-serializable object.
     * @returns {object} JSON representation
     */
    toJSON(): LogEntry {
        return {
            type: this.type,
            message: this.message,
            timestamp: this.timestamp,
            id: this.id,
        };
    }
}

/**
 * Payload for `message-added` events emitted by ConsoleLogView.
 */
class ConsoleLogViewMessageAddedPayload extends AppPayload {
    message: LogMessage;
    /**
    * @param {object} params - Aggregated payload members for appended log entries.
    * @param {LogMessage} params.message - Log message instance that was added.
     */
    constructor({ message }: ConsoleLogViewMessageAddedPayloadParams) {
        super('ConsoleLogView.MessageAdded.v1');
        this.message = message;
    }
}

/**
 * Payload for `messages-cleared` events emitted by ConsoleLogView.
 */
class ConsoleLogViewMessagesClearedPayload extends AppPayload {
    clearedCount: number;
    /**
    * @param {object} params - Aggregated payload members for clear operations.
    * @param {number} params.clearedCount - Number of log messages removed.
     */
    constructor({ clearedCount }: ConsoleLogViewMessagesClearedPayloadParams) {
        super('ConsoleLogView.MessagesCleared.v1');
        this.clearedCount = clearedCount;
    }
}

/**
 * Internal view for rendering the scrollable message list.
 *
 * @extends ViewBase
 */
class ConsoleMessagesView extends ViewBase {
    _onScroll: (() => void) | null;
    _onReady: ((payload: ConsoleMessagesViewReadyPayload) => void) | null;
    _messagesContainer: HTMLDivElement | null;
    _messagesListDiv: HTMLDivElement | null;

    constructor({ onScroll, onReady, i18nService, logger }: {
        onScroll?: (() => void) | null;
        onReady?: ((payload: ConsoleMessagesViewReadyPayload) => void) | null;
        i18nService?: unknown;
        logger?: unknown;
    } = {}) {
        super({ title: 'Console Messages', i18nService: i18nService as any, logger: logger as any });
        this._onScroll = onScroll;
        this._onReady = onReady;
        this._messagesContainer = null;
        this._messagesListDiv = null;
    }

    render(container: HTMLElement): void {
        this._messagesContainer = document.createElement('div');
        this._messagesContainer.className = 'console-messages-container';
        this._messagesContainer.addEventListener('scroll', () => this._onScroll?.());

        this._messagesListDiv = document.createElement('div');
        this._messagesListDiv.className = 'console-messages-list';
        this._messagesContainer.appendChild(this._messagesListDiv);

        container.replaceChildren(this._messagesContainer);

        if (typeof this._onReady === 'function') {
            this._onReady({
                messagesContainer: this._messagesContainer,
                messagesListDiv: this._messagesListDiv,
            });
        }
    }
}

/**
 * ViewBase-compatible console log view with timestamped messages and type-specific icons.
 *
 * Features:
 * - Circular buffer for efficient memory management
 * - Type-based icon mapping
 * - Copy-to-clipboard functionality
 * - Auto-scroll with user override detection
 * - i18n support for UI elements
 *
 * Emitted Events:
 * - `message-added` -> `payloadTypeId: ConsoleLogView.MessageAdded.v1` -> `ConsoleLogViewMessageAddedPayload`
 * - `messages-cleared` -> `payloadTypeId: ConsoleLogView.MessagesCleared.v1` -> `ConsoleLogViewMessagesClearedPayload`
 *
 * @extends ViewBase
 */
export class ConsoleLogView extends ViewBase {
    _maxMessages: number;
    _showTimestamps: boolean;
    _showIcons: boolean;
    _autoScroll: boolean;
    _userHasScrolled: boolean;

    _messages: LogMessage[];
    _messageStartIndex: number;
    _messageTypes: MessageTypeMap;

    _toolbarView: ToolbarView | null;
    _messagesView: ConsoleMessagesView | null;
    _splitView: SplitView | null;
    _messagesContainer: HTMLDivElement | null;
    _messagesListDiv: HTMLDivElement | null;
    _clearButton: HTMLButtonElement | null;
    _copyButton: HTMLButtonElement | null;
    _autoScrollButton: HTMLButtonElement | null;

    _filterState: ConsoleFilterState;
    _activeFilters: Set<string>;
    _filterDropdown: DropdownControl | null;
    _messageCounts: MessageCounts;

    _needsRender: boolean;
    _renderScheduled: number | false;
    /**
     * Create a console log view.
     *
     * @param {object} options - Configuration options
     * @param {number} [options.maxMessages=1000] - Maximum number of messages to store
    * @param {boolean} [options.showTimestamps=false] - Show timestamps for messages
     * @param {boolean} [options.showIcons=true] - Show type icons for messages
     * @param {object} [options.messageTypes={}] - Custom message type configurations
     * @param {boolean} [options.autoScroll=true] - Auto-scroll to new messages
     * @param {object} [options.i18nService] - Internationalization service
     * @param {object} [options.logger] - Logger instance
     */
    constructor({
        maxMessages = 1000,
        showTimestamps = false,
        showIcons = true,
        messageTypes = {},
        autoScroll = true,
        i18nService,
        logger,
        ...rest
    }: ConsoleLogViewOptions = {}) {
        super({
            title: 'Console',
            icon: 'terminal',
            i18nService: i18nService as any,
            logger: logger as any,
            ...rest,
        });

        // Configuration
        this._maxMessages = maxMessages;
        this._showTimestamps = showTimestamps;
        this._showIcons = showIcons;
        this._autoScroll = autoScroll;
        this._userHasScrolled = false; // Track manual scroll

        // Message storage (circular buffer)
        this._messages = [];
        this._messageStartIndex = 0; // Circular buffer head

        // Message types (merge defaults with custom)
        this._messageTypes = {
            ...DEFAULT_MESSAGE_TYPES,
            ...messageTypes,
        };

        // Child views and DOM references (set in render())
        this._toolbarView = null;
        this._messagesView = null;
        this._splitView = null;
        this._messagesContainer = null;
        this._messagesListDiv = null;
        this._clearButton = null;
        this._copyButton = null;
        this._autoScrollButton = null;

        // Filter state
        this._activeFilters = new Set(
            Object.keys(this._messageTypes).filter(
                (type) => type !== MessageType.INFO && type !== MessageType.RAW
            )
        );
        this._filterDropdown = null;
        this._messageCounts = {};
        this._filterState = {
            activeFilters: this._activeFilters,
            messageCounts: this._messageCounts,
        };

        // Render state
        this._needsRender = false;
        this._renderScheduled = false;

        // Initialize message counts
        this._initializeMessageCounts();
    }

    /**
     * Add a message to the console log.
     *
     * @param {string} type - Message type key (must be registered)
     * @param {string} message - Message text content
     * @fires ConsoleLogView#message-added
     */
    addMessage(type: string, message: string): void {
        if (!this._messageTypes[type]) {
            this._log('unknown-message-type', { type, message });
            type = 'info'; // Fallback to info type
        }

        const logMessage = new LogMessage(type, message);

        // Circular buffer logic
        if (this._messages.length >= this._maxMessages) {
            // Overwrite oldest message
            this._messages[this._messageStartIndex] = logMessage;
            this._messageStartIndex = (this._messageStartIndex + 1) % this._maxMessages;
        } else {
            this._messages.push(logMessage);
        }

        this._scheduleRender();
        this._updateMessageCounts();

        this._emit('message-added', new ConsoleLogViewMessageAddedPayload({ message: logMessage }));
    }

    /**
     * Add multiple messages efficiently.
     *
     * @param {Array<{type: string, message: string}>} messages - Array of message objects
     */
    addMessages(messages: AddMessageInput[]): void {
        messages.forEach((msg) => this.addMessage(msg.type, msg.message));
        // Single render scheduled by last addMessage call
    }

    /**
     * Clear all messages from the console.
     *
     * @fires ConsoleLogView#messages-cleared
     */
    clearMessages(): void {
        const clearedCount = this._messages.length;
        this._messages = [];
        this._messageStartIndex = 0;
        this._scheduleRender();
        this._updateMessageCounts();
        this._emit(
            'messages-cleared',
            new ConsoleLogViewMessagesClearedPayload({ clearedCount })
        );
    }

    /**
     * Get all messages in chronological order.
     *
     * @returns {Array<LogMessage>} Array of messages
     */
    getMessages(): LogMessage[] {
        if (this._messages.length === 0) return [];

        // Handle circular buffer wrapping
        if (this._messages.length < this._maxMessages) {
            return [...this._messages];
        } else {
            return [
                ...this._messages.slice(this._messageStartIndex),
                ...this._messages.slice(0, this._messageStartIndex),
            ];
        }
    }

    /**
     * Register a new message type or update an existing one.
     *
     * @param {string} key - Message type key
     * @param {object} config - Configuration object
     * @param {string} [config.icon='info'] - Material icon name
     * @param {string} [config.className='msg-info'] - CSS class for styling
     * @param {string} [config.label] - i18n key for type label
     * @param {string} [config.color] - Text color for this type
     * @param {string} [config.iconFilter] - CSS filter for SVG icon tint
     */
    registerMessageType(key: string, config: MessageTypeConfig): void {
        this._messageTypes[key] = {
            icon: config.icon || 'info',
            iconPath: config.iconPath,
            className: config.className || 'msg-info',
            label: config.label || `console.types.${key}`,
            color: config.color,
            iconFilter: config.iconFilter,
        };
    }

    /**
     * Initialize message counts for all types.
     * @private
     */
    _initializeMessageCounts(): void {
        this._messageCounts = {};
        for (const type of Object.keys(this._messageTypes)) {
            this._messageCounts[type] = 0;
        }
        this._messageCounts[MessageType.ALL] = 0;
    }

    /**
     * Set the active message type filter.
     * @param {string} messageType - MessageType enum value
     * @public
     */
    setFilter(messageType: string): void {
        if (!Object.keys(this._messageTypes).includes(messageType)) {
            this._log('invalid-filter-type', 'warn', { messageType });
            return;
        }

        this.setFilters([messageType]);
    }

    /**
     * Set active message type filters.
     * @param {string[]} messageTypes - Message type keys
     * @public
     */
    setFilters(messageTypes: string[]): void {
        const validTypes = new Set(Object.keys(this._messageTypes));
        const nextFilters = new Set(
            (Array.isArray(messageTypes) ? messageTypes : [])
                .filter(type => validTypes.has(type))
        );

        this._activeFilters = nextFilters;

        // Update dropdown UI
        if (this._filterDropdown) {
            this._filterDropdown.setValue([...this._activeFilters]);
        }

        // Re-render messages with new filter
        this._scheduleRender();

        this._log('filters-changed', 'debug', { messageTypes: [...this._activeFilters] });
    }

    /**
     * Update message counts for filter dropdown.
     * @private
     */
    _updateMessageCounts(): void {
        // Reset counts
        for (const type of Object.keys(this._messageTypes)) {
            this._messageCounts[type] = 0;
        }
        
        // Count messages by type
        const messages = this.getMessages();
        messages.forEach(msg => {
            if (this._messageCounts[msg.type] !== undefined) {
                this._messageCounts[msg.type]++;
            }
        });
        
        // Calculate total for "all"
        this._messageCounts[MessageType.ALL] = messages.length;
        
        // Update dropdown badges
        if (this._filterDropdown) {
            const badges: Record<string, string> = {};
            for (const type of Object.keys(this._messageTypes)) {
                const count = this._messageCounts[type] || 0;
                badges[type] = `(${count})`;
            }
            this._filterDropdown.updateBadges(badges);
        }
    }

    /**
     * Enable or disable auto-scrolling.
     *
     * @param {boolean} enabled - Auto-scroll state
     */
    setAutoScroll(enabled: boolean): void {
        this._autoScroll = enabled;
        if (this._autoScrollButton) {
            this._autoScrollButton.classList.toggle('is-active', enabled);
            this._autoScrollButton.classList.toggle('view-toolbar__btn--highlight', enabled);
        }
        if (enabled) {
            this._scrollToBottom();
        }
    }

    /**
     * Render the console view into the container.
     *
     * @param {HTMLElement} container - Container element
     */
    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'console-log-view';

        // Create toolbar view (compact height)
        this._toolbarView = new ToolbarView({
            title: 'Console Toolbar',
            height: 26,
            layoutMode: 'scroll',
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Create messages view
        this._messagesView = new ConsoleMessagesView({
            i18nService: this._i18nService,
            logger: this._logger,
            onScroll: () => this._onScroll(),
            onReady: ({ messagesContainer, messagesListDiv }: ConsoleMessagesViewReadyPayload) => {
                this._messagesContainer = messagesContainer;
                this._messagesListDiv = messagesListDiv;
                this._renderMessages();
            },
        });

        // Create split layout (toolbar on top, messages below)
        this._splitView = new SplitView({
            orientation: 'vertical',
            views: [this._toolbarView, this._messagesView],
            i18nService: this._i18nService,
            logger: this._logger,
        });

        wrapper.replaceChildren();
        container.replaceChildren(wrapper);
        this._splitView.attachTo(wrapper);

        // Create toolbar controls after rendering
        this._createToolbarControls();
    }

    /**
     * Called after view is attached to container.
     * Subscribe to language changes and perform initial scroll.
     */
    afterAttach(): void {
        super.afterAttach();

        // Subscribe to language changes
        this._subscribeToLanguageChanges(() => {
            this._updateToolbarLabels();
            this._renderMessages(); // Re-render to update timestamps format
        });

        // Scroll to bottom if auto-scroll enabled
        if (this._autoScroll) {
            this._scrollToBottom();
        }
    }

    /**
     * Called before view is detached from container.
     * Clean up scheduled renders.
     */
    beforeDetach(): void {
        // Clear render schedule
        if (this._renderScheduled) {
            cancelAnimationFrame(this._renderScheduled);
            this._renderScheduled = false;
        }

        if (this._splitView) {
            this._splitView.detach();
            this._splitView = null;
        }

        // Clean up filter dropdown
        if (this._filterDropdown) {
            this._filterDropdown.detach();
            this._filterDropdown = null;
        }

        this._toolbarView = null;
        this._messagesView = null;

        super.beforeDetach();
    }

    /**
     * Build filter dropdown options.
     * @returns {Array<object>} Filter options
     * @private
     */
    _buildFilterOptions(): DropdownFilterOption[] {
        const options = Object.entries(this._messageTypes)
            .map(([type, config]) => ({
                value: type,
                label: config.label,
                icon: config.icon,
                iconPath: config.iconPath,
                iconFilter: config.iconFilter,
                badge: `(${this._messageCounts[type] || 0})`,
                order: config.order || 99,
            }))
            .sort((a, b) => a.order - b.order);

        return options;
    }

    /**
     * Create the toolbar with control buttons.
     *
     * @private
     * @returns {HTMLElement} Toolbar element
     */
    _createToolbarControls(): void {
        if (!this._toolbarView) return;

        const clearControl = this._toolbarView.addButton({
            icon: IconProvider.deleteSweep,
            label: this.t('console.actions.clear'),
            onClick: () => this._handleClearClick(),
            className: 'console-btn console-btn-clear',
        }) as ToolbarButtonControl;

        const copyControl = this._toolbarView.addButton({
            icon: IconProvider.contentCopy,
            label: this.t('console.actions.copy'),
            onClick: () => this._handleCopyClick(),
            className: 'console-btn console-btn-copy',
        }) as ToolbarButtonControl;

        const autoScrollControl = this._toolbarView.addButton({
            icon: IconProvider.sync,
            label: this.t('console.actions.autoScroll'),
            onClick: () => this._handleAutoScrollToggle(),
            className: 'console-btn console-btn-autoscroll',
            highlight: this._autoScroll,
        }) as ToolbarButtonControl;

        // Add separator before filter
        this._toolbarView.addSeparator();

        // Build filter options from message types
        const options = this._buildFilterOptions();

        // Create filter dropdown
        this._filterDropdown = new DropdownControl({
            options,
            value: [...this._activeFilters],
            multiSelect: true,
            showIcons: true,
            showBulkActions: true,
            placeholder: 'console.filter.label',
            onChange: (filterTypes: string[]) => this.setFilters(filterTypes),
            buttonClassName: 'console-filter-dropdown',
            i18nService: this._i18nService,
            logger: this._logger,
        } as any);

        // Create container and attach dropdown
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'console-filter-container';
        this._filterDropdown.attachTo(dropdownContainer);

        // Add to toolbar
        this._toolbarView.addElement(dropdownContainer);

        // Render all controls at once (prevents stale references)
        this._toolbarView.renderControls();

        // Extract DOM elements from control objects
        this._clearButton = clearControl.element;
        this._copyButton = copyControl.element;
        this._autoScrollButton = autoScrollControl.element;

        // Set initial auto-scroll state
        if (this._autoScrollButton) {
            this._autoScrollButton.classList.toggle('is-active', this._autoScroll);
        }
    }

    /**
     * Create a DOM element for a single message.
     *
     * @private
     * @param {LogMessage} logMessage - Message to render
     * @returns {HTMLElement} Message element
     */
    _createMessageElement(logMessage: LogMessage): HTMLDivElement {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'console-message';
        messageDiv.dataset.id = logMessage.id;
        messageDiv.dataset.type = logMessage.type;

        const typeConfig = this._messageTypes[logMessage.type];
        if (typeConfig?.className) {
            messageDiv.classList.add(typeConfig.className);
        }
        if (typeConfig?.color) {
            messageDiv.style.color = typeConfig.color;
        }

        // Icon
        if (this._showIcons && (typeConfig?.icon || typeConfig?.iconPath)) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'console-message-icon';
            if (typeConfig?.iconPath) {
                const iconImage = document.createElement('img');
                iconImage.className = 'console-message-icon-image';
                iconImage.src = typeConfig.iconPath;
                iconImage.alt = typeConfig?.label ? this.t(typeConfig.label) : 'otter';
                if (typeConfig?.iconFilter) {
                    iconImage.style.filter = typeConfig.iconFilter;
                }
                iconSpan.appendChild(iconImage);
            } else {
                iconSpan.textContent = this._getIconFallback(typeConfig.icon);
                if (typeConfig?.color) {
                    iconSpan.style.color = typeConfig.color;
                }
            }
            messageDiv.appendChild(iconSpan);
        }

        // Timestamp
        if (this._showTimestamps) {
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'console-message-timestamp';
            timestampSpan.textContent = this._formatTimestamp(logMessage.timestamp);
            messageDiv.appendChild(timestampSpan);
        }

        // Message content
        const jsonPayload = this._tryParseJsonPayload(logMessage.message);
        if (jsonPayload) {
            const contentContainer = document.createElement('div');
            contentContainer.className = 'console-message-content console-message-content--json';

            const details = document.createElement('details');
            details.className = 'console-message-json-details';
            details.open = false;

            const summaryText = this._buildJsonSummary(jsonPayload) || 'JSON payload';
            const summaryDiv = document.createElement('summary');
            summaryDiv.className = 'console-message-json-summary';
            summaryDiv.textContent = summaryText;
            details.appendChild(summaryDiv);

            const pre = document.createElement('pre');
            pre.className = 'console-message-json-pretty';
            pre.textContent = JSON.stringify(jsonPayload, null, 2);
            details.appendChild(pre);

            contentContainer.appendChild(details);

            messageDiv.appendChild(contentContainer);
        } else {
            const contentSpan = document.createElement('span');
            contentSpan.className = 'console-message-content';
            contentSpan.textContent = logMessage.message;
            messageDiv.appendChild(contentSpan);
        }

        return messageDiv;
    }

    _tryParseJsonPayload(message: string): JsonPayload | null {
        if (typeof message !== 'string') {
            return null;
        }
        const trimmed = message.trim();
        if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
            return null;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }

    _buildJsonSummary(payload: JsonPayload): string {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return '';
        }

        const objectPayload = payload as Record<string, unknown>;

        const parts: string[] = [];
        if (objectPayload.event) {
            const phaseSuffix = objectPayload.phase ? `/${String(objectPayload.phase)}` : '';
            parts.push(`${String(objectPayload.event)}${phaseSuffix}`);
        }
        if (objectPayload.message) {
            parts.push(String(objectPayload.message));
        }
        if (objectPayload.host_ip) {
            parts.push(`ip=${String(objectPayload.host_ip)}`);
        }

        return parts.join(' • ');
    }

    /**
     * Get a fallback emoji/unicode icon for message types.
     *
     * @private
     * @param {string} iconName - Material icon name
     * @returns {string} Fallback icon character
     */
    _getIconFallback(iconName?: string): string {
        const fallbacks = {
            info: 'ℹ️',
            error: '❌',
            warning: '⚠️',
            check_circle: '✅',
            person: '👤',
            settings: '⚙️',
            data_object: '📊',
        };
        return fallbacks[iconName] || 'ℹ️';
    }

    /**
     * Schedule a render on the next animation frame.
     *
     * @private
     */
    _scheduleRender(): void {
        if (this._renderScheduled) return;

        this._needsRender = true;
        this._renderScheduled = requestAnimationFrame(() => {
            this._renderScheduled = false;
            if (this._needsRender) {
                this._renderMessages();
                this._needsRender = false;
            }
        });
    }

    /**
     * Render all messages to the DOM.
     *
     * @private
     */
    _renderMessages(): void {
        if (!this._messagesListDiv) return;

        // Clear existing messages
        this._messagesListDiv.replaceChildren();

        // Get messages in chronological order
        const allMessages = this.getMessages();
        let messages = allMessages;

        // Apply filters (multi-select)
        messages = messages.filter(msg => this._activeFilters.has(msg.type));

        if (messages.length === 0) {
            // Show empty state
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'console-empty-state';

            if (allMessages.length === 0) {
                emptyDiv.textContent = this.t('console.empty');
            } else {
                const summary = this._buildAvailableTypeSummary();
                emptyDiv.textContent = summary
                    ? this.t('console.emptyFilteredSummary', { summary })
                    : this.t('console.empty');
            }
            
            this._messagesListDiv.appendChild(emptyDiv);
            return;
        }

        // Render messages
        const fragment = document.createDocumentFragment();
        messages.forEach((msg) => {
            const msgElement = this._createMessageElement(msg);
            fragment.appendChild(msgElement);
        });
        this._messagesListDiv.appendChild(fragment);

        // Auto-scroll if enabled and user hasn't manually scrolled
        if (this._autoScroll && !this._userHasScrolled) {
            // Scroll immediately after DOM update (we're already in requestAnimationFrame)
            this._messagesContainer!.scrollTop = this._messagesContainer!.scrollHeight;
        }
    }

    /**
     * Build summary text of available messages by type.
     * @returns {string} Summary text like "System: 3, User: 1"
     * @private
     */
    _buildAvailableTypeSummary(): string {
        const parts = Object.entries(this._messageTypes)
            .map(([type, config]) => ({
                order: config.order || 99,
                label: this.t(config.label),
                count: this._messageCounts[type] || 0,
            }))
            .filter(entry => entry.count > 0)
            .sort((a, b) => a.order - b.order)
            .map(entry => `${entry.label}: ${entry.count}`);

        return parts.join(', ');
    }

    /**
     * Handle clear button click.
     *
     * @private
     */
    _handleClearClick(): void {
        const count = this._messages.length;
        this.clearMessages();
        this._log('messages-cleared', { count });
    }

    /**
     * Handle copy button click with clipboard API.
     *
     * @private
     */
    async _handleCopyClick(): Promise<void> {
        const messages = this.getMessages();
        if (messages.length === 0) return;

        const text = messages.map((msg) => msg.toString()).join('\n');

        try {
            await navigator.clipboard.writeText(text);
            this._showCopyFeedback(true);
            this._log('messages-copied', { count: messages.length });
        } catch (error) {
            this._showCopyFeedback(false);
            this._log('copy-failed', { error: (error as Error).message });
        }
    }

    /**
     * Toggle auto-scroll on/off.
     * @private
     */
    _handleAutoScrollToggle(): void {
        const nextValue = !this._autoScroll;
        this.setAutoScroll(nextValue);
    }

    /**
     * Show visual feedback for copy operation.
     *
     * @private
     * @param {boolean} success - Whether copy succeeded
     */
    _showCopyFeedback(success: boolean): void {
        const feedbackText = success
            ? this.t('console.actions.copied')
            : this.t('console.actions.copyFailed');

        const copyButton = this._copyButton!;
        const originalTitle = copyButton.title;
        const originalAria = copyButton.getAttribute('aria-label') || '';

        copyButton.title = feedbackText;
        copyButton.setAttribute('aria-label', feedbackText);
        copyButton.classList.add(success ? 'success' : 'error');

        setTimeout(() => {
            copyButton.title = originalTitle;
            copyButton.setAttribute('aria-label', originalAria);
            copyButton.classList.remove('success', 'error');
        }, 1500);
    }

    /**
     * Handle scroll events to detect manual scrolling.
     *
     * @private
     */
    _onScroll(): void {
        if (!this._autoScroll) return;

        // Detect if user scrolled away from bottom
        const container = this._messagesContainer!;
        const threshold = 50; // pixels from bottom
        const atBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

        this._userHasScrolled = !atBottom;
    }

    /**
     * Scroll messages container to bottom.
     *
     * @private
     */
    _scrollToBottom(): void {
        if (!this._messagesContainer) return;

        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            this._messagesContainer!.scrollTop = this._messagesContainer!.scrollHeight;
            this._userHasScrolled = false;
        });
    }

    /**
     * Format a timestamp for display.
     *
     * @private
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string} Formatted time string
     */
    _formatTimestamp(timestamp: number): string {
        const date = new Date(timestamp);

        // Use locale from i18n service if available
        const locale = (this._i18nService as { currentLocale?: string } | null)?.currentLocale || 'en';

        return date.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    }

    /**
     * Update toolbar button labels (for i18n changes).
     *
     * @private
     */
    _updateToolbarLabels(): void {
        if (!this._clearButton) return;

        const clearLabel = this.t('console.actions.clear');
        this._clearButton.title = clearLabel;
        this._clearButton.setAttribute('aria-label', clearLabel);

        const copyLabel = this.t('console.actions.copy');
        this._copyButton.title = copyLabel;
        this._copyButton.setAttribute('aria-label', copyLabel);

        const autoScrollLabel = this.t('console.actions.autoScroll');
        this._autoScrollButton.title = autoScrollLabel;
        this._autoScrollButton.setAttribute('aria-label', autoScrollLabel);

        // Update filter dropdown options with new translations
        if (this._filterDropdown) {
            const options = this._buildFilterOptions();
            this._filterDropdown.setOptions(options);
        }
    }

    /**
     * Serialize view state to JSON.
     *
     * @returns {object} Serialized state
     */
    serialize(): ReturnType<ViewBase['serialize']> {
        return {
            type: 'ConsoleLogView',
            maxMessages: this._maxMessages,
            showTimestamps: this._showTimestamps,
            showIcons: this._showIcons,
            autoScroll: this._autoScroll,
            messageTypes: this._messageTypes,
            // Note: Do NOT serialize message content - transient data
        } as unknown as ReturnType<ViewBase['serialize']>;
    }

    /**
     * Restore view state from serialized data.
     *
     * @param {object} data - Serialized state
     * @param {object} context - Deserialization context
     */
    deserialize(data: Partial<ConsoleLogViewSerializedState>, context: Record<string, unknown>): void {
        void context;
        this._maxMessages = data.maxMessages ?? this._maxMessages;
        this._showTimestamps = data.showTimestamps ?? this._showTimestamps;
        this._showIcons = data.showIcons ?? this._showIcons;
        this._autoScroll = data.autoScroll ?? this._autoScroll;

        if (data.messageTypes) {
            this._messageTypes = {
                ...DEFAULT_MESSAGE_TYPES,
                ...data.messageTypes,
            };
        }

        // Messages are NOT restored - they are transient runtime data
    }
}
