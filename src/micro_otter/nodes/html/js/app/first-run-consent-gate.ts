import { IconProvider } from '../views/icon-provider.js';

interface ConsentCopy {
    aboutSentence: string;
    title: string;
    availableLanguagesLabel: string;
    privacyNoticeLabel: string;
    technicalStorage: string;
    clientOnly: string;
    autosave: string;
    dataLossWarning: string;
    legalScope: string;
    acceptLabel: string;
}

type SupportedLocale = 'en' | 'de';

interface LocaleManifestEntry {
    code: string;
    label?: string;
    icon?: string;
}

interface LocaleManifest {
    locales: LocaleManifestEntry[];
    defaultLocale?: string;
}

interface ConsentGateOptions {
    localeManifest?: LocaleManifest | null;
}

interface LanguageButtonEntry {
    button: HTMLButtonElement;
    localeCode: string;
}

const CONSENT_STORAGE_KEY = 'microOtter.storageNoticeAcknowledged.v1';
const LEGACY_CONSENT_STORAGE_KEY = 'microOtter.technicalStorageConsent.v1';
const CONSENT_ACCEPTED_VALUE = 'accepted';

const FALLBACK_MANIFEST: LocaleManifest = {
    defaultLocale: 'en',
    locales: [
        { code: 'en', label: 'English', icon: 'icon-en.svg' },
        { code: 'de', label: 'Deutsch', icon: 'icon-de.svg' },
    ],
};

const CONSENT_COPY: Record<SupportedLocale, ConsentCopy> = {
    en: {
        aboutSentence:
            'The Micro Otter node editor lets you design and deploy behavior graphs for embedded controllers, bridging intuitive visual workflows with deployable firmware.',
        title: 'Storage and Privacy Notice',
        availableLanguagesLabel: 'Available languages',
        privacyNoticeLabel: 'Read full privacy notice',
        technicalStorage:
            'Micro Otter uses only technical cookies and local browser storage that are required for core editor functions. There are currently no tracking cookies.',
        clientOnly:
            'The app runs purely on your client machine. All project data is stored locally in your browser database.',
        autosave: 'Changes to graphs are stored automatically.',
        dataLossWarning:
            'If you delete all browser data, your stored graphs and settings are deleted as well. Regular backups are strongly advised.',
        legalScope:
            'Selecting "I Understand and Continue" acknowledges this storage and privacy notice for transparency under GDPR and similar regulations.',
        acceptLabel: 'I Understand and Continue',
    },
    de: {
        aboutSentence:
            'Der Micro-Otter-Knoten-Editor ermöglicht das Entwerfen und Bereitstellen von Verhaltensgraphen für eingebettete Controller und verbindet intuitive Workflows mit einsatzbereiter Firmware.',
        title: 'Speicher- und Datenschutzhinweis',
        availableLanguagesLabel: 'Verfügbare Sprachen',
        privacyNoticeLabel: 'Vollständigen Datenschutzhinweis lesen',
        technicalStorage:
            'Micro Otter verwendet ausschließlich technisch notwendige Cookies und lokale Browser-Speicherfunktionen für den Betrieb des Editors. Tracking-Cookies werden derzeit nicht verwendet.',
        clientOnly:
            'Die App läuft vollständig auf deinem lokalen Rechner. Alle Projektdaten werden lokal in der Browser-Datenbank gespeichert.',
        autosave: 'Änderungen an Graphen werden automatisch gespeichert.',
        dataLossWarning:
            'Wenn du alle Browserdaten löschst, werden auch gespeicherte Graphen und Einstellungen gelöscht. Regelmäßige Backups werden dringend empfohlen.',
        legalScope:
            'Mit „Ich habe verstanden und fortfahren“ bestätigst du, dass du diesen Speicher- und Datenschutzhinweis gemäß DSGVO und ähnlichen Regelwerken gelesen hast.',
        acceptLabel: 'Ich habe verstanden und fortfahren',
    },
};

function resolveConsentCopyLocale(localeCode: string): SupportedLocale {
    if (localeCode.startsWith('de')) {
        return 'de';
    }
    return 'en';
}

