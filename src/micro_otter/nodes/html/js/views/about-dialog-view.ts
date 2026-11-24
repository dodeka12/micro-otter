import { ViewBase } from './view-base.js';
import { IconProvider } from './icon-provider.js';
import { AppPayload } from '../core/app-event.js';
import { OPEN_SOURCE_PACKAGES } from '../core/app-meta.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;

interface AboutDialogViewOptions {
    appVersion?: string;
    logger?: LoggerLike;
    i18nService?: I18nServiceLike;
}

interface AboutDialogViewDeserializeContext {
    i18nService?: I18nServiceLike;
    logger?: LoggerLike;
}

type AboutDialogViewSerialized = ReturnType<ViewBase['serialize']> & {
    type: 'AboutDialogView';
    appVersion: string;
};

interface AboutDialogUI {
    title: HTMLHeadingElement;
    subtitle: HTMLParagraphElement;
    version: HTMLParagraphElement;
    summary: HTMLParagraphElement;
    legalLine: HTMLParagraphElement;
    legalCopyright: HTMLSpanElement;
    legalLicenseLink: HTMLAnchorElement;
    openSourceTitle: HTMLParagraphElement;
    openSourceList: HTMLDivElement;
    linksContainer: HTMLDivElement;
    closeIconButton: HTMLButtonElement;
}

interface AboutDialogLink {
    key: string;
    url: string;
}

class AboutDialogViewClosePayload extends AppPayload {
    constructor() {
        super('AboutDialogView.Close.v1');
    }
}

export class AboutDialogView extends ViewBase {
    appVersion: string;
    rootElement: HTMLElement | null;

    private _ui: AboutDialogUI | null;

    constructor({ appVersion = '0.0.0-dev', logger = null, i18nService = null }: AboutDialogViewOptions = {}) {
        super({
            title: 'About',
            icon: null,
            id: 'about-dialog',
            logger,
            i18nService,
            minWidth: 620,
            minHeight: 360,
        });

        this.appVersion = appVersion;
        this.rootElement = null;
        this._ui = null;
    }

