import { INLINED_ICONS } from './icon-data.generated.js';

/**
 * IconProvider - Centralized icon registry for the Micro-Otter UI.
 *
 * Provides static accessors for all available icons with automatic path resolution.
 * All icons from the html/icons folder are registered here for consistent usage.
 *
 * Registered SVG icons are inlined as `data:` URIs (see `icon-data.generated.js`), so
 * an icon that is rendered after the server went away still displays. The URL form
 * stays available through `getPath()` for non-`<img src>` consumers and for the
 * PNG/ICO brand images, which are not inlined.
 *
 * Usage examples:
 *   - As URL/URI string: IconProvider.add
 *   - As property: IconProvider.closeButton
 *   - Dynamically: IconProvider.get('add')
 *   - URL form: IconProvider.getPath('add')
 *   - Check existence: IconProvider.has('customIcon')
 *
 * @example
 * // Direct property access
 * img.src = IconProvider.close;
 * tabbed.setControls([{ id: 'add', icon: IconProvider.add }]);
 *
 * @example
 * // Dynamic access
 * const iconName = 'wifi';
 * if (IconProvider.has(iconName)) {
 *     img.src = IconProvider.get(iconName);
 * }
 */

const ICON_REGISTRY = {
    // Actions
    add: 'add_24dp.svg',
    addCollection: 'add_collection_24dp.svg',
    alignToGrid: 'grid_on_24dp.svg',
    close: 'close_24dp.svg',
    contentCopy: 'content_copy_24dp.svg',
    contentCut: 'content_cut_24dp.svg',
    contentPaste: 'content_paste_24dp.svg',
    delete: 'delete_24dp.svg',
    deleteImage: 'delete_image_24dp.svg',
    deleteSweep: 'delete_sweep_24dp.svg',
    refresh: 'refresh_24dp.svg',
    reload: 'reload_24dp.svg',
    trayArrowUp: 'tray_arrow_up_24dp.svg',
    checkboxMultipleMarked: 'checkbox_multiple_marked_24dp.svg',
    checkboxMultipleBlankOutline: 'checkbox_multiple_blank_outline_24dp.svg',
    filterMinusOutline: 'filter_minus_outline_24dp.svg',
    edit: 'edit_24dp.svg',
    fileCopy: 'file_copy_24dp.svg',
    save: 'save_24dp.svg',
    fileSave: 'file_save_24dp4.svg',
    fileOpen: 'file_open_24dp.svg',
    undo: 'undo_24dp.svg',
    redo: 'redo_24dp.svg',

    // Navigation & UI
    arrowDropUp: 'arrow_drop_up_24dp.svg',
    archive: 'archive_24dp.svg',
    unarchive: 'unarchive_24dp.svg',
    menu: 'menu_24dp.svg',
    exitToApp: 'exit_to_app_24dp.svg',
    language: 'language_24dp.svg',
    node: 'node_24dp.svg',
    arrowUpward: 'arrow_upward_24dp.svg',
    arrowDownward: 'arrow_downward_24dp.svg',
    formatSize: 'format_size_24dp.svg',
    arrowSplit: 'arrow_split_24dp.svg',
    compareArrows: 'compare_arrows_24dp.svg',
    compareNode: 'compare_arrows_24dp.svg',
    logicNode: 'logic_ampersand_24dp.svg',
    keyboardArrowUp: 'keyboard_arrow_up_24dp.svg',
    keyboardArrowDown: 'keyboard_arrow_down_24dp.svg',
    keyboardDoubleArrowUp: 'keyboard_double_arrow_up_24dp.svg',

    // Connectivity
    cable: 'cable_24dp.svg',
    connect: 'connect_24dp.svg',
    serialConnect: 'serial_connect_24dp.svg',
    wifi: 'wifi_24dp.svg',
    wifiOff: 'wifi_off_24dp.svg',
    bluetooth: 'bluetooth_24dp.svg',
    bluetoothDisabled: 'bluetooth_disabled_24dp.svg',

    // File operations
    upload: 'upload_24dp.svg',
    uploadFile: 'upload_file_24dp.svg',
    download: 'download_24dp.svg',
    cloudDownload: 'cloud_download_24dp.svg',
    cloudOff: 'cloud_off_24dp.svg',

    // Development
    codeGenerator: 'code_generator_24dp.svg',
    nodeLibrary: 'node_library_24dp.svg',
    colorize: 'colorize_24dp.svg',
    sync: 'sync_24dp.svg',

    // Deployment
    deployCollection: 'deploy_collection_24dp.svg',
    syncCollection: 'sync_collection_24dp.svg',
    removeCollection: 'remove_collection_24dp.svg',
    deployedCode: 'deployed_code_24dp.svg',
    installRuntime: 'install_runtime_24dp.svg',
    removeRuntime: 'remove_runtime_24dp.svg',
    memory: 'memory_24dp.svg',

    // Status & feedback
    info: 'info_24dp.svg',
    error: 'error_24dp.svg',
    warning: 'warning_24dp.svg',
    calculate: 'calculate_24dp.svg',
    checkCircle: 'check_circle_24dp.svg',
    dataObject: 'data_object_24dp.svg',
    filterList: 'filter_list_24dp.svg',
    heartCheck: 'heart_check_24dp.svg',
    pauseCircle: 'pause_circle_24dp.svg',
    playArrow: 'play_arrow_24dp.svg',
    stop: 'stop_24dp.svg',
    restart: 'restart_24dp.svg',
    hardReset: 'hard_reset_24dp.svg',

    // Firmware inventory badges
    arrowUpBold: 'arrow_up_bold_24dp.svg',
    newBox: 'new_box_24dp.svg',
    moonFull: 'moon_full_24dp.svg',
    circleHalfFull: 'circle_half_full_24dp.svg',
    progressQuestion: 'progress_question_24dp.svg',
    plusCircleOutline: 'plus_circle_outline_24dp.svg',
    check: 'check_24dp.svg',

    // Function graphs
    input: 'input_24dp.svg',
    output: 'output_24dp.svg',

    // Device & hardware
    hardDrive: 'hard_drive_24dp.svg',
    time: 'time_24dp.svg',
    settings: 'settings_24dp.svg',
    person: 'person_24dp.svg',

    // Target capabilities
    pwm: 'vital_signs_24dp.svg',
    pwmInput: 'pwm_input_24dp.svg',
    pwmOutput: 'pwm_output_24dp.svg',
    pwmInOut: 'pwm_in_out_24dp.svg',
    digitalInput: 'digital_input_24dp.svg',
    digitalOutput: 'digital_output_24dp.svg',
    digitalInOut: 'digital_in_out_24dp.svg',
    digitalInputLegacy: 'digital_input_24dp.svg',
    digitalOutputLegacy: 'digital_output_24dp.svg',
    digitalInOutLegacy: 'digital_in_out_24dp.svg',
    pullUp: 'pull_up_24dp.svg',
    pullDown: 'pull_down_24dp.svg',
    pullUpDown: 'pull_up_down_24dp.svg',
    adc: 'blood_pressure_24dp.svg',
    spiInput: 'spi_input_24dp.svg',
    spiOutput: 'spi_output_24dp.svg',
    i2cInput: 'i2c_input_24dp.svg',
    i2cOutput: 'i2c_output_24dp.svg',
    i2cSda: 'i2c_sda_24dp.svg',
    i2cScl: 'i2c_scl_24dp.svg',
    spiMosi: 'spi_mosi_24dp.svg',
    spiMiso: 'spi_miso_24dp.svg',
    spiSck: 'spi_sck_24dp.svg',
    spiCs: 'spi_cs_24dp.svg',
    serialIn: 'serial_input_24dp.svg',
    serialOut: 'serial_output_24dp.svg',
    i2s: 'i2s_24dp.svg',
    i2sDout: 'i2s_dout_24dp.svg',
    i2sDin: 'i2s_din_24dp.svg',
    i2sBclk: 'i2s_bclk_24dp.svg',
    i2sWs: 'i2s_ws_24dp.svg',
    i2sMclk: 'i2s_mclk_24dp.svg',
    spi: 'spi_24dp.svg',
    i2c: 'i2c_24dp.svg',
    uart: 'uart_24dp.svg',
    touch: 'blood_pressure_24dp.svg',
    dac: 'pwm_output_24dp.svg',
    rtc: 'time_24dp.svg',
    irq: 'bolt_24dp.svg',

    // Branding
    otterHead64: 'micro-otter-head-64px.svg',
    otterHead64Png: 'micro-otter-head-64px.png',
    otterHead64Ico: 'micro-otter-head-64px.ico',
    otterHeadPng: 'micro-otter-head.png',
    otterWhite128: 'micro-otter-white-128px.svg',

    // Node Palette
    palette: 'palette_24dp.svg',
    sortByAlpha: 'sort_by_alpha_24dp.svg',
    nodePackage: 'node_package_24dp.svg',
    nodeCategory: 'node_category_24dp.svg',
    nodeTypeUiSelectSmall: 'node_type_ui_select_small_24dp.svg',
    nodeTypeUiSelectLarge: 'node_type_ui_select_large_24dp.svg',
    selectAll: 'select_all_24dp.svg',
} as const;

