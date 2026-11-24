import { CapabilityRegistry, normalizeGenericPeripheral } from './capability-registry.js';

type PullDirection = 'up' | 'down';

export type PinId = number | string;

export type BusIdKind = 'i2c' | 'uart' | 'spi';

interface FrequencyRange {
	min: number | null;
	max: number | null;
}

interface DigitalCapability {
	input: boolean;
	output: boolean;
	openDrain: boolean;
}

interface PwmCapability {
	input: boolean;
	output: boolean;
	frequency_hz: FrequencyRange | null;
}

interface AdcCapability {
	channel?: number;
	resolution_bits?: number;
	unit?: 1 | 2;
	wifiConflict?: boolean;
}

interface UartCapability {
	port: string | null;
	roles: string[];
}

interface I2cCapability {
	bus: string | null;
	roles: string[];
	frequency_hz?: FrequencyRange;
}

interface SpiCapability {
	bus: string | null;
	roles: string[];
}

interface DacCapability {
	channel?: number;
	resolution_bits?: number;
}

interface TouchCapability {
	channel?: number;
}

interface I2sCapability {
	controller?: number;
	roles: string[];
}

interface RtcCapability {
	gpio: boolean;
}

interface StrappingCapability {
	role?: string;
	safeLevel?: 'high' | 'low' | 'either' | null;
}

interface ReservedCapability {
	reason?: string;
}

interface PinClaim {
	role: string;
	conflicts: string[];
	severity: 'info' | 'warn';
	note: string | null;
}

interface VoltageCapability {
	maxV?: number;
	tolerant5v?: boolean;
	analogMaxV?: number;
}

interface PullValuesOhm {
	up?: number;
	down?: number;
}

interface PinLegacyMetadata {
	label?: string | null;
	aliases?: string[];
	notes?: string[];
}

export interface PinCapabilityPayload {
	label?: unknown;
	aliases?: unknown;
	digital?: {
		input?: unknown;
		output?: unknown;
		openDrain?: unknown;
	};
	pullValuesOhm?: {
		up?: unknown;
		down?: unknown;
	};
	pull?: unknown;
	fixedPull?: unknown;
	pwm?: {
		input?: unknown;
		output?: unknown;
		frequency_hz?: unknown;
		frequencyHz?: unknown;
	};
	adc?: {
		channel?: unknown;
		resolution_bits?: unknown;
		resolutionBits?: unknown;
		unit?: unknown;
		wifiConflict?: unknown;
	};
	uart?: {
		roles?: unknown;
		port?: unknown;
	};
	i2c?: {
		roles?: unknown;
		bus?: unknown;
		frequency_hz?: unknown;
		frequencyHz?: unknown;
	};
	spi?: {
		roles?: unknown;
		bus?: unknown;
	};
	dac?: {
		channel?: unknown;
		resolution_bits?: unknown;
		resolutionBits?: unknown;
	};
	touch?: {
		channel?: unknown;
	};
	i2s?: {
		controller?: unknown;
		roles?: unknown;
	};
	rtc?: {
		gpio?: unknown;
	};
	strapping?: {
		role?: unknown;
		safeLevel?: unknown;
	};
	reserved?: {
		reason?: unknown;
	};
	claims?: unknown;
	voltage?: {
		maxV?: unknown;
		tolerant5v?: unknown;
		analogMaxV?: unknown;
	};
	peripherals?: Record<string, unknown>;
	notes?: unknown;
}

interface LegacyPinRecord {
	id?: unknown;
	label?: unknown;
	aliases?: unknown;
	notes?: unknown;
}

export interface DeviceTargetPayload {
	targetId?: unknown;
	id?: unknown;
	displayName?: unknown;
	description?: unknown;
	baseTargetId?: unknown;
	targetData?: Record<string, unknown>;
	generalCapabilities?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	resources?: Record<string, unknown>;
	instanceData?: Record<string, unknown>;
	pins?: LegacyPinRecord[];
	openPins?: { min?: unknown; max?: unknown };
	pinCapabilities?: Record<string, PinCapabilityPayload>;
	capabilityToPins?: Record<string, unknown>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_FETCH: FetchLike | null = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null;

function normalizeString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeStringList(rawList: unknown): string[] {
	if (!Array.isArray(rawList)) {
		return [];
	}
	const seen = new Set<string>();
	for (const entry of rawList) {
		const normalized = normalizeString(entry);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
		}
	}
	return Array.from(seen);
}

function normalizeNoteList(...noteSources: unknown[]): string[] {
	const seen = new Set<string>();
	for (const source of noteSources) {
		if (!source) {
			continue;
		}
		const list = Array.isArray(source) ? source : [source];
		for (const note of list) {
			const normalized = normalizeString(note);
			if (normalized && !seen.has(normalized)) {
				seen.add(normalized);
			}
		}
	}
	return Array.from(seen);
}

function normalizeNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

function normalizePull(rawPull: unknown): PullDirection[] {
	const valid = new Set<PullDirection>();
	if (Array.isArray(rawPull)) {
		rawPull.forEach((entry) => {
			const normalized = normalizeString(entry);
			if (normalized === 'up' || normalized === 'down') {
				valid.add(normalized);
			}
		});
	}
	return Array.from(valid);
}

function normalizeFixedPull(rawFixedPull: unknown): PullDirection | null {
	const normalized = normalizeString(rawFixedPull);
	return normalized === 'up' || normalized === 'down' ? normalized : null;
}

function normalizeFrequency(rawFreq: unknown): FrequencyRange | null {
	if (!rawFreq || typeof rawFreq !== 'object') {
		return null;
	}
	const record = rawFreq as { min?: unknown; max?: unknown };
	const min = normalizeNumber(record.min);
	const max = normalizeNumber(record.max);
	if (min === null && max === null) {
		return null;
	}
	return { min, max };
}

function normalizePwm(rawPwm: unknown): PwmCapability | null {
	if (!rawPwm || typeof rawPwm !== 'object') {
		return null;
	}
	const pwm = rawPwm as PinCapabilityPayload['pwm'];
	const input = pwm?.input === undefined && pwm?.output === undefined ? true : Boolean(pwm?.input);
	const output = pwm?.output === undefined && pwm?.input === undefined ? true : Boolean(pwm?.output);
	const frequencyHz = normalizeFrequency(pwm?.frequency_hz || pwm?.frequencyHz);
	return { input, output, frequency_hz: frequencyHz };
}

function normalizeAdcUnit(rawUnit: unknown): 1 | 2 | undefined {
	if (rawUnit === 1 || rawUnit === '1') {
		return 1;
	}
	if (rawUnit === 2 || rawUnit === '2') {
		return 2;
	}
	return undefined;
}

function normalizeAdc(rawAdc: unknown): AdcCapability | null {
	if (!rawAdc || typeof rawAdc !== 'object') {
		return null;
	}
	const adc = rawAdc as PinCapabilityPayload['adc'];
	const channel = normalizeNumber(adc?.channel);
	const resolution = normalizeNumber(adc?.resolution_bits ?? adc?.resolutionBits);
	const unit = normalizeAdcUnit(adc?.unit);
	const wifiConflict = adc?.wifiConflict === true;
	if (channel === null && resolution === null && unit === undefined) {
		return null;
	}
	const result: AdcCapability = {};
	if (channel !== null) {
		result.channel = channel;
	}
	if (resolution !== null) {
		result.resolution_bits = resolution;
	}
	if (unit !== undefined) {
		result.unit = unit;
	}
	if (wifiConflict) {
		result.wifiConflict = true;
	}
	return result;
}

function normalizeDac(rawDac: unknown): DacCapability | null {
	if (!rawDac || typeof rawDac !== 'object') {
		return null;
	}
	const dac = rawDac as PinCapabilityPayload['dac'];
	const channel = normalizeNumber(dac?.channel);
	const resolution = normalizeNumber(dac?.resolution_bits ?? dac?.resolutionBits);
	if (channel === null && resolution === null) {
		return null;
	}
	const result: DacCapability = {};
	if (channel !== null) {
		result.channel = channel;
	}
	if (resolution !== null) {
		result.resolution_bits = resolution;
	}
	return result;
}

function normalizeTouch(rawTouch: unknown): TouchCapability | null {
	if (!rawTouch || typeof rawTouch !== 'object') {
		return null;
	}
	const channel = normalizeNumber((rawTouch as PinCapabilityPayload['touch'])?.channel);
	if (channel === null) {
		return null;
	}
	return { channel };
}

function normalizeI2s(rawI2s: unknown): I2sCapability | null {
	if (!rawI2s || typeof rawI2s !== 'object') {
		return null;
	}
	const record = rawI2s as PinCapabilityPayload['i2s'];
	const roles = normalizeRoles(record?.roles);
	if (roles.length === 0) {
		return null;
	}
	const controller = normalizeNumber(record?.controller);
	const result: I2sCapability = { roles };
	if (controller !== null) {
		result.controller = controller;
	}
	return result;
}

function normalizeRtc(rawRtc: unknown): RtcCapability | null {
	if (!rawRtc || typeof rawRtc !== 'object') {
		return null;
	}
	const record = rawRtc as PinCapabilityPayload['rtc'];
	if (record?.gpio !== true) {
		return null;
	}
	return { gpio: true };
}

