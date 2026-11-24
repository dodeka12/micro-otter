// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file CollapsibleView tests
 * Tests for collapsible view with header, toggle, and content panel
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { CollapsibleView } from '../../src/micro_otter/nodes/html/js/views/collapsible-view.js';
import { SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { TextView } from '../../src/micro_otter/nodes/html/js/views/text-view.js';

const stylesheetPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/micro_otter/nodes/html/styles/standard/collapsible-view.css'
);

function getContentRoot(contentView) {
    const root = contentView.container?.firstElementChild;
    assert.ok(root, 'content view should render a root element');
    return root;
}

function stubHeight(element, height) {
    element.getBoundingClientRect = () => ({
        width: 200,
        height,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 200,
        bottom: height,
        toJSON: () => ({}),
    });
}

describe('CollapsibleView', () => {
    let dom, document, container;
    let resizeObservers;

    class MockResizeObserver {
        constructor(callback) {
            this.callback = callback;
            this.observed = new Set();
            this.disconnected = false;
            resizeObservers.push(this);
        }

        observe(element) {
            this.observed.add(element);
        }

        unobserve(element) {
            this.observed.delete(element);
        }

        disconnect() {
            this.disconnected = true;
            this.observed.clear();
        }

        trigger() {
            this.callback([], this);
        }
    }

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;
        global.document = document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        resizeObservers = [];
        global.ResizeObserver = MockResizeObserver;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        delete global.ResizeObserver;
        dom?.window?.close();
    });

    describe('Constructor', () => {
        it('should create with default options', () => {
            const view = new CollapsibleView();
            assert.equal(view.headerTitle, 'Section');
            assert.equal(view.collapsed, false);
            assert.equal(view.contentView, null);
            assert.equal(view.sizeToContent, false);
        });

        it('should accept custom header title', () => {
            const view = new CollapsibleView({ headerTitle: 'Custom Header' });
            assert.equal(view.headerTitle, 'Custom Header');
        });

        it('should accept initial collapsed state', () => {
            const view = new CollapsibleView({ collapsed: true });
            assert.equal(view.collapsed, true);
        });

        it('should accept content view', () => {
            const contentView = new TextView({ text: 'Test content' });
            const view = new CollapsibleView({ contentView });
            assert.equal(view.contentView, contentView);
        });

        it('should accept custom header height', () => {
            const view = new CollapsibleView({ headerHeight: 40 });
            view.attachTo(container);
            const header = container.querySelector('.collapsible-view__header');
            assert.equal(header.style.height, '40px');
        });

        it('should default the header height to 28 px', () => {
            const view = new CollapsibleView();
            view.attachTo(container);
            const header = container.querySelector('.collapsible-view__header');
            assert.equal(header.style.height, '28px');
        });

        it('should clamp an explicit header height to the 24 px floor', () => {
            const view = new CollapsibleView({ headerHeight: 12 });
            view.attachTo(container);
            const header = container.querySelector('.collapsible-view__header');
            assert.equal(header.style.height, '24px');
        });

        it('should fall back to the 28 px default for a falsy header height', () => {
            const view = new CollapsibleView({ headerHeight: 0 });
            view.attachTo(container);
            const header = container.querySelector('.collapsible-view__header');
            assert.equal(header.style.height, '28px');
        });

        it('should accept sizeToContent mode', () => {
            const view = new CollapsibleView({ sizeToContent: true });
            assert.equal(view.sizeToContent, true);
        });

        it('should default nested to false', () => {
            const view = new CollapsibleView();
            assert.equal(view.nested, false);
        });

        it('should accept the nested variant', () => {
            const view = new CollapsibleView({ nested: true });
            assert.equal(view.nested, true);
        });

        it('should default contentGuide to false', () => {
            const view = new CollapsibleView();
            assert.equal(view.contentGuide, false);
        });

        it('should accept the contentGuide variant', () => {
            const view = new CollapsibleView({ contentGuide: true });
            assert.equal(view.contentGuide, true);
        });

        it('should be collapsible by default', () => {
            const view = new CollapsibleView();
            assert.equal(view.collapsible, true);
            assert.equal(view.isCollapsible, true);
        });

        it('should support a static non-collapsible variant', () => {
            const view = new CollapsibleView({ collapsible: false, collapsed: true });
            assert.equal(view.collapsible, false);
            assert.equal(view.isCollapsible, false);
            assert.equal(view.collapsed, false);

            view.attachTo(container);
            const root = container.querySelector('.collapsible-view');
            assert.ok(root.classList.contains('collapsible-view--static'));
            assert.equal(container.querySelector('.collapsible-view__toggle'), null);
            assert.equal(container.querySelector('.collapsible-view__solo'), null);

            view.toggle();
            view.collapse();
            assert.equal(view.collapsed, false);
        });

        it('should preserve the collapsible flag through serialization', () => {
            const view = new CollapsibleView({ collapsible: false });
            const data = view.serialize();
            assert.equal(data.collapsible, false);

            const restored = CollapsibleView.deserialize(data);
            assert.equal(restored.collapsible, false);
        });
    });

    describe('Rendering', () => {
        it('should render header with title', () => {
            const view = new CollapsibleView({ headerTitle: 'Test Section' });
            view.attachTo(container);

            const header = container.querySelector('.collapsible-view__header');
            assert.ok(header, 'header should exist');

            const title = container.querySelector('.collapsible-view__title');
            assert.equal(title.textContent, 'Test Section');
        });

        it('should render toggle button', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const toggle = container.querySelector('.collapsible-view__toggle');
            assert.ok(toggle, 'toggle button should exist');
            assert.equal(toggle.tagName.toLowerCase(), 'button');

            const icon = toggle.querySelector('.collapsible-view__toggle-icon');
            assert.ok(icon, 'toggle icon should exist');
        });

        it('should render content container', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const content = container.querySelector('.collapsible-view__content');
            assert.ok(content, 'content container should exist');
        });

        it('should attach content view to content container', () => {
            const contentView = new TextView({ text: 'Test content' });
            const view = new CollapsibleView({ contentView });
            view.attachTo(container);

            const textContent = container.querySelector('.view-text');
            assert.ok(textContent, 'content view should be rendered');
            assert.equal(textContent.textContent, 'Test content');
        });

        it('should toggle the fit-content class with sizeToContent', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--fit-content'), false);

            view.sizeToContent = true;
            assert.equal(root.classList.contains('collapsible-view--fit-content'), true);

            view.sizeToContent = false;
            assert.equal(root.classList.contains('collapsible-view--fit-content'), false);
        });

        it('should render the nested variant class on the root', () => {
            const view = new CollapsibleView({ nested: true });
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--nested'), true);
        });

        it('should render the content guide class on the root', () => {
            const view = new CollapsibleView({ contentGuide: true });
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--content-guide'), true);
        });

        it('should compose both modifier classes', () => {
            const view = new CollapsibleView({ sizeToContent: true, nested: true });
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.deepEqual(Array.from(root.classList), [
                'collapsible-view',
                'collapsible-view--fit-content',
                'collapsible-view--nested',
            ]);
        });

        it('should keep the default class list unchanged', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.className, 'collapsible-view');
        });
    });

    describe('Nested Variant', () => {
        it('should toggle the nested class after render', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--nested'), false);

            view.nested = true;
            assert.equal(root.classList.contains('collapsible-view--nested'), true);

            view.nested = false;
            assert.equal(root.classList.contains('collapsible-view--nested'), false);
        });

        it('should be a no-op when set to the same value', () => {
            const view = new CollapsibleView({ nested: true });
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            const before = root.className;
            view.nested = true;
            assert.equal(root.className, before);
            assert.equal(root.classList.contains('collapsible-view--nested'), true);
        });

        it('should accept the value before attach and apply it on render', () => {
            const view = new CollapsibleView();
            view.nested = true;
            assert.equal(view.nested, true);

            view.attachTo(container);
            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--nested'), true);
        });
    });

    describe('Content Guide', () => {
        it('should toggle the content guide class after render', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--content-guide'), false);

            view.contentGuide = true;
            assert.equal(root.classList.contains('collapsible-view--content-guide'), true);

            view.contentGuide = false;
            assert.equal(root.classList.contains('collapsible-view--content-guide'), false);
        });

        it('should be a no-op when set to the same value', () => {
            const view = new CollapsibleView({ contentGuide: true });
            view.attachTo(container);

            const root = container.querySelector('.collapsible-view');
            const before = root.className;
            view.contentGuide = true;
            assert.equal(root.className, before);
            assert.equal(root.classList.contains('collapsible-view--content-guide'), true);
        });

        it('should accept the value before attach and apply it on render', () => {
            const view = new CollapsibleView();
            view.contentGuide = true;
            assert.equal(view.contentGuide, true);

            view.attachTo(container);
            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('collapsible-view--content-guide'), true);
        });
    });

    describe('Collapsed State', () => {
        it('should be expanded by default', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const content = container.querySelector('.collapsible-view__content');
            assert.equal(content.style.display, '');

            const root = container.querySelector('.collapsible-view');
            assert.equal(root.classList.contains('is-collapsed'), false);
        });

        it('should render collapsed when specified', () => {
            const view = new CollapsibleView({ collapsed: true });
            view.attachTo(container);

            const content = container.querySelector('.collapsible-view__content');
            assert.equal(content.style.display, 'none');

            const root = container.querySelector('.collapsible-view');
            assert.ok(root.classList.contains('is-collapsed'));
        });

        it('should toggle collapsed state programmatically', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const content = container.querySelector('.collapsible-view__content');
            const root = container.querySelector('.collapsible-view');

            // Initially expanded
            assert.equal(content.style.display, '');
            assert.equal(root.classList.contains('is-collapsed'), false);

            // Collapse
            view.collapsed = true;
            assert.equal(content.style.display, 'none');
            assert.ok(root.classList.contains('is-collapsed'));

            // Expand
            view.collapsed = false;
            assert.equal(content.style.display, '');
            assert.equal(root.classList.contains('is-collapsed'), false);
        });

        it('should toggle state with toggle() method', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            assert.equal(view.collapsed, false);
            view.toggle();
            assert.equal(view.collapsed, true);
            view.toggle();
            assert.equal(view.collapsed, false);
        });

        it('should support collapse() method', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            view.collapse();
            assert.equal(view.collapsed, true);
        });

        it('should support expand() method', () => {
            const view = new CollapsibleView({ collapsed: true });
            view.attachTo(container);

            view.expand();
            assert.equal(view.collapsed, false);
        });
    });

    describe('Header Interaction', () => {
        it('should toggle when the header itself is clicked', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const header = container.querySelector('.collapsible-view__header');
            header.click();
            assert.equal(view.collapsed, true);

            header.click();
            assert.equal(view.collapsed, false);
        });

        it('should toggle when the header title is clicked', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            container.querySelector('.collapsible-view__title').click();
            assert.equal(view.collapsed, true);
        });

        it('should not double-toggle when a header button is clicked', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            container.querySelector('.collapsible-view__toggle').click();
            assert.equal(view.collapsed, true, 'header handler must ignore button clicks');
        });

        it('should unbind the header listener on detach', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            const header = container.querySelector('.collapsible-view__header');
            view.detach();

            header.click();
            assert.equal(view.collapsed, false);
        });
    });

    describe('Solo Action', () => {
        it('should not render a solo button outside a SplitView', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            assert.equal(container.querySelector('.collapsible-view__solo'), null);
        });

        it('should not render a solo button for a collapsible nested in a content view', () => {
            const inner = new CollapsibleView({ headerTitle: 'Inner' });
            const outer = new CollapsibleView({ headerTitle: 'Outer', contentView: inner });
            const split = new SplitView({ views: [outer] });
            split.attachTo(container);

            assert.ok(container.querySelector('.collapsible-view__solo'), 'outer pane has one');
            const innerRoot = inner.container;
            assert.equal(innerRoot.querySelector('.collapsible-view__solo'), null);
        });

        it('should render a labelled solo button on a direct SplitView pane', () => {
            const view = new CollapsibleView({ headerTitle: 'Section' });
            const split = new SplitView({ views: [view] });
            split.attachTo(container);

            const solo = container.querySelector('.collapsible-view__solo');
            assert.ok(solo, 'solo button should exist');
            assert.equal(solo.tagName.toLowerCase(), 'button');
            assert.equal(solo.type, 'button');
            assert.ok(solo.querySelector('.collapsible-view__solo-icon'), 'solo icon should exist');
            assert.equal(solo.getAttribute('title'), 'collapsibleView.solo');
            assert.equal(solo.getAttribute('aria-label'), 'collapsibleView.solo');
        });

        it('should expand itself and collapse sibling panes when clicked', () => {
            const view = new CollapsibleView({ headerTitle: 'A', collapsed: true });
            const sibling = new CollapsibleView({ headerTitle: 'B' });
            const split = new SplitView({ views: [view, sibling] });

            const sources = [];
            split.on('layoutChange', (event) => {
                sources.push(event.detail.source);
            });

            split.attachTo(container);
            container.querySelector('.collapsible-view__solo').click();

            assert.equal(view.collapsed, false);
            assert.equal(sibling.collapsed, true);
            assert.ok(sources.includes('solo'), 'host should report the solo layout change');
        });

        it('should unbind the solo listener on detach', () => {
            const view = new CollapsibleView();
            const split = new SplitView({ views: [view] });
            split.attachTo(container);

            const requests = [];
            const requestSolo = view.requestSplitViewSolo.bind(view);
            view.requestSplitViewSolo = (extraDetail) => {
                requests.push(extraDetail);
                return requestSolo(extraDetail);
            };

            const solo = container.querySelector('.collapsible-view__solo');
            split.detach();
            solo.click();

            assert.deepEqual(requests, []);
        });
    });

    describe('Height Constraints', () => {
        it('should set min/max height to header height when collapsed', () => {
            const view = new CollapsibleView({ headerHeight: 32 });
            view.attachTo(container);

            view.collapsed = true;
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 32);
        });

        it('should cap height to content height when expanded', () => {
            const contentView = new TextView({ text: 'Test content' });
            contentView.setHeightConstraints({ minHeight: 40, maxHeight: 40 });

            const view = new CollapsibleView({
                collapsed: true,
                headerHeight: 32,
                contentView,
            });
            view.attachTo(container);

            // Initially collapsed with constraints fixed to header height
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 32);

            // Expand: min = header height, max = header + content height
            view.collapsed = false;
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 72);
        });

        it('should leave expanded height unconstrained when content has no fixed height', () => {
            const contentView = new TextView({ text: 'Scrollable content' });

            const view = new CollapsibleView({
                collapsed: true,
                headerHeight: 32,
                contentView,
            });
            view.attachTo(container);

            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 32);

            view.collapsed = false;
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, null);
        });

        it('does not treat a content minimum as a fixed height cap', () => {
            const contentView = new TextView({ text: 'Free-form content with a minimum' });
            contentView.setHeightConstraints({ minHeight: 72, maxHeight: null });

            const view = new CollapsibleView({
                collapsed: true,
                headerHeight: 32,
                contentView,
            });
            view.attachTo(container);

            view.collapsed = false;

            assert.equal(view.minHeight, 32);
            assert.equal(
                view.maxHeight,
                null,
                'a content minimum without a maximum must keep the pane free to fill'
            );
        });

        it('does not restore a stale height when an initially-collapsed section expands', () => {
            const contentView = new TextView({ text: 'Collapsible content' });
            const view = new CollapsibleView({ collapsed: true, headerHeight: 32, contentView });

            // A real browser reports the collapsed pane's header-only height; the
            // initial collapsed render must not capture that as a "before" height.
            Object.defineProperty(container, 'offsetHeight', {
                configurable: true,
                value: 32,
            });
            view.attachTo(container);

            let desiredSizeEvents = 0;
            view.on('desiredSize', () => {
                desiredSizeEvents += 1;
            });

            view.expand();

            assert.equal(desiredSizeEvents, 0, 'no stale height is restored');
            assert.equal(view.getDesiredSize().height, null);
        });

        it('restores the pre-collapse height after a real collapse and expand', () => {
            const contentView = new TextView({ text: 'Collapsible content' });
            const view = new CollapsibleView({ headerHeight: 32, contentView });
            view.attachTo(container);

            Object.defineProperty(container, 'offsetHeight', {
                configurable: true,
                value: 180,
            });

            view.collapse();
            view.expand();

            assert.equal(view.getDesiredSize().height, 180, 'the height before collapsing is restored');
        });

        it('should cap expanded height to the measured content height', () => {
            const contentView = new TextView({ text: 'Measured content' });
            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            const contentRoot = getContentRoot(contentView);
            stubHeight(contentRoot, 100);
            view.refreshSize();

            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 134);
        });

        it('should use the content minHeight when no measurement is available', () => {
            const contentView = new TextView({ text: 'Fallback content' });
            contentView.setHeightConstraints({ minHeight: 40, maxHeight: 40 });

            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            view.refreshSize();

            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 72);
        });

        it('should leave max height unset when content has no measurement or minHeight', () => {
            const contentView = new TextView({ text: 'Unmeasured content' });
            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            view.refreshSize();

            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, null);
        });

        it('should include the content container padding in the cap', () => {
            const contentView = new TextView({ text: 'Padded content' });
            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            const contentContainer = container.querySelector('.collapsible-view__content');
            contentContainer.style.paddingTop = '8px';
            contentContainer.style.paddingBottom = '6px';

            stubHeight(getContentRoot(contentView), 100);
            view.refreshSize();

            assert.equal(
                view.maxHeight,
                32 + 100 + 14 + 2,
                'the pane must also fit the content box padding and the pane border'
            );
        });

        it('should include the content container padding in the minHeight fallback', () => {
            const contentView = new TextView({ text: 'Padded fallback content' });
            contentView.setHeightConstraints({ minHeight: 40, maxHeight: 40 });

            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            const contentContainer = container.querySelector('.collapsible-view__content');
            contentContainer.style.paddingTop = '8px';
            contentContainer.style.paddingBottom = '6px';

            view.refreshSize();

            assert.equal(view.maxHeight, 32 + 40 + 14);
        });

        it('should update the content-fit cap when the measured height changes', () => {
            const contentView = new TextView({ text: 'Growing content' });
            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            const contentRoot = getContentRoot(contentView);
            stubHeight(contentRoot, 100);
            view.refreshSize();
            assert.equal(view.maxHeight, 134);

            stubHeight(contentRoot, 140);
            view.refreshSize();
            assert.equal(view.maxHeight, 174);
        });

        it('should re-measure on expand without emitting desiredSize in content-fit mode', () => {
            const contentView = new TextView({ text: 'Collapsible content' });
            const view = new CollapsibleView({ headerHeight: 32, contentView });
            view.attachTo(container);

            Object.defineProperty(container, 'offsetHeight', {
                configurable: true,
                value: 180,
            });
            view.collapse();
            view.sizeToContent = true;

            let desiredSizeEvents = 0;
            view.on('desiredSize', () => {
                desiredSizeEvents += 1;
            });

            const contentRoot = getContentRoot(contentView);
            stubHeight(contentRoot, 120);
            view.expand();

            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 154);
            assert.equal(desiredSizeEvents, 0);
        });

        it('should keep the collapsed height fixed in content-fit mode', () => {
            const contentView = new TextView({ text: 'Collapsible content' });
            const view = new CollapsibleView({
                headerHeight: 32,
                contentView,
                sizeToContent: true,
            });
            view.attachTo(container);

            stubHeight(getContentRoot(contentView), 120);
            view.refreshSize();
            assert.equal(view.maxHeight, 154);

            view.collapse();
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 32);

            view.expand();
            assert.equal(view.minHeight, 32);
            assert.equal(view.maxHeight, 154);
        });
    });

    describe('Content Resize Observer', () => {
        function findObserver(root) {
            return resizeObservers.find((observer) => observer.observed.has(root));
        }

        it('should observe the content root in sizeToContent mode', () => {
            const contentView = new TextView({ text: 'Observed content' });
            const view = new CollapsibleView({ contentView, sizeToContent: true });
            view.attachTo(container);

            const contentRoot = getContentRoot(contentView);
            const observer = findObserver(contentRoot);

            assert.ok(observer, 'content root should be observed');
            assert.equal(observer.disconnected, false);
        });

        it('should refresh the cap when the content observer fires', () => {
            const contentView = new TextView({ text: 'Observed content' });
            const view = new CollapsibleView({ contentView, sizeToContent: true });
            view.attachTo(container);

            const contentRoot = getContentRoot(contentView);
            const observer = findObserver(contentRoot);
            assert.ok(observer, 'content root should be observed');

            stubHeight(contentRoot, 100);
            observer.trigger();
            assert.equal(view.maxHeight, 130);

            stubHeight(contentRoot, 140);
            observer.trigger();
            assert.equal(view.maxHeight, 170);
        });

        it('should move observation when the content view changes', () => {
            const oldContent = new TextView({ text: 'Old content' });
            const view = new CollapsibleView({ contentView: oldContent, sizeToContent: true });
            view.attachTo(container);

            const oldRoot = getContentRoot(oldContent);
            const oldObserver = findObserver(oldRoot);
            assert.ok(oldObserver, 'old content root should be observed');

            const newContent = new TextView({ text: 'New content' });
            view.contentView = newContent;

            const newRoot = getContentRoot(newContent);
            const newObserver = findObserver(newRoot);

            assert.equal(oldObserver.disconnected, true);
            assert.equal(oldObserver.observed.size, 0);
            assert.ok(newObserver, 'new content root should be observed');
            assert.equal(newObserver.disconnected, false);
        });

        it('should disconnect the content observer when sizeToContent is disabled', () => {
            const contentView = new TextView({ text: 'Observed content' });
            const view = new CollapsibleView({ contentView, sizeToContent: true });
            view.attachTo(container);

            const observer = findObserver(getContentRoot(contentView));
            assert.ok(observer, 'content root should be observed');

            view.sizeToContent = false;

            assert.equal(observer.disconnected, true);
            assert.equal(observer.observed.size, 0);
        });

        it('should disconnect the content observer on detach', () => {
            const contentView = new TextView({ text: 'Observed content' });
            const view = new CollapsibleView({ contentView, sizeToContent: true });
            view.attachTo(container);

            const observer = findObserver(getContentRoot(contentView));
            assert.ok(observer, 'content root should be observed');

            view.detach();

            assert.equal(observer.disconnected, true);
            assert.equal(observer.observed.size, 0);
        });

        it('should not throw when ResizeObserver is unavailable', () => {
            const contentView = new TextView({ text: 'Observed content' });
            const savedResizeObserver = global.ResizeObserver;
            delete global.ResizeObserver;

            try {
                const view = new CollapsibleView({ contentView, sizeToContent: true });
                assert.doesNotThrow(() => view.attachTo(container));
            } finally {
                global.ResizeObserver = savedResizeObserver;
            }
        });
    });

    describe('Header Title Updates', () => {
        it('should update header title dynamically', () => {
            const view = new CollapsibleView({ headerTitle: 'Initial' });
            view.attachTo(container);

            const title = container.querySelector('.collapsible-view__title');
            assert.equal(title.textContent, 'Initial');

            view.headerTitle = 'Updated';
            assert.equal(title.textContent, 'Updated');
        });
    });

    describe('Content View Updates', () => {
        it('should update content view dynamically', () => {
            const view = new CollapsibleView();
            view.attachTo(container);

            // Initially no content
            let textContent = container.querySelector('.view-text');
            assert.equal(textContent, null);

            // Add content view
            const contentView = new TextView({ text: 'New content' });
            view.contentView = contentView;

            textContent = container.querySelector('.view-text');
            assert.ok(textContent);
            assert.equal(textContent.textContent, 'New content');
        });

        it('should detach old content view when setting new one', () => {
            const oldContent = new TextView({ text: 'Old' });
            const view = new CollapsibleView({ contentView: oldContent });
            view.attachTo(container);

            assert.ok(oldContent.isAttached);

            const newContent = new TextView({ text: 'New' });
            view.contentView = newContent;

            assert.equal(oldContent.isAttached, false);
            assert.ok(newContent.isAttached);
        });

        it('should throw error when setting non-ViewBase content', () => {
            const view = new CollapsibleView();
            assert.throws(() => {
                view.contentView = { not: 'a view' };
            }, /ViewBase instance/);
        });
    });

    describe('Serialization', () => {
        it('should serialize basic properties', () => {
            const view = new CollapsibleView({
                headerTitle: 'Test',
                collapsed: true,
                headerHeight: 40,
                sizeToContent: true,
            });

            const data = view.serialize();
            assert.equal(data.type, 'CollapsibleView');
            assert.equal(data.headerTitle, 'Test');
            assert.equal(data.collapsed, true);
            assert.equal(data.headerHeight, 40);
            assert.equal(data.sizeToContent, true);
        });

        it('should serialize content view', () => {
            const contentView = new TextView({ text: 'Content' });
            const view = new CollapsibleView({ contentView });

            const data = view.serialize();
            assert.ok(data.contentView);
            assert.equal(data.contentView.type, 'TextView');
        });

        it('should deserialize correctly', () => {
            const data = {
                type: 'CollapsibleView',
                headerTitle: 'Restored',
                collapsed: true,
                headerHeight: 36,
                sizeToContent: true,
            };

            const view = CollapsibleView.deserialize(data);
            assert.equal(view.headerTitle, 'Restored');
            assert.equal(view.collapsed, true);
            assert.equal(view.sizeToContent, true);
        });

        it('should deserialize the 28 px header default when none is serialized', () => {
            const view = CollapsibleView.deserialize({ type: 'CollapsibleView' });
            view.attachTo(container);
            const header = container.querySelector('.collapsible-view__header');
            assert.equal(header.style.height, '28px');
        });

        it('should serialize the nested variant', () => {
            const view = new CollapsibleView({ nested: true });
            assert.equal(view.serialize().nested, true);
        });

        it('should default nested to false when serializing', () => {
            const view = new CollapsibleView();
            assert.equal(view.serialize().nested, false);
        });

        it('should restore the nested variant from serialized data', () => {
            const view = new CollapsibleView({ nested: true });
            const restored = CollapsibleView.deserialize({ ...view.serialize() });
            assert.equal(restored.nested, true);
        });

        it('should default nested to false for a legacy payload', () => {
            const restored = CollapsibleView.deserialize({
                type: 'CollapsibleView',
                headerTitle: 'Legacy',
                collapsed: false,
                headerHeight: 32,
            });
            assert.equal(restored.nested, false);
        });

        it('should serialize the content guide variant', () => {
            const view = new CollapsibleView({ contentGuide: true });
            assert.equal(view.serialize().contentGuide, true);
        });

        it('should default contentGuide to false when serializing', () => {
            const view = new CollapsibleView();
            assert.equal(view.serialize().contentGuide, false);
        });

        it('should restore the content guide variant from serialized data', () => {
            const view = new CollapsibleView({ contentGuide: true });
            const restored = CollapsibleView.deserialize({ ...view.serialize() });
            assert.equal(restored.contentGuide, true);
        });

        it('should default contentGuide to false for a legacy payload', () => {
            const restored = CollapsibleView.deserialize({
                type: 'CollapsibleView',
                headerTitle: 'Legacy',
                collapsed: false,
                headerHeight: 32,
            });
            assert.equal(restored.contentGuide, false);
        });

        it('should round-trip header title, collapsed, sizeToContent, and nested', () => {
            const view = new CollapsibleView({
                headerTitle: 'Round Trip',
                collapsed: true,
                sizeToContent: true,
                nested: true,
            });

            const restored = CollapsibleView.deserialize(view.serialize());
            assert.equal(restored.headerTitle, 'Round Trip');
            assert.equal(restored.collapsed, true);
            assert.equal(restored.sizeToContent, true);
            assert.equal(restored.nested, true);
        });
    });

    describe('Lifecycle', () => {
        it('should detach content view on beforeDetach', () => {
            const contentView = new TextView({ text: 'Content' });
            const view = new CollapsibleView({ contentView });
            view.attachTo(container);

            assert.ok(contentView.isAttached);

            view.detach();
            assert.equal(contentView.isAttached, false);
        });
    });
});

