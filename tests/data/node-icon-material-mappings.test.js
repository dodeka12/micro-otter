import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const NODES_ROOT = path.resolve('src/micro_otter/nodes/device/node_pkgs');
const EXAMPLES = path.resolve('examples/addons/node_pkgs');

// Node type icons live in the package `icons/` folder and are referenced from
// `node_definitions.json` (see docs/workflow/adding-icons.md). Built-in packages ship under the
// device tree; the example add-ons ship the same shape next to their own definitions.
const ICON_MAPPINGS = [
    { packageId: 'core', typeId: 'select', icon: 'icons/arrow_split_24dp.svg' },
    { packageId: 'core', typeId: 'range-adapt', icon: 'icons/linear_scale_24dp.svg' },
    { packageId: 'core', typeId: 'range-convert', icon: 'icons/fit_page_width_24dp.svg' },
    { packageId: 'hass', typeId: 'hass-availability', icon: 'icons/cloud_alert_24dp.svg' },
    { packageId: 'hass', typeId: 'hass-number', icon: 'icons/123_24dp.svg' },
    { packageId: 'hass', typeId: 'hass-select', icon: 'icons/menu_open_24dp.svg' },
    { packageId: 'hass', typeId: 'hass-sensor', icon: 'icons/sensors_krx_24dp.svg' },
    { packageId: 'vars', typeId: 'array-math', icon: 'icons/combine_columns_24dp.svg' },
    { packageId: 'vars', typeId: 'array-set', icon: 'icons/cell_merge_24dp.svg' },
    { packageId: 'vars', typeId: 'array-select', icon: 'icons/view_array_24dp.svg' },
    { packageId: 'vars', typeId: 'random-value', icon: 'icons/casino_24dp.svg' },
    { packageId: 'vars', typeId: 'random-seed', icon: 'icons/key_24dp.svg' },
    {
        packageId: 'webview',
        typeId: 'graph-display',
        icon: 'icons/show_chart_24dp.svg',
    },
    { packageId: 'vars', typeId: 'signal-post', icon: 'icons/notifications_active_24dp.svg' },
    { root: EXAMPLES, packageId: 'hello', typeId: 'greet', icon: 'icons/waving_hand_24dp.svg' },
    { root: EXAMPLES, packageId: 'pulse', typeId: 'tick', icon: 'icons/vital_signs_24dp.svg' },
];

function loadNodeTypes(root, packageId) {
    const definitionsPath = path.join(root, packageId, 'node_definitions.json');
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
}

describe('node type material icon mappings', () => {
    for (const { root = NODES_ROOT, packageId, typeId, icon } of ICON_MAPPINGS) {
        it(`${typeId} references ${icon}`, () => {
            const nodeTypes = loadNodeTypes(root, packageId);
            assert.ok(nodeTypes[typeId], `missing ${typeId} definition in ${packageId}`);
            assert.equal(nodeTypes[typeId].icon, icon);
        });

        it(`${typeId} ships ${icon} as a themed material icon`, () => {
            const iconPath = path.join(root, packageId, icon);
            assert.ok(existsSync(iconPath), `${typeId} icon ${icon} missing in ${packageId}`);

            const svg = readFileSync(iconPath, 'utf8');
            assert.match(svg, /viewBox=["']0 -960 960 960["']/, `${icon} is not a material symbol`);
            assert.match(svg, /fill=["']#e3e3e3["']/, `${icon} misses the standard fill`);
        });
    }
});