function normalizeStrapping(rawStrapping: unknown): StrappingCapability | null {
	if (!rawStrapping || typeof rawStrapping !== 'object') {
		return null;
	}
	const record = rawStrapping as PinCapabilityPayload['strapping'];
	const role = normalizeString(record?.role);
	const safeLevel = normalizeString(record?.safeLevel);
	if (safeLevel && safeLevel !== 'high' && safeLevel !== 'low' && safeLevel !== 'either') {
		return null;
	}
	if (!role && !safeLevel) {
		return null;
	}
	const result: StrappingCapability = {};
	if (role) {
		result.role = role;
	}
	if (safeLevel) {
		result.safeLevel = safeLevel as StrappingCapability['safeLevel'];
	}
	return result;
}

function normalizeReserved(rawReserved: unknown): ReservedCapability | null {
	if (!rawReserved || typeof rawReserved !== 'object') {
		return null;
	}
	const reason = normalizeString((rawReserved as PinCapabilityPayload['reserved'])?.reason);
	return reason ? { reason } : null;
}

function normalizeClaims(rawClaims: unknown): PinClaim[] {
	if (!Array.isArray(rawClaims)) {
		return [];
	}
	const claims: PinClaim[] = [];
	for (const entry of rawClaims) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const role = normalizeString(record.role);
		if (!role) {
			continue;
		}
		const severityRaw = normalizeString(record.severity);
		const severity = severityRaw === 'info' ? 'info' : 'warn';
		claims.push({
			role,
			conflicts: normalizeStringList(record.conflicts),
			severity,
			note: normalizeString(record.note),
		});
	}
	return claims;
}

function normalizeVoltage(rawVoltage: unknown): VoltageCapability | null {
	if (!rawVoltage || typeof rawVoltage !== 'object') {
		return null;
	}
	const record = rawVoltage as PinCapabilityPayload['voltage'];
	const maxV = normalizeNumber(record?.maxV);
	const analogMaxV = normalizeNumber(record?.analogMaxV);
	const tolerant5v = record?.tolerant5v === true;
	if (maxV === null && analogMaxV === null && !tolerant5v) {
		return null;
	}
	const result: VoltageCapability = {};
	if (maxV !== null) {
		result.maxV = maxV;
	}
	if (analogMaxV !== null) {
		result.analogMaxV = analogMaxV;
	}
	if (tolerant5v) {
		result.tolerant5v = true;
	}
	return result;
}

function normalizePullValuesOhm(rawPullValues: unknown): PullValuesOhm | null {
	if (!rawPullValues || typeof rawPullValues !== 'object') {
		return null;
	}
	const record = rawPullValues as PinCapabilityPayload['pullValuesOhm'];
	const up = normalizeNumber(record?.up);
	const down = normalizeNumber(record?.down);
	if (up === null && down === null) {
		return null;
	}
	const result: PullValuesOhm = {};
	if (up !== null) {
		result.up = up;
	}
	if (down !== null) {
		result.down = down;
	}
	return result;
}

function normalizePeripherals(rawPeripherals: unknown): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (!rawPeripherals || typeof rawPeripherals !== 'object' || Array.isArray(rawPeripherals)) {
		return result;
	}
	Object.entries(rawPeripherals as Record<string, unknown>).forEach(([id, rawPayload]) => {
		if (!id) {
			return;
		}
		const normalized = normalizeGenericPeripheral(rawPayload);
		if (normalized) {
			result[id] = normalized;
		}
	});
	return result;
}

type ResourceLimitValue = number | number[] | Record<string, number> | null;

interface ResourceLimits {
	[key: string]: ResourceLimitValue;
}

function normalizeResourceInstanceMap(raw: unknown): Record<string, number> | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return null;
	}
	const map: Record<string, number> = {};
	Object.entries(raw as Record<string, unknown>).forEach(([instanceId, count]) => {
		if (!instanceId || typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
			return;
		}
		map[instanceId] = count;
	});
	return Object.keys(map).length ? map : null;
}

function normalizeResources(rawResources: unknown): Record<string, ResourceLimits> {
	const result: Record<string, ResourceLimits> = {};
	if (!rawResources || typeof rawResources !== 'object' || Array.isArray(rawResources)) {
		return result;
	}
	Object.entries(rawResources as Record<string, unknown>).forEach(([group, rawGroup]) => {
		if (!group || !rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
			return;
		}
		const limits: ResourceLimits = {};
		Object.entries(rawGroup as Record<string, unknown>).forEach(([key, value]) => {
			if (!key) {
				return;
			}
			if (Array.isArray(value)) {
				const ints = value.filter(
					(entry): entry is number => typeof entry === 'number' && Number.isInteger(entry)
				);
				limits[key] = ints.length ? ints : null;
			} else if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
				limits[key] = value;
			} else if (value && typeof value === 'object') {
				limits[key] = normalizeResourceInstanceMap(value);
			} else {
				limits[key] = null;
			}
		});
		if (Object.keys(limits).length) {
			result[group] = limits;
		}
	});
	return result;
}