function resolvePreferredLocale(manifest: LocaleManifest): string {
    const manifestLocales = manifest.locales.map((entry) => entry.code.toLowerCase());
    if (manifestLocales.length === 0) {
        return FALLBACK_MANIFEST.defaultLocale || 'en';
    }

    const requestedLocales = [
        ...(globalThis.navigator?.languages || []),
        globalThis.navigator?.language || '',
    ]
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .map((entry) => entry.toLowerCase());

    for (const requested of requestedLocales) {
        if (manifestLocales.includes(requested)) {
            return requested;
        }

        const languageOnly = requested.split('-')[0];
        const matched = manifestLocales.find((code) => code === languageOnly || code.startsWith(`${languageOnly}-`));
        if (matched) {
            return matched;
        }
    }

    const fallback = (manifest.defaultLocale || FALLBACK_MANIFEST.defaultLocale || 'en').toLowerCase();
    return manifestLocales.includes(fallback) ? fallback : manifestLocales[0];
}

function sanitizeManifest(manifest: unknown): LocaleManifest {
    const parsed = manifest as LocaleManifest | null;
    if (!parsed || !Array.isArray(parsed.locales)) {
        return FALLBACK_MANIFEST;
    }

    const locales = parsed.locales.filter((entry) => typeof entry?.code === 'string' && entry.code.length > 0);
    if (locales.length === 0) {
        return FALLBACK_MANIFEST;
    }

    return {
        defaultLocale: typeof parsed.defaultLocale === 'string' ? parsed.defaultLocale : FALLBACK_MANIFEST.defaultLocale,
        locales,
    };
}

async function loadLocaleManifest(): Promise<LocaleManifest> {
    if (typeof globalThis.fetch !== 'function') {
        return FALLBACK_MANIFEST;
    }

    try {
        const response = await globalThis.fetch('/html/locales/locales.json', { cache: 'no-cache' });
        if (!response.ok) {
            return FALLBACK_MANIFEST;
        }

        const manifest = await response.json();
        return sanitizeManifest(manifest);
    } catch {
        return FALLBACK_MANIFEST;
    }
}

function hasAcceptedConsent(storage: Storage | null | undefined): boolean {
    if (!storage) {
        return false;
    }

    try {
        const hasCurrentValue = storage.getItem(CONSENT_STORAGE_KEY) === CONSENT_ACCEPTED_VALUE;
        const hasLegacyValue =
            storage.getItem(LEGACY_CONSENT_STORAGE_KEY) === CONSENT_ACCEPTED_VALUE;
        return hasCurrentValue || hasLegacyValue;
    } catch {
        return false;
    }
}

function persistConsentAcceptance(storage: Storage | null | undefined): void {
    if (!storage) {
        return;
    }

    try {
        storage.setItem(CONSENT_STORAGE_KEY, CONSENT_ACCEPTED_VALUE);
    } catch {
        // Ignore persistence errors (for example private browsing restrictions).
    }
}

export class FirstRunConsentGate {
    static get storageKey(): string {
        return CONSENT_STORAGE_KEY;
    }

    static needsConsent(storage: Storage | null | undefined = globalThis.localStorage): boolean {
        return !hasAcceptedConsent(storage);
    }