type IconName = keyof typeof ICON_REGISTRY;

/** Classification of an icon value into its rendering form. */
export type IconDescription =
    | { kind: 'image'; src: string }
    | { kind: 'mdi'; value: string }
    | { kind: 'text'; glyph: string };

export class IconProvider {
    static #basePath: string = '/html/icons';

    // Icon registry - maps logical names to filenames
    static #icons: typeof ICON_REGISTRY = ICON_REGISTRY;

    /**
     * Get an icon by name: the inlined `data:` URI when one exists, the URL otherwise.
     *
     * The URL fallback serves the brand PNG/ICO images, which are not inlined. Use this
     * method for every `<img src>`/`icon` value: it keeps working without the server.
     * @param {string} name - Icon name (e.g., 'add', 'close', 'arrowDropUp')
     * @returns {string} Inlined `data:` URI, or the icon URL when the file is not inlined
     * @throws {Error} If icon name not found in registry
     */
    static get(name: string): string {
        const filename = this.#resolveFilename(name);
        return INLINED_ICONS[name] ?? `${this.#basePath}/${filename}`;
    }

    /**
     * Get the URL form of an icon by name.
     *
     * This is the served path (`<basePath>/<file>`), for consumers that need a URL
     * rather than an inlined document - and the answer for the PNG/ICO brand images.
     * Inlined entries answer a `data:` URI from `get()` instead.
     * @param {string} name - Icon name (e.g., 'add', 'close', 'arrowDropUp')
     * @returns {string} URL of the icon file below the base path
     * @throws {Error} If icon name not found in registry
     */
    static getPath(name: string): string {
        return `${this.#basePath}/${this.#resolveFilename(name)}`;
    }

