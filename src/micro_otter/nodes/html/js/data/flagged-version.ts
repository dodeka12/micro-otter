export type VersionSegment = 'major' | 'minor' | 'patch';

export interface DirtyVersionFlags {
	major: boolean;
	minor: boolean;
	patch: boolean;
}

export interface FlaggedVersionData {
	major?: number;
	minor?: number;
	patch?: number;
	dirty?: Partial<DirtyVersionFlags>;
	version_string?: string | null;
}

export class FlaggedVersion {
	major: number;
	minor: number;
	patch: number;
	dirty: DirtyVersionFlags;

	constructor({
		major = 0,
		minor = 0,
		patch = 0,
		dirty = { major: false, minor: false, patch: false },
		version_string = null,
	}: FlaggedVersionData = {}) {
		this.major = 0;
		this.minor = 0;
		this.patch = 0;
		this.dirty = { major: false, minor: false, patch: false };

		if (version_string && typeof version_string === 'string') {
			this.fromString(version_string);
			return;
		}

		this.major = Number.isInteger(major) ? major : 0;
		this.minor = Number.isInteger(minor) ? minor : 0;
		this.patch = Number.isInteger(patch) ? patch : 0;
		this.dirty = {
			major: Boolean(dirty.major),
			minor: Boolean(dirty.minor),
			patch: Boolean(dirty.patch),
		};
	}

	fromString(versionString: string): void {
		if (typeof versionString !== 'string') {
			throw new TypeError('Version string must be a string.');
		}
		const match = versionString.match(/^(\d+)\.(\d+)\.(\d+)(\*)?$/);
		if (!match) {
			throw new Error('Invalid version string format.');
		}

		this.major = Number.parseInt(match[1], 10);
		this.minor = Number.parseInt(match[2], 10);
		this.patch = Number.parseInt(match[3], 10);
		this.dirty = { major: false, minor: false, patch: false };

		if (match[4] === '*') {
			this.markDirty();
		}
	}

	assertSegment(segment: VersionSegment): void {
		if (!['major', 'minor', 'patch'].includes(segment)) {
			throw new Error(`Invalid segment "${segment}"`);
		}
	}

	setSegment(segment: VersionSegment, value: number, markDirty = true): void {
		this.assertSegment(segment);
		const next = Number.isInteger(value) ? value : 0;
		this[segment] = next;
		if (markDirty) {
			this.dirty[segment] = true;
		}
	}

	bump(segment: VersionSegment = 'patch'): FlaggedVersion {
		this.assertSegment(segment);
		if (segment === 'major') {
			this.major += 1;
			this.minor = 0;
			this.patch = 0;
		} else if (segment === 'minor') {
			this.minor += 1;
			this.patch = 0;
		} else {
			this.patch += 1;
		}
		this.markDirty(segment);
		return this;
	}

	bumpIfDirty(): boolean {
		if (this.dirty.major) {
			this.bump('major');
			this.clearDirty();
			return true;
		}
		if (this.dirty.minor) {
			this.bump('minor');
			this.clearDirty();
			return true;
		}
		if (this.dirty.patch) {
			this.bump('patch');
			this.clearDirty();
			return true;
		}

		return false;
	}

	markDirty(segment?: VersionSegment): void {
		if (segment) {
			this.assertSegment(segment);
			this.dirty[segment] = true;
			return;
		}

		this.dirty.major = true;
		this.dirty.minor = true;
		this.dirty.patch = true;
	}

	clearDirty(segment?: VersionSegment): void {
		if (segment) {
			this.assertSegment(segment);
			this.dirty[segment] = false;
			return;
		}

		this.dirty.major = false;
		this.dirty.minor = false;
		this.dirty.patch = false;
	}

	isDirty(segment?: VersionSegment): boolean {
		if (segment) {
			this.assertSegment(segment);
			return this.dirty[segment];
		}
		return this.dirty.major || this.dirty.minor || this.dirty.patch;
	}

	clone(): FlaggedVersion {
		return new FlaggedVersion({
			major: this.major,
			minor: this.minor,
			patch: this.patch,
			dirty: { ...this.dirty },
		});
	}

	toString(): string {
		const flag = this.isDirty() ? '*' : '';
		return `${this.major}.${this.minor}.${this.patch}${flag}`;
	}

	toData(): Required<Omit<FlaggedVersionData, 'version_string'>> {
		return {
			major: this.major,
			minor: this.minor,
			patch: this.patch,
			dirty: { ...this.dirty },
		};
	}

	static fromData(data: FlaggedVersionData = {}): FlaggedVersion {
		const major = Number.isInteger(data.major) ? data.major : 0;
		const minor = Number.isInteger(data.minor) ? data.minor : 0;
		const patch = Number.isInteger(data.patch) ? data.patch : 0;
		const dirty: DirtyVersionFlags = {
			major: Boolean(data.dirty?.major),
			minor: Boolean(data.dirty?.minor),
			patch: Boolean(data.dirty?.patch),
		};
		return new FlaggedVersion({ major, minor, patch, dirty });
	}
}
