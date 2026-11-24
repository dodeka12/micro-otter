// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AboutDialogView } from '../../src/micro_otter/nodes/html/js/views/about-dialog-view.js';
import { OPEN_SOURCE_PACKAGES } from '../../src/micro_otter/nodes/html/js/core/app-meta.js';

function createI18nService() {
    const translations = {
        'dialog.about.title': 'Micro-Otter',
        'dialog.about.subtitle': 'Visual Node Editor for Microprocessors',
        'dialog.about.versionLabel': 'Version: {{version}}',
        'dialog.about.summary': 'Summary',
        'dialog.about.openSourceTitle': 'Open-source packages',
        'dialog.about.openSourceLicenseLabel': 'License: {{license}}',
        'dialog.about.copyright': 'Copyright',
        'dialog.about.license': 'License: GPL-3.0-only',
        'dialog.about.closeButton': 'Close',
        'dialog.about.links.docs': 'Documentation',
        'dialog.about.links.github': 'GitHub Repository',
        'dialog.about.links.issues': 'Report Issue',
        'dialog.about.links.privacyNotice': 'Privacy Notice',
    };

    return {
        t(key, params = {}) {
            const template = translations[key] || key;
            return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, token) => {
                const value = params[token];
                return value === undefined || value === null ? '' : String(value);
            });
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

describe('AboutDialogView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }

        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    it('renders open-source package rows with upstream links and licenses', () => {
        const dialog = new AboutDialogView({
            appVersion: '1.2.3-test',
            i18nService: createI18nService(),
        });

        dialog.attachTo(container);

        const packageLinks = container.querySelectorAll(
            '.about-dialog a[href^="https://github.com/"]'
        );
        assert.ok(packageLinks.length >= OPEN_SOURCE_PACKAGES.length);

        const packageRows = container.querySelectorAll(
            '.about-dialog div[style*="justify-content: space-between"]'
        );
        assert.equal(packageRows.length, OPEN_SOURCE_PACKAGES.length);

        OPEN_SOURCE_PACKAGES.forEach((pkg) => {
            // Not every upstream lives on GitHub (MDI is hosted by Pictogrammers), so the
            // row is looked up by package name instead of by link host.
            const row = Array.from(packageRows).find((entry) =>
                entry.textContent.includes(pkg.name)
            );
            assert.ok(row, `Expected package row for ${pkg.name}`);

            const link = row.querySelector('a');
            assert.ok(link, `Expected package link for ${pkg.name}`);
            assert.equal(link.textContent, pkg.name);
            assert.equal(link.getAttribute('href'), pkg.url);
            assert.equal(link.getAttribute('target'), '_blank');
            assert.ok((link.getAttribute('rel') || '').includes('noopener'));
            assert.ok((link.getAttribute('rel') || '').includes('noreferrer'));

            const rowText = row.textContent || '';
            assert.ok(rowText.includes(pkg.license), `Expected license text for ${pkg.name}`);
        });

        const privacyLink = Array.from(container.querySelectorAll('.about-dialog a')).find(
            (entry) => entry.textContent === 'Privacy Notice'
        );
        assert.ok(privacyLink, 'Expected Privacy Notice link in About dialog');
        assert.equal(privacyLink.getAttribute('href'), '/privacy.html');
    });
});
