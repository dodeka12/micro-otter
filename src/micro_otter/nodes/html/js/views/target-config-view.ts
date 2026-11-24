import { ViewBase } from './view-base.js';
import { ToolbarView } from './toolbar-view.js';
import { SplitView } from './split-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { ContentView } from './content-view.js';
import { IconProvider } from './icon-provider.js';
import { DeviceTargetInfo, comparePinId } from '../data/device-target.js';
import type { PinCapability } from '../data/device-target.js';
import type { CapabilityDescriptor } from '../data/capability-registry.js';
import { assertAppEventPayloadType } from '../core/app-event.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type Unsubscribe = (() => void) | null;

interface AppEventLike<TDetail = unknown> {
    name?: string;
    detail?: TDetail;
}

interface CollectionManagerActiveCollectionChangedPayload {
    payloadTypeId: 'CollectionManager.ActiveCollectionChanged.v1';
    collectionId: string | null;
}

interface CollectionTargetIdChangedPayload {
    payloadTypeId: 'Collection.TargetIdChanged.v1';
    collectionId: string;
    targetId: string | null;
}

interface CollectionLike {
    getTargetId: () => string | null;
    getDeviceRuntimeId: () => string | null;
    on: (eventName: string, listener: (event: AppEventLike) => void) => Unsubscribe;
}

interface CollectionManagerLike {
    getActiveCollection: () => CollectionLike | null;
    on: (eventName: string, listener: (event: AppEventLike) => void) => Unsubscribe;
}

interface RuntimeLike {
    getDeviceTarget?: (targetId: string) => DeviceTargetInfo | null;
    getCompileTarget?: (targetId: string) => { board: string; port: string } | null;
}

interface RuntimeCollectionLike {
    getRuntime?: (runtimeId: string) => RuntimeLike | null;
}

interface WorkspaceLike {
    runtimeCollection?: RuntimeCollectionLike | null;
    getUserTargetConfig?: (
        id: string
    ) => Promise<{ targetData?: Record<string, unknown> | null } | null>;
}

interface TargetConfigViewOptions {
    workspace: WorkspaceLike;
    collectionManager: CollectionManagerLike;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    title?: string;
    icon?: string;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

type CapabilityIconFamily =
    | 'pwm'
    | 'digital'
    | 'pull'
    | 'adc'
    | 'spi'
    | 'i2c'
    | 'serial'
    | 'i2s'
    | 'touch'
    | 'dac'
    | 'rtc';

interface CapabilityIconSpec {
    key: string;
    icon: string;
    tooltip: string;
    family: CapabilityIconFamily;
}

interface CapabilityIconLegendEntry {
    family: CapabilityIconFamily;
    icon: string;
    label: string;
    meaning: string;
}

const CAPABILITY_ICON_LEGEND: CapabilityIconLegendEntry[] = [
    { family: 'digital', icon: IconProvider.digitalInOut, label: 'Digital I/O', meaning: 'Readable and writable digital pin' },
    { family: 'digital', icon: IconProvider.digitalInput, label: 'Digital Input', meaning: 'Readable digital pin' },
    { family: 'digital', icon: IconProvider.digitalOutput, label: 'Digital Output', meaning: 'Writable digital pin' },
    { family: 'digital', icon: IconProvider.irq, label: 'Interrupt (IRQ)', meaning: 'Pin can raise a hardware interrupt on an edge or level' },
    { family: 'pwm', icon: IconProvider.pwmInOut, label: 'PWM I/O', meaning: 'Pulse-width modulation, input and output' },
    { family: 'pwm', icon: IconProvider.pwmInput, label: 'PWM Input', meaning: 'Measures pulse width / frequency' },
    { family: 'pwm', icon: IconProvider.pwmOutput, label: 'PWM Output', meaning: 'Drives a duty-cycle signal' },
    { family: 'pull', icon: IconProvider.pullUpDown, label: 'Pull Up/Down', meaning: 'Internal pull-up and pull-down resistors' },
    { family: 'pull', icon: IconProvider.pullUp, label: 'Pull Up', meaning: 'Internal pull-up resistor' },
    { family: 'pull', icon: IconProvider.pullDown, label: 'Pull Down', meaning: 'Internal pull-down resistor' },
    { family: 'adc', icon: IconProvider.adc, label: 'ADC', meaning: 'Analog-to-digital converter (analog input)' },
    { family: 'dac', icon: IconProvider.dac, label: 'DAC', meaning: 'Digital-to-analog converter (analog output)' },
    { family: 'touch', icon: IconProvider.touch, label: 'Touch', meaning: 'Capacitive touch sensor' },
    { family: 'spi', icon: IconProvider.spiMiso, label: 'SPI MISO', meaning: 'SPI master-in, slave-out' },
    { family: 'spi', icon: IconProvider.spiMosi, label: 'SPI MOSI', meaning: 'SPI master-out, slave-in' },
    { family: 'spi', icon: IconProvider.spiSck, label: 'SPI SCK', meaning: 'SPI serial clock' },
    { family: 'spi', icon: IconProvider.spiCs, label: 'SPI CS', meaning: 'SPI chip select' },
    { family: 'spi', icon: IconProvider.spi, label: 'SPI', meaning: 'SPI — any role assignable' },
    { family: 'i2c', icon: IconProvider.i2cSda, label: 'I2C SDA', meaning: 'I2C data line' },
    { family: 'i2c', icon: IconProvider.i2cScl, label: 'I2C SCL', meaning: 'I2C clock line' },
    { family: 'i2c', icon: IconProvider.i2c, label: 'I2C', meaning: 'I2C — any role assignable' },
    { family: 'serial', icon: IconProvider.serialIn, label: 'Serial RX', meaning: 'UART receive (serial input)' },
    { family: 'serial', icon: IconProvider.serialOut, label: 'Serial TX', meaning: 'UART transmit (serial output)' },
    { family: 'serial', icon: IconProvider.uart, label: 'UART / Serial', meaning: 'UART — any role assignable' },
    { family: 'i2s', icon: IconProvider.i2sDout, label: 'I2S Data Out', meaning: 'I2S serial data out (TX)' },
    { family: 'i2s', icon: IconProvider.i2sDin, label: 'I2S Data In', meaning: 'I2S serial data in (RX)' },
    { family: 'i2s', icon: IconProvider.i2sBclk, label: 'I2S Bit Clock', meaning: 'I2S bit clock' },
    { family: 'i2s', icon: IconProvider.i2sWs, label: 'I2S Word Select', meaning: 'I2S word select / left-right clock' },
    { family: 'i2s', icon: IconProvider.i2sMclk, label: 'I2S Master Clock', meaning: 'I2S master clock' },
    { family: 'i2s', icon: IconProvider.i2s, label: 'I2S', meaning: 'I2S — any role assignable' },
    { family: 'rtc', icon: IconProvider.rtc, label: 'RTC GPIO', meaning: 'Real-time clock / low-power GPIO' },
];

interface ConnectivityStatusSpec {
    key: 'wifi' | 'bluetooth';
    label: string;
    supported: boolean;
    icon: string;
}

function normalizeCapabilityValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '—';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function capabilityIsSupported(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return false;
    }
    const supported = (value as { supported?: unknown }).supported;
    return supported === true;
}

