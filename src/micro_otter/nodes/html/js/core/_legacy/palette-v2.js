// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { debugLog } from '../core/debug.js';
/**
 * Minimal floating palette for the v2 sandbox. Provides a handful of built-in
 * node types and supports drag-and-drop onto the canvas as well as click-to-add
 * creation. Consumers supply an `onCreate` callback which receives the node
 * type id and an optional { x, y } canvas position.
 */
export class PaletteV2 {
    constructor({ container = document.body, onCreate } = {}) {
        this.container = container;
        this.onCreate = typeof onCreate === 'function' ? onCreate : () => {};
        this.root = document.createElement('div');
        this.root.className = 'palette-v2';
        this.types = [
            { id: 'const', label: 'Const' },
            { id: 'math', label: 'Math' },
            { id: 'print', label: 'Print' },
        ];
    }

    attach() {
        if (!this.root.isConnected) {
            this.container.appendChild(this.root);
        }
        this.render();
    }

    render() {
        this.root.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'palette-v2__header';
        header.textContent = 'Palette';
        this.root.appendChild(header);

        const list = document.createElement('div');
        list.className = 'palette-v2__list';
        this.types.forEach((type) => {
            const item = document.createElement('div');
            item.className = 'palette-v2__item';
            item.draggable = true;
            item.textContent = type.label;
            item.title = `Add ${type.label}`;

            // The drop handler is handleCanvasDrop in events.js:405-452.
            // It runs on the canvas drop event (wired in attachPanelListeners)
            // and calls addNodeAtScreenPosition(...) with the dropped node type,
            // then marks the graph dirty and selects the new node.
            item.addEventListener('dragstart', (event) => {
                debugLog('palette_v2', 'Drag start for type', type.id);
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/node-type', type.id);
                event.dataTransfer.setData('text/plain', type.id);
            });

            item.addEventListener('dblclick', () => {
                this.onCreate(type.id, null);
            });

            list.appendChild(item);
        });

        this.root.appendChild(list);
    }
}

export default PaletteV2;