describe('CollapsibleView stylesheet', () => {
    it('should define the content-fit scrolling contract', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view--fit-content \.collapsible-view__content\s*\{[^}]*overflow-y:\s*auto/
        );
        assert.match(
            css,
            /\.collapsible-view--fit-content \.collapsible-view__content > \*\s*\{[^}]*height:\s*auto/
        );
        assert.match(
            css,
            /\.collapsible-view--fit-content \.collapsible-view__content > \*\s*\{[^}]*max-height:\s*none/
        );
    });

    it('should use border-box for the fixed-height header', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view__header\s*\{[^}]*box-sizing:\s*border-box/
        );
        assert.doesNotMatch(
            css,
            /\.collapsible-view__header\s*\{[^}]*height:/,
            'the header height is written inline by the component, not by the stylesheet'
        );
    });

    it('should use the second surface step for the base header', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view__header\s*\{[^}]*background:\s*var\(--mo-surface-2\)/
        );
    });

    it('should step the nested header up one surface token', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view--nested \.collapsible-view__header\s*\{[^}]*background:\s*var\(--mo-surface-3, #1c2a40\)/
        );
    });

    it('should lighten the nested title weight', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view--nested \.collapsible-view__title\s*\{[^}]*font-weight:\s*400/
        );
    });

    it('should draw the content guide line in an inset gutter', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view--content-guide \.collapsible-view__content\s*\{[^}]*padding-inline-start:\s*var\(--collapsible-guide-inset,\s*8px\)/
        );
        assert.match(
            css,
            /\.collapsible-view--content-guide \.collapsible-view__content::before\s*\{[^}]*width:\s*1px/
        );
    });

    it('should make the whole header a pointer target', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(css, /\.collapsible-view__header\s*\{[^}]*cursor:\s*pointer/);
    });

    it('should style the solo button like the toggle button', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(
            css,
            /\.collapsible-view__toggle,\s*\.collapsible-view__solo\s*\{[^}]*width:\s*20px/
        );
        assert.match(
            css,
            /\.collapsible-view__toggle:hover,\s*\.collapsible-view__solo:hover\s*\{[^}]*color:\s*var\(--mo-text\)/
        );
        assert.match(css, /\.collapsible-view__solo-icon\s*\{[^}]*width:\s*16px/);
    });

    it('should keep the solo icon from rotating with the toggle state', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.doesNotMatch(css, /\.collapsible-view__solo-icon\s*\{[^}]*transform:/);
        assert.doesNotMatch(css, /\.collapsible-view\.is-collapsed \.collapsible-view__solo-icon/);
    });
});