function formatMathCapabilities(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return normalizeCapabilityValue(value);
    }

    const ignoredKeys = new Set(['notes', 'note']);
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
    );
    const formatted = entries
        .map(([name, entry]) => {
            if (ignoredKeys.has(name.toLowerCase())) {
                return '';
            }

            if (typeof entry === 'boolean') {
                return entry ? name : '';
            }

            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return `${name}: ${normalizeCapabilityValue(entry)}`;
            }

            const record = entry as Record<string, unknown>;
            if (record.supported === false) {
                return '';
            }

            const parts = [name];
            if (typeof record.bits === 'number' || typeof record.bits === 'string') {
                parts.push(String(record.bits));
            }
            if (record.hardware === true) {
                parts.push('hw');
            }

            return parts.join(', ');
        })
        .filter((entry) => Boolean(entry));

    return formatted.length ? formatted.join(' · ') : '—';
}

export function formatCapabilityRecord(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return normalizeCapabilityValue(value);
    }

    const formatted = Object.entries(value as Record<string, unknown>)
        .map(([name, entry]) => {
            if (typeof entry === 'boolean') {
                return `${name}: ${entry ? 'yes' : 'no'}`;
            }
            if (Array.isArray(entry)) {
                return `${name}: [${entry.map((item) => normalizeCapabilityValue(item)).join(', ')}]`;
            }
            if (entry && typeof entry === 'object') {
                const inner = Object.entries(entry as Record<string, unknown>)
                    .map(([key, nested]) => `${key}: ${normalizeCapabilityValue(nested)}`)
                    .join(', ');
                return `${name}: ${inner}`;
            }
            return `${name}: ${normalizeCapabilityValue(entry)}`;
        })
        .filter((entry) => Boolean(entry));

    return formatted.length ? formatted.join(', ') : '—';
}

function collectGeneralNotes(generalCapabilities: Record<string, unknown>): string[] {
    const merged = [
        ...normalizeStringList(generalCapabilities.notes),
        ...normalizeStringList(
            generalCapabilities.math &&
                typeof generalCapabilities.math === 'object' &&
                !Array.isArray(generalCapabilities.math)
                ? (generalCapabilities.math as Record<string, unknown>).notes
                : null
        ),
    ];

    if (!merged.length) {
        return [];
    }

    return Array.from(new Set(merged));
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
}

function collectPinsFromCapabilityEntry(entry: unknown, pinIds: Set<number>): void {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
        pinIds.add(entry);
        return;
    }

    if (typeof entry === 'string') {
        const parsed = Number.parseInt(entry, 10);
        if (Number.isFinite(parsed)) {
            pinIds.add(parsed);
        }
        return;
    }

    if (Array.isArray(entry)) {
        for (const value of entry) {
            collectPinsFromCapabilityEntry(value, pinIds);
        }
        return;
    }

    if (entry && typeof entry === 'object') {
        for (const value of Object.values(entry)) {
            collectPinsFromCapabilityEntry(value, pinIds);
        }
    }
}

function roleToDirection(role: string | null | undefined): 'input' | 'output' | null {
    if (!role) {
        return null;
    }

    const normalizedRole = role.toLowerCase();
    if (
        normalizedRole.includes('input') ||
        normalizedRole === 'in' ||
        normalizedRole === 'miso' ||
        normalizedRole === 'rx' ||
        normalizedRole === 'sda'
    ) {
        return 'input';
    }

    if (
        normalizedRole.includes('output') ||
        normalizedRole === 'out' ||
        normalizedRole === 'mosi' ||
        normalizedRole === 'tx' ||
        normalizedRole === 'scl'
    ) {
        return 'output';
    }

    return null;
}

