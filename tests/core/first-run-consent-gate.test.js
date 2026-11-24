import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FirstRunConsentGate } from '../../src/micro_otter/nodes/html/js/app/first-run-consent-gate.js';

describe('FirstRunConsentGate', () => {
    let dom;
    let document;
    let window;
    let originalNavigatorDescriptor;
    const localeManifest = {
        defaultLocale: 'en',
        locales: [
            { code: 'en', label: 'English', icon: 'icon-en.svg' },
            { code: 'de', label: 'Deutsch', icon: 'icon-de.svg' },
        ],
    };

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="initial-loading"></div></body></html>', {
            url: 'http://localhost',
        });

        document = dom.window.document;
        window = dom.window;
        originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

        global.window = window;
        global.document = document;
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            writable: true,
            value: {
                language: 'en-US',
                languages: ['en-US', 'en'],
            },
        });
        global.HTMLElement = window.HTMLElement;
        global.HTMLButtonElement = window.HTMLButtonElement;
        global.Storage = window.Storage;
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        if (originalNavigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
        } else {
            delete global.navigator;
        }
        delete global.HTMLElement;
        delete global.HTMLButtonElement;
        delete global.Storage;
    });

    it('shows consent on first run and persists acceptance', async () => {
        assert.equal(FirstRunConsentGate.needsConsent(window.localStorage), true);

        const pending = FirstRunConsentGate.showIfNeeded(window.localStorage, {
            localeManifest,
        });

        const overlay = document.querySelector('.first-run-consent');
        assert.ok(overlay, 'Consent overlay should be rendered');

        const acceptButton = overlay.querySelector('.first-run-consent__accept');
        assert.ok(acceptButton, 'Accept button should be present');
        assert.equal(acceptButton.textContent, 'I Understand and Continue');
        acceptButton.click();

        await pending;

        assert.equal(
            window.localStorage.getItem(FirstRunConsentGate.storageKey),
            'accepted',
            'Accepted state should be persisted'
        );
        assert.equal(document.querySelector('.first-run-consent'), null, 'Overlay should be removed');
        assert.equal(FirstRunConsentGate.needsConsent(window.localStorage), false);
    });

    it('skips rendering when consent already exists', async () => {
        window.localStorage.setItem(FirstRunConsentGate.storageKey, 'accepted');

        await FirstRunConsentGate.showIfNeeded(window.localStorage, { localeManifest });

        assert.equal(document.querySelector('.first-run-consent'), null);
        assert.equal(FirstRunConsentGate.needsConsent(window.localStorage), false);
    });

    it('renders the about sentence as first paragraph', async () => {
        const pending = FirstRunConsentGate.showIfNeeded(window.localStorage, {
            localeManifest,
        });

        const firstParagraph = document.querySelector('.first-run-consent__paragraph');
        assert.ok(firstParagraph);
        assert.equal(
            firstParagraph.textContent,
            'The Micro Otter node editor lets you design and deploy behavior graphs for embedded controllers, bridging intuitive visual workflows with deployable firmware.'
        );

        const acceptButton = document.querySelector('.first-run-consent__accept');
        assert.ok(acceptButton);
        acceptButton.click();

        await pending;
    });

    it('uses browser language and shows all available language flags', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            writable: true,
            value: {
                language: 'de-CH',
                languages: ['de-CH', 'en-US'],
            },
        });

        const pending = FirstRunConsentGate.showIfNeeded(window.localStorage, {
            localeManifest,
        });

        const firstParagraph = document.querySelector('.first-run-consent__paragraph');
        assert.ok(firstParagraph);
        assert.equal(
            firstParagraph.textContent,
            'Der Micro-Otter-Knoten-Editor ermöglicht das Entwerfen und Bereitstellen von Verhaltensgraphen für eingebettete Controller und verbindet intuitive Workflows mit einsatzbereiter Firmware.'
        );

        const flags = document.querySelectorAll('.first-run-consent__language-flag');
        assert.equal(flags.length, 2);

        const privacyLink = document.querySelector('.first-run-consent__privacy-link');
        assert.ok(privacyLink);
        assert.equal(privacyLink.getAttribute('href'), '/privacy.html');

        const acceptButton = document.querySelector('.first-run-consent__accept');
        assert.ok(acceptButton);
        acceptButton.click();

        await pending;
    });

    it('switches notice language when language button is clicked', async () => {
        const pending = FirstRunConsentGate.showIfNeeded(window.localStorage, {
            localeManifest,
        });

        const germanButton = document.querySelector('[data-locale-code="de"]');
        assert.ok(germanButton);
        germanButton.click();

        const firstParagraph = document.querySelector('.first-run-consent__paragraph');
        assert.ok(firstParagraph);
        assert.equal(
            firstParagraph.textContent,
            'Der Micro-Otter-Knoten-Editor ermöglicht das Entwerfen und Bereitstellen von Verhaltensgraphen für eingebettete Controller und verbindet intuitive Workflows mit einsatzbereiter Firmware.'
        );

        const acceptButton = document.querySelector('.first-run-consent__accept');
        assert.ok(acceptButton);
        assert.equal(acceptButton.textContent, 'Ich habe verstanden und fortfahren');
        acceptButton.click();

        await pending;
    });

    it('accepts the legacy consent key value as already acknowledged', async () => {
        window.localStorage.setItem('microOtter.technicalStorageConsent.v1', 'accepted');

        await FirstRunConsentGate.showIfNeeded(window.localStorage, { localeManifest });

        assert.equal(document.querySelector('.first-run-consent'), null);
        assert.equal(FirstRunConsentGate.needsConsent(window.localStorage), false);
    });
});