    static async showIfNeeded(
        storage: Storage | null | undefined = globalThis.localStorage,
        { localeManifest = null }: ConsentGateOptions = {}
    ): Promise<void> {
        if (!FirstRunConsentGate.needsConsent(storage)) {
            return;
        }

        const manifest = localeManifest ? sanitizeManifest(localeManifest) : await loadLocaleManifest();
        const preferredLocale = resolvePreferredLocale(manifest);

        await new Promise<void>((resolve: () => void) => {
            const container = document.createElement('div');
            container.className = 'first-run-consent';

            const backdrop = document.createElement('div');
            backdrop.className = 'first-run-consent__backdrop';

            const card = document.createElement('section');
            card.className = 'first-run-consent__card';
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-modal', 'true');
            card.setAttribute('aria-labelledby', 'first-run-consent-title');

            const title = document.createElement('h1');
            title.id = 'first-run-consent-title';
            title.className = 'first-run-consent__title';

            const hero = document.createElement('div');
            hero.className = 'first-run-consent__hero';

            const logo = document.createElement('img');
            logo.className = 'first-run-consent__logo';
            logo.src = IconProvider.otterWhite128;
            logo.alt = '';
            hero.appendChild(logo);

            hero.appendChild(title);

            const body = document.createElement('div');
            body.className = 'first-run-consent__body';

            const paragraphElements: HTMLParagraphElement[] = [];
            for (let index = 0; index < 6; index += 1) {
                const paragraph = document.createElement('p');
                paragraph.className = 'first-run-consent__paragraph';
                body.appendChild(paragraph);
                paragraphElements.push(paragraph);
            }

            const languageSection = document.createElement('div');
            languageSection.className = 'first-run-consent__languages';

            const languageList = document.createElement('div');
            languageList.className = 'first-run-consent__language-list';

            const languageButtons: LanguageButtonEntry[] = [];
            let activeLocaleCode = preferredLocale;

            for (const locale of manifest.locales) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'first-run-consent__language-chip';
                chip.dataset.localeCode = locale.code;

                if (locale.icon) {
                    const flag = document.createElement('img');
                    flag.className = 'first-run-consent__language-flag';
                    flag.src = `/html/locales/${locale.icon}`;
                    flag.alt = `${locale.code} flag`;
                    chip.appendChild(flag);
                }
                chip.title = locale.label || locale.code.toUpperCase();
                chip.setAttribute('aria-label', locale.label || locale.code.toUpperCase());

                chip.addEventListener('click', () => {
                    activeLocaleCode = locale.code;
                    applyLocaleCopy();
                });

                languageButtons.push({ button: chip, localeCode: locale.code });
                languageList.appendChild(chip);
            }

            languageSection.appendChild(languageList);

            const privacyNoticeLink = document.createElement('a');
            privacyNoticeLink.className = 'first-run-consent__privacy-link';
            privacyNoticeLink.href = '/privacy.html';
            privacyNoticeLink.target = '_blank';
            privacyNoticeLink.rel = 'noopener noreferrer';
            body.appendChild(privacyNoticeLink);

            const actionRow = document.createElement('div');
            actionRow.className = 'first-run-consent__actions';

            const acceptButton = document.createElement('button');
            acceptButton.type = 'button';
            acceptButton.className = 'first-run-consent__accept';

            const applyLocaleCopy = (): void => {
                const copy = CONSENT_COPY[resolveConsentCopyLocale(activeLocaleCode)];

                title.textContent = copy.title;
                paragraphElements[0].textContent = copy.aboutSentence;
                paragraphElements[1].textContent = copy.technicalStorage;
                paragraphElements[2].textContent = copy.clientOnly;
                paragraphElements[3].textContent = copy.autosave;
                paragraphElements[4].textContent = copy.dataLossWarning;
                paragraphElements[5].textContent = copy.legalScope;

                privacyNoticeLink.textContent = copy.privacyNoticeLabel;
                acceptButton.textContent = copy.acceptLabel;
                body.scrollTop = 0;

                for (const entry of languageButtons) {
                    const isActive = entry.localeCode.toLowerCase() === activeLocaleCode.toLowerCase();
                    entry.button.classList.toggle('first-run-consent__language-chip--active', isActive);
                    entry.button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                }
            };

            const finalize = (): void => {
                persistConsentAcceptance(storage);
                container.remove();
                resolve();
            };

            acceptButton.addEventListener('click', finalize, { once: true });

            actionRow.appendChild(acceptButton);
            card.appendChild(hero);
            card.appendChild(languageSection);
            card.appendChild(body);
            card.appendChild(actionRow);

            applyLocaleCopy();

            container.appendChild(backdrop);
            container.appendChild(card);
            document.body.appendChild(container);

            acceptButton.focus();
        });
    }
}