function normalizeI2cRole(role: string | null | undefined): 'sda' | 'scl' | null {
    if (!role) {
        return null;
    }

    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'sda' || normalizedRole.includes('sda')) {
        return 'sda';
    }
    if (normalizedRole === 'scl' || normalizedRole.includes('scl')) {
        return 'scl';
    }

    const direction = roleToDirection(normalizedRole);
    if (direction === 'input') {
        return 'sda';
    }
    if (direction === 'output') {
        return 'scl';
    }

    return null;
}

function normalizeSpiRole(role: string | null | undefined): 'mosi' | 'miso' | 'sck' | 'cs' | null {
    if (!role) {
        return null;
    }

    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'mosi' || normalizedRole.includes('mosi')) {
        return 'mosi';
    }
    if (normalizedRole === 'miso' || normalizedRole.includes('miso')) {
        return 'miso';
    }
    if (
        normalizedRole === 'sck' ||
        normalizedRole === 'clk' ||
        normalizedRole.includes('sck') ||
        normalizedRole.includes('clk')
    ) {
        return 'sck';
    }
    if (
        normalizedRole === 'cs' ||
        normalizedRole === 'ss' ||
        normalizedRole.includes('chipselect') ||
        normalizedRole.includes('chip_select') ||
        normalizedRole.includes('cs') ||
        normalizedRole.includes('ss')
    ) {
        return 'cs';
    }

    const direction = roleToDirection(normalizedRole);
    if (direction === 'input') {
        return 'miso';
    }
    if (direction === 'output') {
        return 'mosi';
    }

    return null;
}

function normalizeI2sRole(
    role: string | null | undefined
): 'bclk' | 'ws' | 'din' | 'dout' | 'mclk' | null {
    if (!role) {
        return null;
    }

    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'bclk' || normalizedRole === 'clk') {
        return 'bclk';
    }
    if (normalizedRole === 'ws' || normalizedRole === 'lrclk' || normalizedRole === 'lrcl') {
        return 'ws';
    }
    if (normalizedRole === 'din' || normalizedRole === 'in') {
        return 'din';
    }
    if (normalizedRole === 'dout' || normalizedRole === 'out') {
        return 'dout';
    }
    if (normalizedRole === 'mclk' || normalizedRole === 'mck') {
        return 'mclk';
    }

    return null;
}

function normalizeUartRole(role: string | null | undefined): 'tx' | 'rx' | null {
    if (!role) {
        return null;
    }

    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'tx') {
        return 'tx';
    }
    if (normalizedRole === 'rx') {
        return 'rx';
    }

    const direction = roleToDirection(normalizedRole);
    if (direction === 'output') {
        return 'tx';
    }
    if (direction === 'input') {
        return 'rx';
    }

    return null;
}

const PROTOCOL_COMPLETE_ROLES: Record<'uart' | 'i2c' | 'spi' | 'i2s', readonly string[]> = {
    uart: ['tx', 'rx'],
    i2c: ['sda', 'scl'],
    spi: ['cs', 'sck', 'mosi', 'miso'],
    i2s: ['bclk', 'ws', 'din', 'dout'],
};

const UART_ROLE_ICON_SPECS: Record<string, CapabilityIconSpec> = {
    tx: { key: 'serial.output', icon: IconProvider.serialOut, tooltip: 'Serial Output (TX)', family: 'serial' },
    rx: { key: 'serial.input', icon: IconProvider.serialIn, tooltip: 'Serial Input (RX)', family: 'serial' },
};

const I2C_ROLE_ICON_SPECS: Record<string, CapabilityIconSpec> = {
    sda: { key: 'i2c.sda', icon: IconProvider.i2cSda, tooltip: 'I2C SDA', family: 'i2c' },
    scl: { key: 'i2c.scl', icon: IconProvider.i2cScl, tooltip: 'I2C SCL', family: 'i2c' },
};

const SPI_ROLE_ICON_SPECS: Record<string, CapabilityIconSpec> = {
    miso: { key: 'spi.miso', icon: IconProvider.spiMiso, tooltip: 'SPI MISO', family: 'spi' },
    mosi: { key: 'spi.mosi', icon: IconProvider.spiMosi, tooltip: 'SPI MOSI', family: 'spi' },
    sck: { key: 'spi.sck', icon: IconProvider.spiSck, tooltip: 'SPI SCK', family: 'spi' },
    cs: { key: 'spi.cs', icon: IconProvider.spiCs, tooltip: 'SPI CS', family: 'spi' },
};

const I2S_ROLE_ICON_SPECS: Record<string, CapabilityIconSpec> = {
    dout: { key: 'i2s.dout', icon: IconProvider.i2sDout, tooltip: 'I2S Data Out', family: 'i2s' },
    din: { key: 'i2s.din', icon: IconProvider.i2sDin, tooltip: 'I2S Data In', family: 'i2s' },
    bclk: { key: 'i2s.bclk', icon: IconProvider.i2sBclk, tooltip: 'I2S Bit Clock', family: 'i2s' },
    ws: { key: 'i2s.ws', icon: IconProvider.i2sWs, tooltip: 'I2S Word Select', family: 'i2s' },
    mclk: { key: 'i2s.mclk', icon: IconProvider.i2sMclk, tooltip: 'I2S Master Clock', family: 'i2s' },
};