    override render(container: HTMLElement): void {
        const repoBaseUrl = 'https://github.com/micro-otter';
        const wrapper = document.createElement('div');
        wrapper.className = 'about-dialog';
        wrapper.style.width = 'min(680px, calc(100vw - 48px))';
        wrapper.style.maxWidth = '680px';
        wrapper.style.padding = '22px 24px';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '14px';
        wrapper.style.color = '#e7ebff';
        wrapper.style.background =
            'linear-gradient(165deg, rgba(18, 25, 38, 0.98), rgba(9, 13, 24, 0.98))';
        wrapper.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        wrapper.style.borderRadius = '12px';
        wrapper.style.boxShadow =
            '0 24px 56px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.02)';
        wrapper.style.boxSizing = 'border-box';
        wrapper.style.position = 'relative';

        const closeIconButton = document.createElement('button');
        closeIconButton.type = 'button';
        closeIconButton.title = this.t('dialog.closeAria');
        closeIconButton.setAttribute('aria-label', this.t('dialog.closeAria'));
        closeIconButton.style.position = 'absolute';
        closeIconButton.style.top = '10px';
        closeIconButton.style.right = '10px';
        closeIconButton.style.width = '26px';
        closeIconButton.style.height = '26px';
        closeIconButton.style.padding = '4px';
        closeIconButton.style.border = '1px solid rgba(255, 255, 255, 0.16)';
        closeIconButton.style.borderRadius = '6px';
        closeIconButton.style.background = 'rgba(255, 255, 255, 0.04)';
        closeIconButton.style.cursor = 'pointer';
        closeIconButton.style.display = 'flex';
        closeIconButton.style.alignItems = 'center';
        closeIconButton.style.justifyContent = 'center';

        const closeIconImage = document.createElement('img');
        closeIconImage.src = IconProvider.close;
        closeIconImage.alt = '';
        closeIconImage.style.width = '14px';
        closeIconImage.style.height = '14px';
        closeIconImage.style.filter = 'brightness(0) invert(1)';
        closeIconImage.style.opacity = '0.86';
        closeIconButton.appendChild(closeIconImage);

        closeIconButton.addEventListener('mouseenter', () => {
            closeIconButton.style.background = 'rgba(255, 255, 255, 0.12)';
            closeIconButton.style.borderColor = 'rgba(255, 255, 255, 0.26)';
        });

        closeIconButton.addEventListener('mouseleave', () => {
            closeIconButton.style.background = 'rgba(255, 255, 255, 0.04)';
            closeIconButton.style.borderColor = 'rgba(255, 255, 255, 0.16)';
        });

        closeIconButton.addEventListener('click', () => {
            this._emit('close', new AboutDialogViewClosePayload());
        });

        wrapper.appendChild(closeIconButton);

        const hero = document.createElement('div');
        hero.style.display = 'flex';
        hero.style.flexDirection = 'column';
        hero.style.alignItems = 'center';
        hero.style.gap = '8px';

        const logo = document.createElement('img');
        logo.src = IconProvider.otterWhite128;
        logo.alt = '';
        logo.style.width = '52px';
        logo.style.height = '52px';
        logo.style.opacity = '0.95';
        hero.appendChild(logo);

        const title = document.createElement('h1');
        title.textContent = this.t('dialog.about.title');
        title.style.margin = '0';
        title.style.fontSize = '28px';
        title.style.fontWeight = '700';
        title.style.letterSpacing = '0.02em';
        title.style.textAlign = 'center';
        title.style.color = '#e7ebff';
        hero.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.textContent = this.t('dialog.about.subtitle');
        subtitle.style.margin = '0';
        subtitle.style.fontSize = '14px';
        subtitle.style.textAlign = 'center';
        subtitle.style.color = 'rgba(231, 235, 255, 0.78)';
        hero.appendChild(subtitle);

        wrapper.appendChild(hero);

        const metaCard = document.createElement('div');
        metaCard.style.display = 'flex';
        metaCard.style.flexDirection = 'column';
        metaCard.style.gap = '8px';
        metaCard.style.padding = '12px 14px';
        metaCard.style.background = 'rgba(255, 255, 255, 0.03)';
        metaCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        metaCard.style.borderRadius = '10px';

        const version = document.createElement('p');
        version.textContent = this.t('dialog.about.versionLabel', { version: this.appVersion });
        version.style.margin = '0';
        version.style.fontSize = '12px';
        version.style.textAlign = 'center';
        version.style.color = 'rgba(231, 235, 255, 0.7)';
        version.style.fontFamily = 'monospace';
        metaCard.appendChild(version);

        const summary = document.createElement('p');
        summary.textContent = this.t('dialog.about.summary');
        summary.style.margin = '0';
        summary.style.fontSize = '13px';
        summary.style.lineHeight = '1.45';
        summary.style.textAlign = 'center';
        summary.style.color = 'rgba(231, 235, 255, 0.72)';
        metaCard.appendChild(summary);

        const legalLine = document.createElement('p');
        legalLine.style.margin = '0';
        legalLine.style.fontSize = '12px';
        legalLine.style.textAlign = 'center';
        legalLine.style.color = 'rgba(231, 235, 255, 0.64)';

        const legalCopyright = document.createElement('span');
        legalCopyright.textContent = this.t('dialog.about.copyright');

        const legalSeparator = document.createElement('span');
        legalSeparator.textContent = ' • ';

        const legalLicenseLink = document.createElement('a');
        legalLicenseLink.href = 'https://www.gnu.org/licenses/gpl-3.0.html';
        legalLicenseLink.target = '_blank';
        legalLicenseLink.rel = 'noopener noreferrer';
        legalLicenseLink.textContent = this.t('dialog.about.license');
        legalLicenseLink.style.color = '#7db7ff';
        legalLicenseLink.style.textDecoration = 'none';

        legalLine.appendChild(legalCopyright);
        legalLine.appendChild(legalSeparator);
        legalLine.appendChild(legalLicenseLink);
        metaCard.appendChild(legalLine);

        wrapper.appendChild(metaCard);

        const openSourceCard = document.createElement('div');
        openSourceCard.style.display = 'flex';
        openSourceCard.style.flexDirection = 'column';
        openSourceCard.style.gap = '10px';
        openSourceCard.style.padding = '12px 14px';
        openSourceCard.style.background = 'rgba(255, 255, 255, 0.03)';
        openSourceCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        openSourceCard.style.borderRadius = '10px';

        const openSourceTitle = document.createElement('p');
        openSourceTitle.textContent = this.t('dialog.about.openSourceTitle');
        openSourceTitle.style.margin = '0';
        openSourceTitle.style.fontSize = '13px';
        openSourceTitle.style.fontWeight = '600';
        openSourceTitle.style.color = 'rgba(231, 235, 255, 0.82)';
        openSourceCard.appendChild(openSourceTitle);

        const openSourceList = document.createElement('div');
        openSourceList.style.maxHeight = '150px';
        openSourceList.style.overflowY = 'auto';
        openSourceList.style.display = 'flex';
        openSourceList.style.flexDirection = 'column';
        openSourceList.style.gap = '6px';
        openSourceList.style.padding = '8px';
        openSourceList.style.borderRadius = '8px';
        openSourceList.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        openSourceList.style.background = 'rgba(7, 11, 20, 0.55)';

        OPEN_SOURCE_PACKAGES.forEach((pkg) => {
            const itemRow = document.createElement('div');
            itemRow.style.display = 'flex';
            itemRow.style.justifyContent = 'space-between';
            itemRow.style.alignItems = 'center';
            itemRow.style.gap = '10px';
            itemRow.style.padding = '6px 8px';
            itemRow.style.borderRadius = '6px';
            itemRow.style.background = 'rgba(255, 255, 255, 0.02)';

            const packageLink = document.createElement('a');
            packageLink.href = pkg.url;
            packageLink.target = '_blank';
            packageLink.rel = 'noopener noreferrer';
            packageLink.textContent = pkg.name;
            packageLink.style.color = '#7db7ff';
            packageLink.style.textDecoration = 'none';
            packageLink.style.fontSize = '12px';
            packageLink.style.fontWeight = '500';

            const packageLicense = document.createElement('span');
            packageLicense.textContent = this.t('dialog.about.openSourceLicenseLabel', {
                license: pkg.license,
            });
            packageLicense.style.color = 'rgba(231, 235, 255, 0.7)';
            packageLicense.style.fontSize = '12px';
            packageLicense.style.whiteSpace = 'nowrap';

            itemRow.appendChild(packageLink);
            itemRow.appendChild(packageLicense);
            openSourceList.appendChild(itemRow);
        });

        openSourceCard.appendChild(openSourceList);
        wrapper.appendChild(openSourceCard);

        const separator1 = document.createElement('hr');
        separator1.style.border = 'none';
        separator1.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
        separator1.style.margin = '4px 0';
        wrapper.appendChild(separator1);

        const linksContainer = document.createElement('div');
        linksContainer.style.display = 'flex';
        linksContainer.style.flexWrap = 'wrap';
        linksContainer.style.justifyContent = 'center';
        linksContainer.style.gap = '6px';
        linksContainer.style.alignItems = 'center';

        const links: AboutDialogLink[] = [
            {
                key: 'dialog.about.links.docs',
                url: `${repoBaseUrl}#readme`,
            },
            {
                key: 'dialog.about.links.github',
                url: repoBaseUrl,
            },
            {
                key: 'dialog.about.links.issues',
                url: `${repoBaseUrl}/issues`,
            },
            {
                key: 'dialog.about.links.privacyNotice',
                url: '/privacy.html',
            },
        ];

        links.forEach((linkData) => {
            const link = document.createElement('a');
            link.href = linkData.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = this.t(linkData.key);
            link.dataset.i18nKey = linkData.key;
            link.style.color = '#4a9eff';
            link.style.textDecoration = 'none';
            link.style.fontSize = '12px';
            link.style.padding = '4px 8px';
            link.style.borderRadius = '6px';
            link.style.border = '1px solid rgba(74, 158, 255, 0.35)';
            link.style.background = 'rgba(74, 158, 255, 0.12)';
            link.style.transition = 'background-color 0.2s, border-color 0.2s';

            link.addEventListener('mouseenter', () => {
                link.style.backgroundColor = 'rgba(74, 158, 255, 0.2)';
                link.style.borderColor = 'rgba(74, 158, 255, 0.65)';
            });

            link.addEventListener('mouseleave', () => {
                link.style.backgroundColor = 'rgba(74, 158, 255, 0.12)';
                link.style.borderColor = 'rgba(74, 158, 255, 0.35)';
            });

            linksContainer.appendChild(link);
        });

        wrapper.appendChild(linksContainer);

        container.appendChild(wrapper);
        this.rootElement = wrapper;

        this._ui = {
            title,
            subtitle,
            version,
            summary,
            legalLine,
            legalCopyright,
            legalLicenseLink,
            openSourceTitle,
            openSourceList,
            linksContainer,
            closeIconButton,
        };
    }

