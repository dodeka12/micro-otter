// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

type LocalizedNameMap = Record<string, string>;

interface ResolveNodeDisplayNameInput {
	userName?: unknown;
	typeName?: unknown;
	type?: unknown;
	locale?: string;
}

function normalizeLocaleCode(locale: unknown): string {
	if (typeof locale !== 'string') {
		return 'en';
	}
	const trimmed = locale.trim();
	return trimmed || 'en';
}

export function normalizeUserName(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function normalizeUserNameMap(value: unknown, defaultLocale = 'en'): LocalizedNameMap | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === 'string') {
		const normalized = normalizeUserName(value);
		if (!normalized) {
			return null;
		}
		const locale = normalizeLocaleCode(defaultLocale);
		return { [locale]: normalized };
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const normalizedEntries = Object.entries(value as Record<string, unknown>).reduce<LocalizedNameMap>((acc, [locale, localeValue]) => {
		if (typeof locale !== 'string') {
			return acc;
		}

		const normalizedLocaleValue = normalizeUserName(localeValue);
		if (!normalizedLocaleValue) {
			return acc;
		}

		const normalizedLocale = normalizeLocaleCode(locale);
		acc[normalizedLocale] = normalizedLocaleValue;
		return acc;
	}, {});

	return Object.keys(normalizedEntries).length > 0 ? normalizedEntries : null;
}

export function cloneUserNameMap(value: unknown, defaultLocale = 'en'): LocalizedNameMap | null {
	const normalized = normalizeUserNameMap(value, defaultLocale);
	return normalized ? { ...normalized } : null;
}

export function resolveUserNameForLocale(userName: unknown, locale = 'en'): string | null {
	const normalizedMap = normalizeUserNameMap(userName, locale);
	if (!normalizedMap) {
		return null;
	}

	const normalizedLocale = normalizeLocaleCode(locale);
	const localeValue = normalizedMap[normalizedLocale];
	return normalizeUserName(localeValue);
}

export function cloneLocalizedName(value: unknown, fallback = 'node'): LocalizedNameMap {
	if (value && typeof value === 'object') {
		return { ...(value as Record<string, string>) };
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed) {
			return { en: trimmed };
		}
	}
	const fallbackValue = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : 'node';
	return { en: fallbackValue };
}

export function resolveLocalizedName(value: unknown, locale = 'en', fallback = ''): string {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed || fallback;
	}

	if (value && typeof value === 'object') {
		const localizedMap = value as Record<string, unknown>;
		const activeLocale = typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';
		const localized = localizedMap[activeLocale];
		if (typeof localized === 'string' && localized.trim()) {
			return localized.trim();
		}

		const english = localizedMap.en;
		if (typeof english === 'string' && english.trim()) {
			return english.trim();
		}

		const firstEntry = Object.values(localizedMap).find(
			(entry) => typeof entry === 'string' && entry.trim()
		);
		if (typeof firstEntry === 'string') {
			return firstEntry.trim();
		}
	}

	return fallback;
}

export function resolveNodeDisplayName({ userName, typeName, type, locale = 'en' }: ResolveNodeDisplayNameInput = {}): string {
	const normalizedUserName = resolveUserNameForLocale(userName, locale);
	if (normalizedUserName) {
		return normalizedUserName;
	}

	const typeFallback = typeof type === 'string' && type.trim() ? type.trim() : 'node';
	return resolveLocalizedName(typeName, locale, typeFallback);
}