function addProtocolIcons(
    addIcon: (spec: CapabilityIconSpec) => void,
    roles: string[],
    completeRoles: readonly string[],
    generalSpec: CapabilityIconSpec,
    roleSpecs: Record<string, CapabilityIconSpec>
): void {
    const roleSet = new Set(roles);
    const isFull = completeRoles.every((role) => roleSet.has(role));

    if (isFull) {
        addIcon(generalSpec);
    }

    roles.forEach((role) => {
        // On a full protocol, only roles beyond the complete set are shown explicitly.
        if (isFull && completeRoles.includes(role)) {
            return;
        }
        const spec = roleSpecs[role];
        if (spec) {
            addIcon(spec);
        }
    });
}

export function getPinCapabilityIconSpecs(
    targetInfo: DeviceTargetInfo,
    pin: PinCapability
): CapabilityIconSpec[] {
    const iconSpecs: CapabilityIconSpec[] = [];
    const seenKeys = new Set<string>();
    const addIcon = (spec: CapabilityIconSpec): void => {
        if (seenKeys.has(spec.key)) {
            return;
        }
        seenKeys.add(spec.key);
        iconSpecs.push(spec);
    };

    const pinId = pin.id;

    const hasPwmInput = targetInfo.hasPinCapability(pinId, 'pwm.input');
    const hasPwmOutput = targetInfo.hasPinCapability(pinId, 'pwm.output');
    if (hasPwmInput && hasPwmOutput) {
        addIcon({
            key: 'pwm.inout',
            icon: IconProvider.pwmInOut,
            tooltip: 'PWM Input + Output',
            family: 'pwm',
        });
    } else {
        if (hasPwmInput) {
            addIcon({
                key: 'pwm.input',
                icon: IconProvider.pwmInput,
                tooltip: 'PWM Input',
                family: 'pwm',
            });
        }

        if (hasPwmOutput) {
            addIcon({
                key: 'pwm.output',
                icon: IconProvider.pwmOutput,
                tooltip: 'PWM Output',
                family: 'pwm',
            });
        }
    }

    const hasDigitalInput = targetInfo.hasPinCapability(pinId, 'digital.input');
    const hasDigitalOutput = targetInfo.hasPinCapability(pinId, 'digital.output');
    if (hasDigitalInput && hasDigitalOutput) {
        addIcon({
            key: 'digital.inout',
            icon: IconProvider.digitalInOut,
            tooltip: 'Digital Input + Output',
            family: 'digital',
        });
    } else {
        if (hasDigitalInput) {
            addIcon({
                key: 'digital.input',
                icon: IconProvider.digitalInput,
                tooltip: 'Digital Input',
                family: 'digital',
            });
        }
        if (hasDigitalOutput) {
            addIcon({
                key: 'digital.output',
                icon: IconProvider.digitalOutput,
                tooltip: 'Digital Output',
                family: 'digital',
            });
        }
    }

    const hasPullUp = targetInfo.hasPinCapability(pinId, 'pull.up');
    const hasPullDown = targetInfo.hasPinCapability(pinId, 'pull.down');
    if (hasPullUp && hasPullDown) {
        addIcon({
            key: 'pull.up_down',
            icon: IconProvider.pullUpDown,
            tooltip: 'Pull Up + Pull Down',
            family: 'pull',
        });
    } else {
        if (hasPullUp) {
            addIcon({
                key: 'pull.up',
                icon: IconProvider.pullUp,
                tooltip: 'Pull Up',
                family: 'pull',
            });
        }
        if (hasPullDown) {
            addIcon({
                key: 'pull.down',
                icon: IconProvider.pullDown,
                tooltip: 'Pull Down',
                family: 'pull',
            });
        }
    }

    if (targetInfo.hasPinCapability(pinId, 'adc') || pin.adc) {
        addIcon({
            key: 'adc',
            icon: IconProvider.adc,
            tooltip: 'ADC',
            family: 'adc',
        });
    }

    const spiRoles = (pin.spi?.roles || [])
        .map((role) => normalizeSpiRole(role))
        .filter((role) => role !== null);
    if (spiRoles.length === 0) {
        if (targetInfo.hasPinCapability(pinId, 'spi.in')) {
            spiRoles.push('miso');
        } else if (targetInfo.hasPinCapability(pinId, 'spi.out')) {
            spiRoles.push('mosi');
        }
    }
    addProtocolIcons(
        addIcon,
        spiRoles,
        PROTOCOL_COMPLETE_ROLES.spi,
        { key: 'spi', icon: IconProvider.spi, tooltip: 'SPI', family: 'spi' },
        SPI_ROLE_ICON_SPECS
    );

    const i2cRoles = (pin.i2c?.roles || [])
        .map((role) => normalizeI2cRole(role))
        .filter((role) => role !== null);
    if (i2cRoles.length === 0) {
        if (targetInfo.hasPinCapability(pinId, 'i2c.in')) {
            i2cRoles.push('sda');
        } else if (targetInfo.hasPinCapability(pinId, 'i2c.out')) {
            i2cRoles.push('scl');
        }
    }
    addProtocolIcons(
        addIcon,
        i2cRoles,
        PROTOCOL_COMPLETE_ROLES.i2c,
        { key: 'i2c', icon: IconProvider.i2c, tooltip: 'I2C', family: 'i2c' },
        I2C_ROLE_ICON_SPECS
    );

    const uartRoles = (pin.uart?.roles || [])
        .map((role) => normalizeUartRole(role))
        .filter((role) => role !== null);
    addProtocolIcons(
        addIcon,
        uartRoles,
        PROTOCOL_COMPLETE_ROLES.uart,
        { key: 'serial', icon: IconProvider.uart, tooltip: 'UART / Serial', family: 'serial' },
        UART_ROLE_ICON_SPECS
    );

    if (pin.dac) {
        addIcon({
            key: 'dac',
            icon: IconProvider.dac,
            tooltip: 'DAC',
            family: 'dac',
        });
    }

    if (pin.touch) {
        addIcon({
            key: 'touch',
            icon: IconProvider.touch,
            tooltip: 'Touch',
            family: 'touch',
        });
    }

    const i2sRoles = (pin.i2s?.roles || [])
        .map((role) => normalizeI2sRole(role))
        .filter((role) => role !== null);
    addProtocolIcons(
        addIcon,
        i2sRoles,
        PROTOCOL_COMPLETE_ROLES.i2s,
        { key: 'i2s', icon: IconProvider.i2s, tooltip: 'I2S', family: 'i2s' },
        I2S_ROLE_ICON_SPECS
    );

    if (pin.rtc) {
        addIcon({
            key: 'rtc',
            icon: IconProvider.rtc,
            tooltip: 'RTC GPIO',
            family: 'rtc',
        });
    }

    return iconSpecs;
}