function normalizeRoles(rawRoles: unknown): string[] {
	const valid = new Set<string>();
	if (Array.isArray(rawRoles)) {
		rawRoles.forEach((entry) => {
			const normalized = normalizeString(entry);
			if (normalized) {
				valid.add(normalized);
			}
		});
	}
	return Array.from(valid);
}

function normalizeUart(rawUart: unknown): UartCapability | null {
	if (!rawUart || typeof rawUart !== 'object') {
		return null;
	}
	const record = rawUart as PinCapabilityPayload['uart'];
	const roles = normalizeRoles(record?.roles);
	if (roles.length === 0) {
		return null;
	}
	const port = normalizeBusId(record?.port, 'uart');
	return { port, roles };
}

function normalizeI2c(rawI2c: unknown): I2cCapability | null {
	if (!rawI2c || typeof rawI2c !== 'object') {
		return null;
	}
	const record = rawI2c as PinCapabilityPayload['i2c'];
	const roles = normalizeRoles(record?.roles);
	if (roles.length === 0) {
		return null;
	}
	const bus = normalizeBusId(record?.bus, 'i2c');
	const frequency = normalizeFrequency(record?.frequency_hz || record?.frequencyHz);
	const result: I2cCapability = { bus, roles };
	if (frequency) {
		result.frequency_hz = frequency;
	}
	return result;
}

function normalizeSpi(rawSpi: unknown): SpiCapability | null {
	if (!rawSpi || typeof rawSpi !== 'object') {
		return null;
	}
	const record = rawSpi as PinCapabilityPayload['spi'];
	const roles = normalizeRoles(record?.roles);
	if (roles.length === 0) {
		return null;
	}
	const bus = normalizeBusId(record?.bus, 'spi');
	return { bus, roles };
}

export function normalizeBusId(value: unknown, kind: BusIdKind): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		if (kind === 'spi') {
			return null;
		}
		return `${kind}${Math.trunc(value)}`;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		if (kind === 'spi') {
			if (trimmed === 'v') {
				return 'vspi';
			}
			if (trimmed === 'f') {
				return 'fspi';
			}
		}
		return trimmed;
	}
	return null;
}

export function asPinId(value: unknown): PinId | null {
	const numeric = normalizeNumber(value);
	if (numeric !== null) {
		return numeric;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	if (value && typeof value === 'object') {
		const record = value as { port?: unknown; pin?: unknown };
		const port = normalizeString(record.port);
		const pin = normalizeNumber(record.pin);
		if (port && pin !== null) {
			return `${port}${pin}`;
		}
		if (port) {
			return port;
		}
	}
	return null;
}

export function comparePinId(a: PinId, b: PinId): number {
	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}
	const left = String(a);
	const right = String(b);
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function unionRolePins(rolePins: Map<string, Set<PinId>>): PinId[] {
	const all = new Set<PinId>();
	rolePins.forEach((pins) => {
		pins.forEach((pinId) => all.add(pinId));
	});
	return Array.from(all).sort(comparePinId);
}

function normalizePinRange(raw: unknown): { min: number; max: number } | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as { min?: unknown; max?: unknown };
	const min = normalizeNumber(record?.min);
	const max = normalizeNumber(record?.max);
	if (min === null || max === null || min < 0 || max < min) {
		return null;
	}
	return { min, max };
}

function capabilityEntryHasPin(entry: unknown, pinId: PinId): boolean {
	const normalized = asPinId(entry);
	if (normalized !== null) {
		return normalized === pinId;
	}

	if (Array.isArray(entry)) {
		return entry.some((value) => capabilityEntryHasPin(value, pinId));
	}

	if (entry && typeof entry === 'object') {
		return Object.values(entry).some((value) => capabilityEntryHasPin(value, pinId));
	}

	return false;
}