    /**
     * Resolve the registered file name of an icon.
     * @param {string} name - Icon name to look up.
     * @returns {string} File name from the registry.
     * @throws {Error} If icon name not found in registry
     */
    static #resolveFilename(name: string): string {
        const filename = this.#icons[name as IconName];
        if (!filename) {
            const available = this.getAvailableIcons().join(', ');
            throw new Error(`Icon '${name}' not found in registry. Available icons: ${available}`);
        }
        return filename;
    }

    /**
     * Get all registered icon names.
     * @returns {string[]} Array of icon names (sorted alphabetically)
     */
    static getAvailableIcons(): string[] {
        return Object.keys(this.#icons).sort();
    }

    /**
     * Check if an icon exists in the registry.
     * @param {string} name - Icon name to check
     * @returns {boolean} True if icon exists
     */
    static has(name: string): boolean {
        return name in this.#icons;
    }

    /**
     * Decide whether an icon value is an image source rather than a text/emoji glyph.
     *
     * Consumers that put an icon into an `<img>` must ask this instead of testing for a file
     * extension: `get()` answers inlined `data:` URIs for every registered SVG, and only the
     * PNG/ICO brand images keep a served path. An extension-only test classifies an inlined
     * icon as text and prints the whole base64 document into the UI.
     * @param {string} value - Icon value as handed to a view, tab, menu entry, or control
     * @returns {boolean} True for a `data:` URI, any other URI scheme, a rooted or relative
     *     path, or a value ending in a known image extension
     */
    static isImageSource(value: string): boolean {
        if (typeof value !== 'string') {
            return false;
        }
        const icon = value.trim();
        if (!icon) {
            return false;
        }
        if (/^data:image\//i.test(icon)) {
            return true;
        }
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(icon)) {
            return true;
        }
        if (icon.startsWith('/') || icon.startsWith('./') || icon.startsWith('../')) {
            return true;
        }
        return /\.(?:svg|png|jpe?g|gif|webp|ico)(?:[?#].*)?$/i.test(icon);
    }

    /**
     * Classify an icon value into its rendering form.
     *
     * The `mdi:` check runs first and is mandatory: `isImageSource()` matches the `mdi:` scheme as
     * a generic URI, so an MDI value must never reach that branch — MDI glyphs are font glyphs,
     * not images.
     *
     * The image branch is deliberately narrower than `isImageSource()`: a foreign icon set such as
     * `ph:` or `hue:` is a `<set>:<name>` value, not an image URL, so it must fall through to
     * `text` rather than being handed to an `<img>`.
     * @param value - Icon value as stored on a node or signature.
     * @returns `image` (a registered name resolved to its `data:` URI, or a `data:`/URL/path/
     *     image-extension source), `mdi` (the value string), or `text` (the value as a glyph).
     */
    static describeIcon(value: string): IconDescription {
        const icon = typeof value === 'string' ? value.trim() : '';

        if (/^mdi:/i.test(icon)) {
            return { kind: 'mdi', value: icon };
        }

        if (IconProvider.has(icon)) {
            return { kind: 'image', src: IconProvider.get(icon) };
        }

        if (
            /^data:image\//i.test(icon) ||
            /^(?:https?:)?\/\//i.test(icon) ||
            icon.startsWith('/') ||
            icon.startsWith('./') ||
            icon.startsWith('../') ||
            /\.(?:svg|png|jpe?g|gif|webp|ico)(?:[?#].*)?$/i.test(icon)
        ) {
            return { kind: 'image', src: icon };
        }

        return { kind: 'text', glyph: icon };
    }

    /**
     * Set custom base path (useful for different deployment contexts).
     *
     * The base path affects `getPath()` only; inlined `data:` URIs from `get()` are never
     * rewritten.
     * @param {string} path - New base path (without trailing slash)
     */
    static setBasePath(path: string): void {
        this.#basePath = path;
    }

    /**
     * Get current base path.
     *
     * Used for the URL form of an icon (`getPath()`); inlined entries answer a `data:` URI
     * regardless of the base path.
     * @returns {string} Current base path
     */
    static getBasePath(): string {
        return this.#basePath;
    }

    // Convenience getters for commonly used icons
    // These provide IDE autocomplete and type safety

    static get add(): string {
        return this.get('add');
    }

    static get addCollection(): string {
        return this.get('addCollection');
    }

    static get alignToGrid(): string {
        return this.get('alignToGrid');
    }

    static get close(): string {
        return this.get('close');
    }

    static get delete(): string {
        return this.get('delete');
    }

    static get save(): string {
        return this.get('save');
    }

    static get fileSave(): string {
        return this.get('fileSave');
    }

    static get fileOpen(): string {
        return this.get('fileOpen');
    }

    static get arrowDropUp(): string {
        return this.get('arrowDropUp');
    }

    static get archive(): string {
        return this.get('archive');
    }

    static get unarchive(): string {
        return this.get('unarchive');
    }

    static get menu(): string {
        return this.get('menu');
    }

    static get language(): string {
        return this.get('language');
    }

    static get exitToApp(): string {
        return this.get('exitToApp');
    }

    static get node(): string {
        return this.get('node');
    }

    static get arrowUpward(): string {
        return this.get('arrowUpward');
    }

    static get arrowDownward(): string {
        return this.get('arrowDownward');
    }

    static get formatSize(): string {
        return this.get('formatSize');
    }

    static get arrowSplit(): string {
        return this.get('arrowSplit');
    }

    static get compareArrows(): string {
        return this.get('compareArrows');
    }

    static get compareNode(): string {
        return this.get('compareNode');
    }

    static get logicNode(): string {
        return this.get('logicNode');
    }

    static get keyboardArrowUp(): string {
        return this.get('keyboardArrowUp');
    }

    static get keyboardArrowDown(): string {
        return this.get('keyboardArrowDown');
    }

    static get keyboardDoubleArrowUp(): string {
        return this.get('keyboardDoubleArrowUp');
    }

    static get cable(): string {
        return this.get('cable');
    }

    static get deleteSweep(): string {
        return this.get('deleteSweep');
    }

    static get contentCopy(): string {
        return this.get('contentCopy');
    }

    static get contentCut(): string {
        return this.get('contentCut');
    }

    static get contentPaste(): string {
        return this.get('contentPaste');
    }

    static get edit(): string {
        return this.get('edit');
    }

    static get fileCopy(): string {
        return this.get('fileCopy');
    }

    static get connect(): string {
        return this.get('connect');
    }

    static get serialConnect(): string {
        return this.get('serialConnect');
    }

    static get wifi(): string {
        return this.get('wifi');
    }

    static get wifiOff(): string {
        return this.get('wifiOff');
    }

    static get bluetooth(): string {
        return this.get('bluetooth');
    }

    static get bluetoothDisabled(): string {
        return this.get('bluetoothDisabled');
    }

    static get upload(): string {
        return this.get('upload');
    }

    static get uploadFile(): string {
        return this.get('uploadFile');
    }

    static get download(): string {
        return this.get('download');
    }

    static get cloudDownload(): string {
        return this.get('cloudDownload');
    }

    /**
     * The "no server" glyph, used by the title-bar server badge.
     *
     * `cloud_off` replaced `link_off` in M4t so the server badge and the device
     * badge (`cable`) no longer share a glyph.
     * @returns {string} The inlined `data:` URI for `cloud_off_24dp.svg`.
     */
    static get cloudOff(): string {
        return this.get('cloudOff');
    }

    static get codeGenerator(): string {
        return this.get('codeGenerator');
    }

    static get nodeLibrary(): string {
        return this.get('nodeLibrary');
    }

    static get colorize(): string {
        return this.get('colorize');
    }

    static get sync(): string {
        return this.get('sync');
    }

    static get deployCollection(): string {
        return this.get('deployCollection');
    }

    static get syncCollection(): string {
        return this.get('syncCollection');
    }

    static get removeCollection(): string {
        return this.get('removeCollection');
    }

    static get installRuntime(): string {
        return this.get('installRuntime');
    }

    /** Deployed-code glyph for the Build button. */
    static get deployedCode(): string {
        return this.get('deployedCode');
    }

    static get memory(): string {
        return this.get('memory');
    }

    static get removeRuntime(): string {
        return this.get('removeRuntime');
    }

    static get info(): string {
        return this.get('info');
    }

    static get error(): string {
        return this.get('error');
    }

    static get warning(): string {
        return this.get('warning');
    }

    static get checkCircle(): string {
        return this.get('checkCircle');
    }

    static get dataObject(): string {
        return this.get('dataObject');
    }

    static get filterList(): string {
        return this.get('filterList');
    }

    static get heartCheck(): string {
        return this.get('heartCheck');
    }

    static get pauseCircle(): string {
        return this.get('pauseCircle');
    }

    static get playArrow(): string {
        return this.get('playArrow');
    }

    static get stop(): string {
        return this.get('stop');
    }

    static get restart(): string {
        return this.get('restart');
    }

    static get hardReset(): string {
        return this.get('hardReset');
    }

    static get hardDrive(): string {
        return this.get('hardDrive');
    }

    static get time(): string {
        return this.get('time');
    }

    static get settings(): string {
        return this.get('settings');
    }

    static get person(): string {
        return this.get('person');
    }

    static get pwm(): string {
        return this.get('pwm');
    }

    static get pwmInput(): string {
        return this.get('pwmInput');
    }

    static get pwmOutput(): string {
        return this.get('pwmOutput');
    }

    static get pwmInOut(): string {
        return this.get('pwmInOut');
    }

    static get digitalInput(): string {
        return this.get('digitalInput');
    }

    static get digitalOutput(): string {
        return this.get('digitalOutput');
    }

    static get digitalInOut(): string {
        return this.get('digitalInOut');
    }

    static get digitalInputLegacy(): string {
        return this.get('digitalInputLegacy');
    }

    static get digitalOutputLegacy(): string {
        return this.get('digitalOutputLegacy');
    }

    static get digitalInOutLegacy(): string {
        return this.get('digitalInOutLegacy');
    }

    static get pullUp(): string {
        return this.get('pullUp');
    }

    static get pullDown(): string {
        return this.get('pullDown');
    }

    static get pullUpDown(): string {
        return this.get('pullUpDown');
    }

    static get adc(): string {
        return this.get('adc');
    }

    static get i2s(): string {
        return this.get('i2s');
    }

    static get spi(): string {
        return this.get('spi');
    }

    static get i2c(): string {
        return this.get('i2c');
    }

    static get uart(): string {
        return this.get('uart');
    }

    static get i2sDout(): string {
        return this.get('i2sDout');
    }

    static get i2sDin(): string {
        return this.get('i2sDin');
    }

    static get i2sBclk(): string {
        return this.get('i2sBclk');
    }

    static get i2sWs(): string {
        return this.get('i2sWs');
    }

    static get i2sMclk(): string {
        return this.get('i2sMclk');
    }

    static get touch(): string {
        return this.get('touch');
    }

    static get dac(): string {
        return this.get('dac');
    }

    static get rtc(): string {
        return this.get('rtc');
    }

    static get irq(): string {
        return this.get('irq');
    }

    static get spiInput(): string {
        return this.get('spiInput');
    }

    static get spiOutput(): string {
        return this.get('spiOutput');
    }

    static get i2cInput(): string {
        return this.get('i2cInput');
    }

    static get i2cOutput(): string {
        return this.get('i2cOutput');
    }

    static get i2cSda(): string {
        return this.get('i2cSda');
    }

    static get i2cScl(): string {
        return this.get('i2cScl');
    }

    static get spiMosi(): string {
        return this.get('spiMosi');
    }

    static get spiMiso(): string {
        return this.get('spiMiso');
    }

    static get spiSck(): string {
        return this.get('spiSck');
    }

    static get spiCs(): string {
        return this.get('spiCs');
    }

    static get serialIn(): string {
        return this.get('serialIn');
    }

    static get serialOut(): string {
        return this.get('serialOut');
    }

    static get otterHead64(): string {
        return this.get('otterHead64');
    }

    static get otterHead64Png(): string {
        return this.get('otterHead64Png');
    }

    static get otterHead64Ico(): string {
        return this.get('otterHead64Ico');
    }

    static get otterHeadPng(): string {
        return this.get('otterHeadPng');
    }

    static get otterWhite128(): string {
        return this.get('otterWhite128');
    }

    static get palette(): string {
        return this.get('palette');
    }

    static get sortByAlpha(): string {
        return this.get('sortByAlpha');
    }

    static get nodePackage(): string {
        return this.get('nodePackage');
    }

    static get nodeCategory(): string {
        return this.get('nodeCategory');
    }

    static get nodeTypeUiSelectSmall(): string {
        return this.get('nodeTypeUiSelectSmall');
    }

    static get nodeTypeUiSelectLarge(): string {
        return this.get('nodeTypeUiSelectLarge');
    }

    static get selectAll(): string {
        return this.get('selectAll');
    }

    static get undo(): string {
        return this.get('undo');
    }

    static get redo(): string {
        return this.get('redo');
    }

    static get refresh(): string {
        return this.get('refresh');
    }

    static get reload(): string {
        return this.get('reload');
    }

    static get trayArrowUp(): string {
        return this.get('trayArrowUp');
    }

    static get deleteImage(): string {
        return this.get('deleteImage');
    }

    static get checkboxMultipleMarked(): string {
        return this.get('checkboxMultipleMarked');
    }

    static get checkboxMultipleBlankOutline(): string {
        return this.get('checkboxMultipleBlankOutline');
    }

    static get filterMinusOutline(): string {
        return this.get('filterMinusOutline');
    }

    static get arrowUpBold(): string {
        return this.get('arrowUpBold');
    }

    static get newBox(): string {
        return this.get('newBox');
    }

    static get moonFull(): string {
        return this.get('moonFull');
    }

    static get circleHalfFull(): string {
        return this.get('circleHalfFull');
    }

    static get progressQuestion(): string {
        return this.get('progressQuestion');
    }

    static get plusCircleOutline(): string {
        return this.get('plusCircleOutline');
    }

    static get check(): string {
        return this.get('check');
    }
}