export class TargetConfigView extends ViewBase {
    private _workspace: WorkspaceLike;
    private _collectionManager: CollectionManagerLike;
    private _collection: CollectionLike | null;
    private _toolbarView: ToolbarView | null;
    private _toolbarHost: HTMLDivElement | null;
    private _contentHost: HTMLDivElement | null;
    private _headerHost: HTMLDivElement | null;
    private _splitHost: HTMLDivElement | null;
    private _headerView: ContentView | null;
    private _splitView: SplitView | null;
    private _sectionContentViews: ContentView[];
    private _targetInfo: DeviceTargetInfo | null;
    private _compileTarget: { board: string; port: string } | null;
    private _unsubscribeCollection: Unsubscribe;
    private _unsubscribeCollectionManager: Unsubscribe;
    private _refreshToken: number;

    constructor({
        workspace,
        collectionManager,
        i18nService = null,
        title = 'Target Config',
        icon = IconProvider.dataObject,
        id = null,
        logger = null,
    }: TargetConfigViewOptions) {
        if (!workspace) {
            throw new Error('TargetConfigView requires a workspace instance');
        }

        if (!collectionManager) {
            throw new Error('TargetConfigView requires a collectionManager instance');
        }

        super({
            title,
            icon,
            id,
            i18nService,
            logger,
        });

        this._workspace = workspace;
        this._collectionManager = collectionManager;
        this._collection = this._collectionManager.getActiveCollection();
        this._toolbarView = null;
        this._toolbarHost = null;
        this._contentHost = null;
        this._headerHost = null;
        this._splitHost = null;
        this._headerView = null;
        this._splitView = null;
        this._sectionContentViews = [];
        this._targetInfo = null;
        this._compileTarget = null;
        this._unsubscribeCollection = null;
        this._unsubscribeCollectionManager = null;
        this._refreshToken = 0;
    }