export class PinCapability {
	readonly id: PinId;
	readonly label: string;
	readonly aliases: string[];
	readonly digital: DigitalCapability;
	readonly pull: PullDirection[];
	readonly fixedPull: PullDirection | null;
	readonly pullValuesOhm: PullValuesOhm | null;
	readonly pwm: PwmCapability | null;
	readonly adc: AdcCapability | null;
	readonly dac: DacCapability | null;
	readonly touch: TouchCapability | null;
	readonly uart: UartCapability | null;
	readonly i2c: I2cCapability | null;
	readonly spi: SpiCapability | null;
	readonly i2s: I2sCapability | null;
	readonly rtc: RtcCapability | null;
	readonly strapping: StrappingCapability | null;
	readonly reserved: ReservedCapability | null;
	readonly voltage: VoltageCapability | null;
	readonly peripherals: Record<string, unknown>;
	readonly notes: string[];
	readonly claims: PinClaim[];

	constructor(pinId: unknown, payload: PinCapabilityPayload = {}) {
		const normalizedId = asPinId(pinId);
		if (normalizedId === null) {
			throw new Error('PinCapability requires a valid pin id.');
		}

		this.id = normalizedId;
		this.label = normalizeString(payload.label) || `Pin ${this.id}`;
		this.aliases = normalizeStringList(payload.aliases);
		this.digital = {
			input: Boolean(payload.digital?.input),
			output: Boolean(payload.digital?.output),
			openDrain: Boolean(payload.digital?.openDrain),
		};
		this.pull = normalizePull(payload.pull);
		this.fixedPull = normalizeFixedPull(payload.fixedPull);
		this.pullValuesOhm = normalizePullValuesOhm(payload.pullValuesOhm);
		this.pwm = normalizePwm(payload.pwm);
		this.adc = normalizeAdc(payload.adc);
		this.dac = normalizeDac(payload.dac);
		this.touch = normalizeTouch(payload.touch);
		this.uart = normalizeUart(payload.uart);
		this.i2c = normalizeI2c(payload.i2c);
		this.spi = normalizeSpi(payload.spi);
		this.i2s = normalizeI2s(payload.i2s);
		this.rtc = normalizeRtc(payload.rtc);
		this.strapping = normalizeStrapping(payload.strapping);
		this.reserved = normalizeReserved(payload.reserved);
		this.voltage = normalizeVoltage(payload.voltage);
		this.peripherals = normalizePeripherals(payload.peripherals);
		this.notes = normalizeNoteList(payload.notes);
		this.claims = normalizeClaims(payload.claims);
	}
}

interface SpiBusRoles {
	cs: Set<PinId>;
	sck: Set<PinId>;
	mosi: Set<PinId>;
	miso: Set<PinId>;
}

export class DeviceTargetInfo {
	readonly id: string | null;
	readonly displayName: string | null;
	readonly description: string | null;
	readonly generalCapabilities: Record<string, unknown>;
	readonly metadata: Record<string, unknown>;
	readonly resources: Record<string, ResourceLimits>;
	readonly instanceData: Record<string, unknown>;
	readonly isOpenPinSet: boolean;
	readonly pinRange: { min: number; max: number } | null;
	readonly pinCapabilities: Map<PinId, PinCapability>;
	readonly capabilityToPins: Record<string, unknown>;
	readonly capabilityRegistry: CapabilityRegistry;
	#emitBusQualifiedKeys: boolean;

	constructor(payload: DeviceTargetPayload = {}, options: { emitBusQualifiedKeys?: boolean } = {}) {
		this.#emitBusQualifiedKeys = options.emitBusQualifiedKeys === true;
		this.id = normalizeString(payload.targetId ?? payload.id);
		this.displayName = normalizeString(payload.displayName);
		this.description = normalizeString(payload.description);
		this.generalCapabilities = payload.generalCapabilities || {};
		this.metadata = this.#normalizeMetadata(payload.metadata);
		this.resources = normalizeResources(payload.resources);
		this.instanceData = payload.instanceData || {
			userDescription: null,
			configPath: null,
			uploadedAt: null,
		};
		this.pinRange = normalizePinRange(payload.openPins);
		this.isOpenPinSet = this.pinRange !== null;

		this.pinCapabilities = this.#buildPinCapabilities(payload);
		this.capabilityRegistry = new CapabilityRegistry();
		this.capabilityToPins =
			payload.capabilityToPins && typeof payload.capabilityToPins === 'object'
				? payload.capabilityToPins
				: this.#buildCapabilityToPins();
	}

	static async loadFromUrl(url: string, fetchImpl: FetchLike | null = DEFAULT_FETCH): Promise<DeviceTargetInfo> {
		if (!fetchImpl) {
			throw new Error('Fetch implementation is required to load a device target.');
		}

		const response = await fetchImpl(url, { cache: 'no-store' });
		if (!response || !response.ok) {
			throw new Error(`Failed to load device target from ${url}`);
		}

		const payload = (await response.json()) as DeviceTargetPayload;
		return new DeviceTargetInfo(payload);
	}