    override afterAttach(): void {
        super.afterAttach();
        this._subscribeToLanguageChanges(() => this._updateLocalizedText());
    }

    private _updateLocalizedText(): void {
        if (!this._ui) {
            return;
        }

        this._ui.title.textContent = this.t('dialog.about.title');
        this._ui.subtitle.textContent = this.t('dialog.about.subtitle');
        this._ui.version.textContent = this.t('dialog.about.versionLabel', {
            version: this.appVersion,
        });
        this._ui.summary.textContent = this.t('dialog.about.summary');
        this._ui.legalCopyright.textContent = this.t('dialog.about.copyright');
        this._ui.legalLicenseLink.textContent = this.t('dialog.about.license');
        this._ui.openSourceTitle.textContent = this.t('dialog.about.openSourceTitle');
        this._ui.openSourceList.querySelectorAll('span').forEach((licenseLabel, index) => {
            const pkg = OPEN_SOURCE_PACKAGES[index];
            if (!pkg) {
                return;
            }
            licenseLabel.textContent = this.t('dialog.about.openSourceLicenseLabel', {
                license: pkg.license,
            });
        });
        this._ui.closeIconButton.title = this.t('dialog.closeAria');
        this._ui.closeIconButton.setAttribute('aria-label', this.t('dialog.closeAria'));

        this._ui.linksContainer.querySelectorAll('a[data-i18n-key]').forEach((link) => {
            const key = (link as HTMLAnchorElement).dataset.i18nKey;
            if (key) {
                link.textContent = this.t(key);
            }
        });
    }

    override serialize(): AboutDialogViewSerialized {
        return {
            ...super.serialize(),
            type: 'AboutDialogView',
            appVersion: this.appVersion,
        };
    }

    static deserialize(
        data: Record<string, unknown> = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: AboutDialogViewDeserializeContext = {},
    ): AboutDialogView {
        void viewFactory;
        const appVersion = typeof data.appVersion === 'string' ? data.appVersion : undefined;
        const { i18nService = null, logger = null } = context;
        return new AboutDialogView({ appVersion, i18nService, logger });
    }
}