    override render(_container: HTMLElement): void {
        const root = document.createElement('section');
        root.className = 'target-config-view';

        this._toolbarHost = document.createElement('div');
        this._toolbarHost.className = 'target-config-view__toolbar-host';

        this._contentHost = document.createElement('div');
        this._contentHost.className = 'target-config-view__content';

        this._headerHost = document.createElement('div');
        this._headerHost.className = 'target-config-view__header-host';

        this._splitHost = document.createElement('div');
        this._splitHost.className = 'target-config-view__split-host';

        this._contentHost.appendChild(this._headerHost);
        this._contentHost.appendChild(this._splitHost);
        root.appendChild(this._toolbarHost);
        root.appendChild(this._contentHost);

        this.mountContent(root);

        if (!this._toolbarView) {
            this._toolbarView = new ToolbarView({
                height: 36,
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._createToolbarControls();
        }
        this._toolbarView.attachTo(this._toolbarHost);

        this._ensureContentViews();
        this._headerView?.attachTo(this._headerHost);
        this._splitView?.attachTo(this._splitHost);

        void this._refreshContent();
    }

    override afterAttach(): void {
        super.afterAttach();
        this._setCollection(this._collectionManager.getActiveCollection());

        this._unsubscribeCollectionManager = this._collectionManager.on(
            '*',
            (event: AppEventLike) => {
                if (event?.name !== 'activeCollectionChanged') {
                    return;
                }

                assertAppEventPayloadType(
                    event,
                    'CollectionManager.ActiveCollectionChanged.v1',
                    'TargetConfigView collection manager listener'
                );

                const activeCollectionChangedEvent =
                    event as AppEventLike<CollectionManagerActiveCollectionChangedPayload>;
                void activeCollectionChangedEvent.detail?.collectionId;

                this._setCollection(this._collectionManager.getActiveCollection());
            }
        );

        this._subscribeToLanguageChanges(() => {
            void this._refreshContent();
        });
    }

    override beforeDetach(): void {
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;

        this._unsubscribeCollectionManager?.();
        this._unsubscribeCollectionManager = null;

        this._splitView?.detach();
        this._headerView?.detach();
        this._toolbarView?.detach();
        super.beforeDetach();
    }

    private _createToolbarControls(): void {
        if (!this._toolbarView) {
            return;
        }

        this._toolbarView.clearControls();

        this._toolbarView.addButton({
            icon: IconProvider.sync,
            label: 'Refresh',
            className: 'target-config-view__refresh-btn',
            onClick: () => {
                void this._refreshContent();
            },
        });

        this._toolbarView.renderControls();
    }

    private _setCollection(collection: CollectionLike | null): void {
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;
        this._collection = collection;
        this._subscribeCollection();
        void this._refreshContent();
    }

    private _subscribeCollection(): void {
        if (!this._collection || typeof this._collection.on !== 'function') {
            return;
        }

        this._unsubscribeCollection = this._collection.on('*', (event: AppEventLike) => {
            if (!event?.name) {
                return;
            }

            if (event.name === 'targetId') {
                assertAppEventPayloadType(
                    event,
                    'Collection.TargetIdChanged.v1',
                    'TargetConfigView collection listener'
                );
                const targetChangedEvent = event as AppEventLike<CollectionTargetIdChangedPayload>;
                void targetChangedEvent.detail?.targetId;
                void this._refreshContent();
            }
        });
    }

    private async _resolveTargetInfo(): Promise<DeviceTargetInfo | null> {
        const collection = this._collection;
        if (!collection) {
            return null;
        }

        const targetId = collection.getTargetId?.();
        if (!targetId) {
            return null;
        }

        const runtimeId = collection.getDeviceRuntimeId?.();
        const runtime =
            runtimeId && this._workspace.runtimeCollection?.getRuntime
                ? this._workspace.runtimeCollection.getRuntime(runtimeId)
                : null;
        const runtimeTarget = runtime?.getDeviceTarget?.(targetId) || null;
        if (runtimeTarget) {
            return runtimeTarget;
        }

        if (!this._workspace.getUserTargetConfig) {
            return null;
        }

        const userTargetRecord = await this._workspace.getUserTargetConfig(targetId);
        const targetData = userTargetRecord?.targetData;
        if (!targetData || typeof targetData !== 'object') {
            return null;
        }

        return new DeviceTargetInfo(targetData);
    }

    private async _refreshContent(): Promise<void> {
        const currentToken = ++this._refreshToken;
        const targetInfo = await this._resolveTargetInfo();
        if (currentToken !== this._refreshToken) {
            return;
        }

        this._targetInfo = targetInfo;
        this._compileTarget = this._resolveCompileTarget();
        this._renderContentViews();
    }

    private _renderContentViews(): void {
        const views: (ContentView | null)[] = [this._headerView, ...this._sectionContentViews];
        for (const view of views) {
            if (view?.container) {
                view.render(view.container);
            }
        }
    }

    private _resolveCompileTarget(): { board: string; port: string } | null {
        const collection = this._collection;
        if (!collection) {
            return null;
        }
        const targetId = collection.getTargetId?.();
        if (!targetId) {
            return null;
        }
        const runtimeId = collection.getDeviceRuntimeId?.();
        const runtime =
            runtimeId && this._workspace.runtimeCollection?.getRuntime
                ? this._workspace.runtimeCollection.getRuntime(runtimeId)
                : null;
        return runtime?.getCompileTarget?.(targetId) || null;
    }

    private _ensureContentViews(): void {
        if (this._headerView && this._splitView) {
            return;
        }

        this._headerView = new ContentView({
            title: 'Target Header',
            renderFn: () => this._buildTargetHeaderContent(),
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._sectionContentViews = [
            new ContentView({
                title: 'General Capabilities',
                renderFn: () => this._buildGeneralCapabilitiesContent(),
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            new ContentView({
                title: 'Pin Capability Icon Legend',
                renderFn: () => this._buildIconLegendContent(),
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            new ContentView({
                title: 'Hardware Resources',
                renderFn: () => this._buildResourcesContent(),
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            new ContentView({
                title: 'Capabilities Per Pin',
                renderFn: () => this._buildPerPinContent(),
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            new ContentView({
                title: 'Capability to Pins',
                renderFn: () => this._buildByCapabilityContent(),
                i18nService: this._i18nService,
                logger: this._logger,
            }),
        ];

        this._splitView = new SplitView({
            orientation: 'vertical',
            gap: 0,
            minPaneSize: 32,
            views: [
                new CollapsibleView({
                    headerTitle: 'General Capabilities',
                    collapsed: false,
                    contentView: this._sectionContentViews[0],
                    i18nService: this._i18nService,
                    logger: this._logger,
                }),
                new CollapsibleView({
                    headerTitle: 'Pin Capability Icon Legend',
                    collapsed: true,
                    contentView: this._sectionContentViews[1],
                    i18nService: this._i18nService,
                    logger: this._logger,
                }),
                new CollapsibleView({
                    headerTitle: 'Hardware Resources',
                    collapsed: false,
                    contentView: this._sectionContentViews[2],
                    i18nService: this._i18nService,
                    logger: this._logger,
                }),
                new CollapsibleView({
                    headerTitle: 'Capabilities Per Pin',
                    collapsed: false,
                    contentView: this._sectionContentViews[3],
                    i18nService: this._i18nService,
                    logger: this._logger,
                }),
                new CollapsibleView({
                    headerTitle: 'Capability to Pins',
                    collapsed: false,
                    contentView: this._sectionContentViews[4],
                    i18nService: this._i18nService,
                    logger: this._logger,
                }),
            ],
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    private _buildTargetHeaderContent(): HTMLElement {
        const targetInfo = this._targetInfo;
        const header = document.createElement('header');
        header.className = 'target-config-view__header';

        const title = document.createElement('h2');
        title.className = 'target-config-view__title';
        title.textContent = targetInfo
            ? targetInfo.displayName || targetInfo.id || 'Device Target'
            : 'No target selected';
        header.appendChild(title);

        if (targetInfo) {
            const firmware = document.createElement('div');
            firmware.className = 'target-config-view__firmware-target';
            const compileTarget = this._compileTarget;
            firmware.textContent = compileTarget
                ? `Firmware target: ${compileTarget.board} (port: ${compileTarget.port})`
                : 'Firmware target: any board (not specific)';
            header.appendChild(firmware);
        }

        return header;
    }

    private _buildGeneralCapabilitiesContent(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'target-config-view__section-content';

        const generalCapabilities = (this._targetInfo?.generalCapabilities ||
            {}) as Record<string, unknown>;
        const statusContainer = document.createElement('div');
        statusContainer.className = 'target-config-view__general-status-wrap';
        statusContainer.appendChild(this._renderConnectivityStatus(generalCapabilities));
        container.appendChild(statusContainer);

        const notes = collectGeneralNotes(generalCapabilities);

        const capabilityEntries = Object.entries(generalCapabilities)
            .filter(([key]) => key !== 'wifi' && key !== 'bluetooth' && key !== 'notes')
            .sort(([a], [b]) => a.localeCompare(b));

        if (capabilityEntries.length === 0 && notes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'target-config-view__empty';
            empty.textContent = 'No additional general capabilities available.';
            container.appendChild(empty);
            return container;
        }

        const list = document.createElement('dl');
        list.className = 'target-config-view__general-list';

        for (const [key, value] of capabilityEntries) {
            const descriptor = this._targetInfo?.capabilityRegistry.get(key) || null;

            const row = document.createElement('div');
            row.className = 'target-config-view__general-row';

            const dt = document.createElement('dt');
            dt.className = 'target-config-view__general-key';
            this._appendCapabilityKeyIcon(dt, key, descriptor);

            const dd = document.createElement('dd');
            dd.className = 'target-config-view__general-value';
            dd.textContent =
                key === 'math' ? formatMathCapabilities(value) : formatCapabilityRecord(value);

            row.appendChild(dt);
            row.appendChild(dd);
            list.appendChild(row);
        }

        if (notes.length) {
            const row = document.createElement('div');
            row.className = 'target-config-view__general-row';

            const dt = document.createElement('dt');
            dt.className = 'target-config-view__general-key';
            dt.textContent = 'notes';

            const dd = document.createElement('dd');
            dd.className = 'target-config-view__general-value';

            const notesField = document.createElement('textarea');
            notesField.className = 'target-config-view__general-notes';
            notesField.readOnly = true;
            notesField.value = notes.join('\n');
            dd.appendChild(notesField);

            row.appendChild(dt);
            row.appendChild(dd);
            list.appendChild(row);
        }

        container.appendChild(list);
        return container;
    }

    private _appendCapabilityKeyIcon(
        container: HTMLElement,
        key: string,
        descriptor: CapabilityDescriptor | null
    ): void {
        if (descriptor?.glyph) {
            const badge = document.createElement('span');
            badge.className = 'target-config-view__general-key-glyph';
            badge.textContent = descriptor.glyph;
            badge.title = key;
            container.appendChild(badge);
        } else if (descriptor?.icon) {
            const icon = document.createElement('img');
            icon.className = 'target-config-view__general-key-icon';
            icon.src = IconProvider.get(descriptor.icon);
            icon.alt = key;
            icon.title = key;
            container.appendChild(icon);
        } else {
            container.textContent = key;
        }
    }

    private _buildIconLegendContent(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'target-config-view__section-content';

        const table = document.createElement('table');
        table.className = 'target-config-view__table target-config-view__icon-legend-table';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Icon', 'Capability', 'Meaning'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');
        for (const entry of CAPABILITY_ICON_LEGEND) {
            const row = document.createElement('tr');

            const iconCell = document.createElement('td');
            const icon = document.createElement('img');
            icon.className = `target-config-view__capability-icon target-config-view__capability-icon--${entry.family}`;
            icon.src = entry.icon;
            icon.alt = entry.label;
            icon.title = entry.label;
            iconCell.appendChild(icon);

            const labelCell = document.createElement('td');
            labelCell.textContent = entry.label;

            const meaningCell = document.createElement('td');
            meaningCell.textContent = entry.meaning;

            row.appendChild(iconCell);
            row.appendChild(labelCell);
            row.appendChild(meaningCell);
            body.appendChild(row);
        }
        table.appendChild(body);

        container.appendChild(table);
        return container;
    }

    private _renderConnectivityStatus(generalCapabilities: Record<string, unknown>): HTMLElement {
        const registry = this._targetInfo?.capabilityRegistry || null;
        const onIcon = (key: 'wifi' | 'bluetooth', fallback: string): string => {
            const icon = registry?.get(key)?.icon;
            return icon ? IconProvider.get(icon) : fallback;
        };

        const statusSpecs: ConnectivityStatusSpec[] = [
            {
                key: 'wifi',
                label: 'Wi-Fi',
                supported: capabilityIsSupported(generalCapabilities.wifi),
                icon: capabilityIsSupported(generalCapabilities.wifi)
                    ? onIcon('wifi', IconProvider.wifi)
                    : IconProvider.wifiOff,
            },
            {
                key: 'bluetooth',
                label: 'Bluetooth',
                supported: capabilityIsSupported(generalCapabilities.bluetooth),
                icon: capabilityIsSupported(generalCapabilities.bluetooth)
                    ? onIcon('bluetooth', IconProvider.bluetooth)
                    : IconProvider.bluetoothDisabled,
            },
        ];

        const row = document.createElement('div');
        row.className = 'target-config-view__general-status-row';

        for (const spec of statusSpecs) {
            const icon = document.createElement('img');
            icon.className = `target-config-view__general-status-icon target-config-view__general-status-icon--${
                spec.key
            } target-config-view__general-status-icon--${spec.supported ? 'on' : 'off'}`;
            icon.src = spec.icon;
            icon.alt = `${spec.label}: ${spec.supported ? 'available' : 'not available'}`;
            icon.title = `${spec.label}: ${spec.supported ? 'available' : 'not available'}`;

            row.appendChild(icon);
        }

        return row;
    }

    private _buildResourcesContent(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'target-config-view__section-content';

        const resources = this._targetInfo?.resources || {};
        const groups = Object.entries(resources).sort(([a], [b]) => a.localeCompare(b));

        if (groups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'target-config-view__empty';
            empty.textContent = 'No resource limits available.';
            container.appendChild(empty);
            return container;
        }

        const table = document.createElement('table');
        table.className = 'target-config-view__table target-config-view__resources-table';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Resource', 'Limits'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');
        for (const [group, limits] of groups) {
            const row = document.createElement('tr');

            const keyCell = document.createElement('td');
            keyCell.textContent = group;

            const valueCell = document.createElement('td');
            valueCell.textContent = formatCapabilityRecord(limits);

            row.appendChild(keyCell);
            row.appendChild(valueCell);
            body.appendChild(row);
        }
        table.appendChild(body);

        container.appendChild(table);
        return container;
    }

    private _buildPerPinContent(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'target-config-view__section-content';

        const targetInfo = this._targetInfo;
        const pinCapabilities = targetInfo
            ? Array.from(targetInfo.pinCapabilities.values()).sort((a, b) =>
                  comparePinId(a.id, b.id)
              )
            : [];

        if (pinCapabilities.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'target-config-view__empty';
            empty.textContent = 'No pin capability data available.';
            container.appendChild(empty);
            return container;
        }

        const table = document.createElement('table');
        table.className = 'target-config-view__table target-config-view__per-pin-table';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Pin', 'Label', 'Capabilities'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');
        for (const pin of pinCapabilities) {
            const row = document.createElement('tr');
            const iconSpecs = getPinCapabilityIconSpecs(targetInfo, pin);

            const pinCell = document.createElement('td');
            pinCell.textContent = String(pin.id);

            const labelCell = document.createElement('td');
            labelCell.textContent = pin.label || `Pin ${pin.id}`;

            if (pin.reserved) {
                labelCell.appendChild(document.createTextNode(' '));
                const badge = document.createElement('span');
                badge.className =
                    'target-config-view__pin-badge target-config-view__pin-badge--reserved';
                badge.textContent = `reserved${pin.reserved.reason ? `: ${pin.reserved.reason}` : ''}`;
                labelCell.appendChild(badge);
            }
            if (pin.strapping) {
                labelCell.appendChild(document.createTextNode(' '));
                const badge = document.createElement('span');
                badge.className =
                    'target-config-view__pin-badge target-config-view__pin-badge--strapping';
                badge.textContent = `strapping${pin.strapping.role ? `: ${pin.strapping.role}` : ''}`;
                labelCell.appendChild(badge);
            }

            const capabilityCell = document.createElement('td');
            if (iconSpecs.length === 0) {
                capabilityCell.textContent = '—';
            } else {
                const iconList = document.createElement('div');
                iconList.className = 'target-config-view__capability-icon-list';

                for (const iconSpec of iconSpecs) {
                    const icon = document.createElement('img');
                    icon.className = `target-config-view__capability-icon target-config-view__capability-icon--${iconSpec.family}`;
                    icon.src = iconSpec.icon;
                    icon.alt = iconSpec.tooltip;
                    icon.title = iconSpec.tooltip;
                    icon.setAttribute('aria-label', iconSpec.tooltip);
                    icon.tabIndex = 0;
                    iconList.appendChild(icon);
                }

                capabilityCell.appendChild(iconList);
            }

            row.appendChild(pinCell);
            row.appendChild(labelCell);
            row.appendChild(capabilityCell);
            body.appendChild(row);
        }
        table.appendChild(body);

        container.appendChild(table);
        return container;
    }

    private _buildByCapabilityContent(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'target-config-view__section-content';

        const entries = Object.entries(this._targetInfo?.capabilityToPins || {}).sort(([a], [b]) =>
            a.localeCompare(b)
        );

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'target-config-view__empty';
            empty.textContent = 'No capability-to-pin mappings available.';
            container.appendChild(empty);
            return container;
        }

        const table = document.createElement('table');
        table.className = 'target-config-view__table target-config-view__capability-table';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Capability', 'Pins'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');
        for (const [capabilityKey, value] of entries) {
            const pinIds = new Set<number>();
            collectPinsFromCapabilityEntry(value, pinIds);
            const sortedPins = Array.from(pinIds).sort((a, b) => a - b);

            const row = document.createElement('tr');

            const keyCell = document.createElement('td');
            keyCell.textContent = capabilityKey;

            const pinsCell = document.createElement('td');
            pinsCell.textContent = sortedPins.length ? sortedPins.join(', ') : '—';

            row.appendChild(keyCell);
            row.appendChild(pinsCell);
            body.appendChild(row);
        }
        table.appendChild(body);

        container.appendChild(table);
        return container;
    }
}

export default TargetConfigView;