	getPinCapability(pinId: unknown): PinCapability | null {
		const normalized = asPinId(pinId);
		if (normalized === null) {
			return null;
		}
		if (this.isOpenPinSet && typeof normalized === 'number' && this.#inOpenRange(normalized)) {
			return new PinCapability(normalized, {
				label: `GPIO${normalized}`,
				digital: { input: true, output: true },
				pull: ['up', 'down'],
			});
		}
		return this.pinCapabilities.get(normalized) || null;
	}

	getPinsForCapability(capabilityKey: string): unknown {
		if (!capabilityKey) {
			return null;
		}
		if (this.isOpenPinSet && this.pinRange) {
			const pins: number[] = [];
			for (let pin = this.pinRange.min; pin <= this.pinRange.max; pin += 1) {
				pins.push(pin);
			}
			return pins;
		}
		return this.capabilityToPins?.[capabilityKey] ?? null;
	}

	hasPinCapability(pinId: unknown, capabilityKey: string): boolean {
		if (!capabilityKey) {
			return false;
		}

		const normalizedPinId = asPinId(pinId);
		if (normalizedPinId === null) {
			return false;
		}

		if (
			this.isOpenPinSet &&
			typeof normalizedPinId === 'number' &&
			this.#inOpenRange(normalizedPinId)
		) {
			return true;
		}

		const capabilityEntry = this.getPinsForCapability(capabilityKey);
		return capabilityEntryHasPin(capabilityEntry, normalizedPinId);
	}

	hasClaimConflict(pinId: unknown, capabilityKey: string): PinClaim[] {
		if (!capabilityKey) {
			return [];
		}
		const pin = this.getPinCapability(pinId);
		if (!pin) {
			return [];
		}
		return pin.claims.filter(
			(claim) => claim.conflicts.length === 0 || claim.conflicts.includes(capabilityKey)
		);
	}

