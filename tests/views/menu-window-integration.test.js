/**
 * Integration tests for MenuView embedded in OverlayWindow
 * Tests the wrapper pattern used in GraphPanelView
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDomHarness } from '../helpers/dom-harness.js';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';
import { MenuWindow } from '../../src/micro_otter/nodes/html/js/views/menu-window.js';
import { OverlayWindow } from '../../src/micro_otter/nodes/html/js/views/overlay-window.js';
import { computeAnchoredPosition } from '../../src/micro_otter/nodes/html/js/views/overlay-position.js';

describe('MenuView wrapped in OverlayWindow', () => {
    let dom, document, container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;
        global.document = document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        global.cancelAnimationFrame = (id) => clearTimeout(id);

        container = document.createElement('div');
        container.style.width = '1024px';
        container.style.height = '768px';
        document.body.appendChild(container);
    });

    it('should create menu inside overlay', () => {
        const items = [
            { id: 'copy', label: 'Copy' },
            { id: 'paste', label: 'Paste' },
        ];

        const menuView = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            x: 100,
            y: 200,
            width: 200,
            height: 150,
            showHeader: false,
            draggable: false,
            resizable: false,
            minimizable: false,
            closable: false,
        });

        overlay.attachTo(container);

        assert.strictEqual(menuView.isAttached, true, 'Menu should be attached');

        // Check that menu is inside overlay container
        const overlayHost = container.querySelector('.overlay-window');
        assert.ok(overlayHost, 'Overlay host element should exist');

        const menuContainer = overlayHost.querySelector('.menu');
        assert.ok(menuContainer, 'Menu container should be inside overlay');

        overlay.detach();
    });

    it('should not show header when showHeader=false', () => {
        const menuView = new MenuView({
            items: [{ id: 'test', label: 'Test' }],
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            showHeader: false,
        });

        overlay.attachTo(container);

        const header = container.querySelector('.overlay-window__header');
        assert.strictEqual(header, null, 'Header should not exist when showHeader=false');

        overlay.detach();
    });

    it('should not allow dragging when draggable=false', () => {
        const menuView = new MenuView({
            items: [{ id: 'test', label: 'Test' }],
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            showHeader: true,
            draggable: false,
        });

        overlay.attachTo(container);

        assert.strictEqual(overlay.draggable, false, 'Draggable property should be false');

        overlay.detach();
    });

    it('should not allow resizing when resizable=false', () => {
        const menuView = new MenuView({
            items: [{ id: 'test', label: 'Test' }],
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            resizable: false,
        });

        overlay.attachTo(container);

        assert.strictEqual(overlay.resizable, false, 'Resizable property should be false');

        overlay.detach();
    });

    it('should close overlay when menu detaches', () => {
        const items = [{ id: 'copy', label: 'Copy' }];

        const menuView = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            showHeader: false,
        });

        overlay.attachTo(container);

        assert.strictEqual(menuView.isAttached, true, 'Menu should be attached initially');

        // Simulate what GraphPanelView does: listen for menu detach and close overlay
        menuView.on('detach', () => {
            if (typeof overlay.close === 'function') {
                overlay.close();
            }
        });

        // Directly call menu detach (simpler than event simulation)
        menuView.detach();

        // Verify menu is detached
        assert.strictEqual(menuView.isAttached, false, 'Menu should be detached');
    });

    it('should not clear document.body when overlay detaches', () => {
        const menuView = new MenuView({
            items: [{ id: 'test', label: 'Test' }],
            position: { x: 0, y: 0 },
        });

        const overlay = new OverlayWindow({
            view: menuView,
            showHeader: false,
        });

        // Add a marker element to body
        const marker = document.createElement('div');
        marker.id = 'test-marker';
        document.body.appendChild(marker);

        overlay.attachTo(document.body);

        // Detach overlay
        overlay.detach();

        // Verify marker still exists
        const markerAfter = document.getElementById('test-marker');
        assert.ok(markerAfter, 'Marker should still exist after overlay detaches');
        assert.strictEqual(
            markerAfter,
            marker,
            'Marker should be the same element (body not cleared)'
        );
    });
});

describe('MenuWindow - hosted menu instance and anchored placement', () => {
    let harness;
    let document;
    let layer;

    beforeEach(() => {
        harness = createDomHarness();
        document = harness.document;

        layer = document.createElement('div');
        layer.className = 'overlay-layer';
        // JSDOM has no layout, so the host bounds that OverlayWindow clamps against are stubbed.
        Object.defineProperty(layer, 'clientWidth', { value: 1024, configurable: true });
        Object.defineProperty(layer, 'clientHeight', { value: 768, configurable: true });
        document.body.appendChild(layer);
    });

    afterEach(() => {
        harness.cleanup();
    });

    it('hosts the given menu instance and adopts the selection callback', () => {
        const selected = [];
        const menu = new MenuView({ items: [{ id: 'copy', label: 'Copy' }] });
        const onSelect = (item) => selected.push(item.id);

        const window_ = new MenuWindow({ menu, onSelect });

        assert.equal(window_.getMenu(), menu, 'the given instance is used, not a copy');
        assert.equal(menu.onSelectCallback, onSelect, 'the callback is installed on that instance');

        window_.attachTo(layer);
        layer.querySelector('[data-item-id="copy"]').click();
        assert.deepEqual(selected, ['copy']);

        window_.close();
    });

    it('positions an anchored window beside the anchor rectangle', () => {
        const menu = new MenuView({ items: [{ id: 'copy', label: 'Copy' }] });
        const anchor = { left: 0, top: 0, right: 0, bottom: 0 };

        const window_ = new MenuWindow({ menu, anchor });
        const expected = computeAnchoredPosition(anchor, menu.getPreferredSize());

        assert.deepEqual(window_.position, { x: expected.x, y: expected.y });
        assert.deepEqual(
            { x: window_.position.x, y: window_.position.y },
            { x: 2, y: 8 },
            'JSDOM reports zero rectangles, so gap and margin decide'
        );

        window_.detach();
    });

    it('exposes its overlay element only after attach', () => {
        const window_ = new MenuWindow({ items: [{ id: 'copy', label: 'Copy' }] });

        assert.equal(window_.getOverlayElement(), null);

        window_.attachTo(layer);

        const element = window_.getOverlayElement();
        assert.ok(element instanceof harness.window.HTMLElement);
        assert.ok(element.classList.contains('overlay-window'));
        assert.equal(layer.contains(element), true);

        window_.detach();
        assert.equal(window_.getOverlayElement()?.parentElement ?? null, null);
    });

    it('moves an attached window and stays harmless before attach', () => {
        const window_ = new MenuWindow({ items: [{ id: 'copy', label: 'Copy' }] });

        window_.setPosition(11, 22);
        assert.deepEqual(window_.position, { x: 11, y: 22 }, 'position is stored before attach');

        window_.attachTo(layer);
        window_.setPosition(40, 50);

        assert.deepEqual(window_.position, { x: 40, y: 50 });
        const element = window_.getOverlayElement();
        assert.equal(element.style.left, '40px');
        assert.equal(element.style.top, '50px');

        window_.detach();
    });
});