	#inOpenRange(pin: number): boolean {
		return this.pinRange !== null && pin >= this.pinRange.min && pin <= this.pinRange.max;
	}

	#normalizeMetadata(rawMetadata: Record<string, unknown> | undefined): Record<string, unknown> {
		const metadata = rawMetadata && typeof rawMetadata === 'object' ? { ...rawMetadata } : {};
		const defaultI2cBus = normalizeBusId(metadata.defaultI2cBus, 'i2c');
		const defaultUart = normalizeBusId(metadata.defaultUart, 'uart');
		const defaultSpiBus = normalizeBusId(metadata.defaultSpiBus, 'spi');
		if (defaultI2cBus !== null) {
			metadata.defaultI2cBus = defaultI2cBus;
		}
		if (defaultUart !== null) {
			metadata.defaultUart = defaultUart;
		}
		if (defaultSpiBus !== null) {
			metadata.defaultSpiBus = defaultSpiBus;
		}
		return metadata;
	}

	#buildPinCapabilities(payload: DeviceTargetPayload): Map<PinId, PinCapability> {
		const pinCaps = new Map<PinId, PinCapability>();
		const legacyPins = this.#indexLegacyPins(payload.pins);
		const rawPinCaps = payload.pinCapabilities || {};

		Object.entries(rawPinCaps).forEach(([rawId, rawPayload]) => {
			const pinId = asPinId(rawId);
			if (pinId === null) {
				return;
			}
			const merged = this.#mergePinPayload(rawPayload, legacyPins.get(pinId));
			pinCaps.set(pinId, new PinCapability(pinId, merged));
		});

		return pinCaps;
	}

	#indexLegacyPins(rawPins: LegacyPinRecord[] | undefined): Map<PinId, PinLegacyMetadata> {
		const byId = new Map<PinId, PinLegacyMetadata>();
		if (!Array.isArray(rawPins)) {
			return byId;
		}

		rawPins.forEach((pin) => {
			const pinId = asPinId(pin?.id);
			if (pinId === null) {
				return;
			}
			byId.set(pinId, {
				label: normalizeString(pin?.label),
				aliases: normalizeStringList(pin?.aliases),
				notes: normalizeNoteList(pin?.notes),
			});
		});

		return byId;
	}

	#mergePinPayload(
		rawPayload: PinCapabilityPayload,
		legacyMeta: PinLegacyMetadata | undefined
	): PinCapabilityPayload {
		const mergedAliases = normalizeStringList([
			...(Array.isArray(rawPayload?.aliases) ? rawPayload.aliases : []),
			...(legacyMeta?.aliases || []),
		]);
		const mergedNotes = normalizeNoteList(rawPayload?.notes, legacyMeta?.notes);
		return {
			...rawPayload,
			label: normalizeString(rawPayload?.label) || normalizeString(legacyMeta?.label),
			aliases: mergedAliases,
			notes: mergedNotes,
		};
	}

	/**
	 * Derive the `capabilityToPins` map from the per-pin capability records.
	 *
	 * The `irq` key is derived, not declared per target, because every GPIO that
	 * can read a level can raise an edge interrupt in MicroPython.
	 */
	#buildCapabilityToPins(): Record<string, unknown> {
		const capabilityMap: Record<string, unknown> = {};
		const digitalInput = new Set<PinId>();
		const irqPins = new Set<PinId>();
		const digitalOutput = new Set<PinId>();
		const pwmInput = new Set<PinId>();
		const pwmOutput = new Set<PinId>();
		const pullUp = new Set<PinId>();
		const pullDown = new Set<PinId>();
		const adcPins = new Set<PinId>();
		const dacPins = new Set<PinId>();
		const touchPins = new Set<PinId>();
		const rtcPins = new Set<PinId>();
		const i2sPins = new Set<PinId>();
		const i2sRolePins = new Map<string, Set<PinId>>();
		const peripheralPins = new Map<string, Set<PinId>>();
		const peripheralRolePins = new Map<string, Map<string, Set<PinId>>>();
		const uartByPort = new Map<string | null, Record<string, unknown>>();
		const i2cByBus = new Map<string | null, Record<string, unknown>>();
		const spiByBus = new Map<string, SpiBusRoles>();
		const uartRolePins = new Map<string, Set<PinId>>();
		const i2cRolePins = new Map<string, Set<PinId>>();
		const spiRolePins = new Map<string, Set<PinId>>();
		const adcUnit1Pins = new Set<PinId>();
		const adcUnit2Pins = new Set<PinId>();

		this.pinCapabilities.forEach((pinCap, pinId) => {
			if (pinCap.digital.input) {
				digitalInput.add(pinId);
				irqPins.add(pinId);
			}
			if (pinCap.digital.output) {
				digitalOutput.add(pinId);
			}

			if (pinCap.pwm?.input) {
				pwmInput.add(pinId);
			}
			if (pinCap.pwm?.output) {
				pwmOutput.add(pinId);
			}

			if (pinCap.pull.includes('up')) {
				pullUp.add(pinId);
			}
			if (pinCap.pull.includes('down')) {
				pullDown.add(pinId);
			}

			if (pinCap.adc) {
				adcPins.add(pinId);
				if (pinCap.adc.unit === 1) {
					adcUnit1Pins.add(pinId);
				} else if (pinCap.adc.unit === 2) {
					adcUnit2Pins.add(pinId);
				}
			}

			if (pinCap.uart && pinCap.uart.roles.length > 0) {
				const portKey = pinCap.uart.port || null;
				const entry = uartByPort.get(portKey) || {};
				pinCap.uart.roles.forEach((role) => {
					entry[role] = pinId;
					if (!uartRolePins.has(role)) {
						uartRolePins.set(role, new Set<PinId>());
					}
					uartRolePins.get(role)?.add(pinId);
				});
				if (portKey) {
					entry.port = portKey;
				}
				uartByPort.set(portKey, entry);
			}

			if (pinCap.i2c && pinCap.i2c.roles.length > 0) {
				const busKey = pinCap.i2c.bus || null;
				const entry = i2cByBus.get(busKey) || {};
				pinCap.i2c.roles.forEach((role) => {
					entry[role] = pinId;
					if (!i2cRolePins.has(role)) {
						i2cRolePins.set(role, new Set<PinId>());
					}
					i2cRolePins.get(role)?.add(pinId);
				});
				if (busKey) {
					entry.bus = busKey;
				}
				i2cByBus.set(busKey, entry);
			}

			if (pinCap.spi && pinCap.spi.roles.length > 0) {
				const busKey = pinCap.spi.bus || 'default';
				if (!spiByBus.has(busKey)) {
					spiByBus.set(busKey, {
						cs: new Set<number>(),
						sck: new Set<number>(),
						mosi: new Set<number>(),
						miso: new Set<number>(),
					});
				}

				const entry = spiByBus.get(busKey);
				pinCap.spi.roles.forEach((role) => {
					if (entry?.[role as keyof SpiBusRoles]) {
						entry[role as keyof SpiBusRoles].add(pinId);
					}
					if (!spiRolePins.has(role)) {
						spiRolePins.set(role, new Set<PinId>());
					}
					spiRolePins.get(role)?.add(pinId);
				});
			}

			if (pinCap.dac) {
				dacPins.add(pinId);
			}
			if (pinCap.touch) {
				touchPins.add(pinId);
			}
			if (pinCap.rtc) {
				rtcPins.add(pinId);
			}
			if (pinCap.i2s && pinCap.i2s.roles.length > 0) {
				i2sPins.add(pinId);
				pinCap.i2s.roles.forEach((role) => {
					if (!i2sRolePins.has(role)) {
						i2sRolePins.set(role, new Set<PinId>());
					}
					i2sRolePins.get(role)?.add(pinId);
				});
			}

			Object.entries(pinCap.peripherals || {}).forEach(([peripheralId, rawPayload]) => {
				if (!peripheralId) {
					return;
				}
				if (!peripheralPins.has(peripheralId)) {
					peripheralPins.set(peripheralId, new Set<PinId>());
				}
				peripheralPins.get(peripheralId)?.add(pinId);

				const role =
					rawPayload && typeof rawPayload === 'object'
						? (rawPayload as Record<string, unknown>).role
						: null;
				if (typeof role === 'string' && role) {
					if (!peripheralRolePins.has(peripheralId)) {
						peripheralRolePins.set(peripheralId, new Map<string, Set<PinId>>());
					}
					const roleMap = peripheralRolePins.get(peripheralId);
					if (roleMap) {
						if (!roleMap.has(role)) {
							roleMap.set(role, new Set<PinId>());
						}
						roleMap.get(role)?.add(pinId);
					}
				}
			});
		});

		const assignIfNotEmpty = (key: string, set: Set<PinId>) => {
			if (set.size) {
				capabilityMap[key] = Array.from(set).sort(comparePinId);
			}
		};

		assignIfNotEmpty('digital.input', digitalInput);
		assignIfNotEmpty('irq', irqPins);
		assignIfNotEmpty('digital.output', digitalOutput);
		assignIfNotEmpty('pwm.input', pwmInput);
		assignIfNotEmpty('pwm.output', pwmOutput);
		assignIfNotEmpty('pull.up', pullUp);
		assignIfNotEmpty('pull.down', pullDown);
		assignIfNotEmpty('dac', dacPins);
		assignIfNotEmpty('touch', touchPins);
		assignIfNotEmpty('rtc', rtcPins);
		assignIfNotEmpty('i2s', i2sPins);
		i2sRolePins.forEach((pins, role) => {
			assignIfNotEmpty(`i2s.${role}`, pins);
		});
		peripheralPins.forEach((pins, id) => {
			assignIfNotEmpty(id, pins);
		});
		peripheralRolePins.forEach((roleMap, id) => {
			roleMap.forEach((pins, role) => {
				assignIfNotEmpty(`${id}.${role}`, pins);
			});
		});
		uartRolePins.forEach((pins, role) => {
			assignIfNotEmpty(`uart.${role}`, pins);
		});
		i2cRolePins.forEach((pins, role) => {
			assignIfNotEmpty(`i2c.${role}`, pins);
		});
		spiRolePins.forEach((pins, role) => {
			assignIfNotEmpty(`spi.${role}`, pins);
		});
		assignIfNotEmpty('adc.unit1', adcUnit1Pins);
		assignIfNotEmpty('adc.unit2', adcUnit2Pins);
		assignIfNotEmpty('adc.wifiSafe', adcUnit1Pins);

		if (adcPins.size) {
			capabilityMap.adc = [Array.from(adcPins).sort(comparePinId)];
		}

		if (uartRolePins.size) {
			capabilityMap.uart = unionRolePins(uartRolePins);
		}

		if (i2cRolePins.size) {
			capabilityMap.i2c = unionRolePins(i2cRolePins);
		}

		if (spiRolePins.size) {
			capabilityMap.spi = unionRolePins(spiRolePins);
		}

		if (this.#emitBusQualifiedKeys) {
			uartByPort.forEach((entry, portKey) => {
				if (!portKey) {
					return;
				}
				for (const role of ['tx', 'rx']) {
					const pin = entry[role];
					if (pin !== undefined) {
						capabilityMap[`uart.${portKey}.${role}`] = [pin];
					}
				}
			});
			i2cByBus.forEach((entry, busKey) => {
				if (!busKey) {
					return;
				}
				for (const role of ['sda', 'scl']) {
					const pin = entry[role];
					if (pin !== undefined) {
						capabilityMap[`i2c.${busKey}.${role}`] = [pin];
					}
				}
			});
			spiByBus.forEach((roles, busKey) => {
				if (!busKey || busKey === 'default') {
					return;
				}
				for (const role of ['cs', 'sck', 'mosi', 'miso'] as const) {
					const pins = roles[role];
					if (pins && pins.size) {
						capabilityMap[`spi.${busKey}.${role}`] = Array.from(pins).sort(comparePinId);
					}
				}
			});
		}

		return capabilityMap;
	}
}

export default DeviceTargetInfo;
