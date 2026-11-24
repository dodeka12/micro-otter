// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// `hass-icon-invalid`: the hass package's only icon check. It validates the *syntax* of an
// entity icon (`<set>:<name>`), never the name itself — the MDI index is an async fetch while
// `GraphRule.run()` is synchronous, so an index lookup would silently never fire.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    getGraphRules,
    validateGraphRules,
} from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '../../src/micro_otter/nodes/device/node_pkgs/hass');
const CAPABILITIES_PATH = path.join(PACKAGE_ROOT, 'node_capabilities.js');
const DEMO_PATH = path.resolve(
    HERE,
    '../../src/micro_otter/nodes/device/graphs/examples/mqtt-hass-demo.json'
);

const ENTITY_TYPES = [
    'hass-sensor',
    'hass-binary-sensor',
    'hass-number',
    'hass-switch',
    'hass-select',
    'hass-text',
    'hass-button',
];

function entity(id, type, values = {}) {
    return { id, type, controlValues: { objectId: 'value', ...values }, inputs: [], outputs: [] };
}

function context(nodes) {
    const nodeTypesByNodeId = {};
    nodes.forEach((node) => {
        nodeTypesByNodeId[String(node.id)] = { id: node.type };
    });
    return { graphId: 'g', nodes, nodeTypesByNodeId };
}

function iconIssues(nodes) {
    return validateGraphRules(context(nodes)).filter((issue) => issue.message.startsWith('icon '));
}

describe('hass-icon-invalid graph rule', () => {
    before(async () => {
        // Side effect: registers the built-in MQTT rules and sets globalThis.GraphRules.
        await import('../../src/micro_otter/nodes/html/js/core/graph-topic-validator.js');
        const capabilitiesUrl = pathToFileURL(CAPABILITIES_PATH);
        await import(`${capabilitiesUrl.href}?test=hass-icon-rule`);
    });

    it('is registered with the shared registry', () => {
        assert.ok(getGraphRules().some((rule) => rule.id === 'hass-icon-invalid'));
    });

    it('accepts a well-formed mdi icon', () => {
        const nodes = [entity('s1', 'hass-sensor', { icon: 'mdi:thermometer' })];
        assert.deepEqual(iconIssues(nodes), []);
    });

    it('accepts icons from custom sets', () => {
        const nodes = [
            entity('s1', 'hass-sensor', { icon: 'ph:lightbulb-on' }),
            entity('s2', 'hass-switch', { icon: 'hue:light' }),
        ];
        assert.deepEqual(iconIssues(nodes), []);
    });

    it('accepts a hyphenated, multi-part name', () => {
        const nodes = [entity('s1', 'hass-number', { icon: 'mdi:brightness-6' })];
        assert.deepEqual(iconIssues(nodes), []);
    });

    it('skips an empty or absent icon', () => {
        const nodes = [
            entity('s1', 'hass-sensor', { icon: '' }),
            entity('s2', 'hass-sensor', { icon: '   ' }),
            entity('s3', 'hass-sensor'),
        ];
        assert.deepEqual(iconIssues(nodes), []);
    });

    it('flags a bare icon name without a set', () => {
        const issues = iconIssues([entity('s1', 'hass-sensor', { icon: 'thermometer' })]);
        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, 's1');
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].source, 'graphRule');
        assert.equal(
            issues[0].message,
            "icon 'thermometer' must be written as '<set>:<name>', e.g. 'mdi:thermometer'."
        );
    });



    it('flags an empty name, an empty set and extra colons', () => {
        ['mdi:', ':thermometer', 'mdi::thermometer', 'mdi:thermo:meter'].forEach((icon) => {
            assert.equal(
                iconIssues([entity('s1', 'hass-sensor', { icon })]).length,
                1,
                `${icon} must be rejected`
            );
        });
    });

    it('flags upper case, spaces and other punctuation', () => {
        ['MDI:Thermometer', 'mdi:thermo meter', 'mdi:thermo_meter', 'mdi:thermometer!'].forEach(
            (icon) => {
                assert.equal(
                    iconIssues([entity('s1', 'hass-sensor', { icon })]).length,
                    1,
                    `${icon} must be rejected`
                );
            }
        );
    });

    it('flags a set that is not a lower-case word', () => {
        ['1mdi:thermometer', 'mdi extra:thermometer'].forEach((icon) => {
            assert.equal(
                iconIssues([entity('s1', 'hass-sensor', { icon })]).length,
                1,
                `${icon} must be rejected`
            );
        });
    });

    it('checks every entity node type', () => {
        ENTITY_TYPES.forEach((type) => {
            const issues = iconIssues([entity('s1', type, { icon: 'thermometer' })]);
            assert.equal(issues.length, 1, `${type} must be checked`);
            assert.equal(issues[0].nodeId, 's1');
        });
    });

    it('checks the text and the press button like every other entity', () => {
        const text = iconIssues([entity('t1', 'hass-text', { icon: 'MDI:Thermometer' })]);
        const button = iconIssues([entity('b1', 'hass-button', { icon: 'mdi:smart button' })]);

        assert.equal(text.length, 1);
        assert.equal(text[0].nodeId, 't1');
        assert.equal(button.length, 1);
        assert.equal(button[0].nodeId, 'b1');
        // A well-formed icon on either node stays clean.
        assert.deepEqual(iconIssues([entity('t2', 'hass-text', { icon: 'mdi:tag' })]), []);
        assert.deepEqual(iconIssues([entity('b2', 'hass-button', { icon: 'ph:power' })]), []);
    });

    it('reports one issue per offending node', () => {
        const nodes = [
            entity('s1', 'hass-sensor', { icon: 'thermometer' }),
            entity('s2', 'hass-select', { icon: 'mdi:' }),
            entity('s3', 'hass-sensor', { icon: 'mdi:hub' }),
        ];
        const issues = iconIssues(nodes);
        assert.deepEqual(
            issues.map((issue) => issue.nodeId),
            ['s1', 's2']
        );
        assert.equal(issues.filter((issue) => issue.nodeId === 's1').length, 1);
    });

    it('ignores an icon on a node that is not an entity', () => {
        const nodes = [
            entity('b1', 'hass-bridge', { icon: 'thermometer' }),
            entity('a1', 'hass-availability', { icon: 'thermometer' }),
            entity('m1', 'mqtt-write', { icon: 'thermometer' }),
        ];
        assert.deepEqual(iconIssues(nodes), []);
    });


    it('reports the demo collection as clean', () => {
        const collection = JSON.parse(readFileSync(DEMO_PATH, 'utf8'));
        const graphs = Array.isArray(collection.graphs) ? collection.graphs : [];
        const perGraph = graphs.map((graph) =>
            validateGraphRules({
                graphId: graph.id ?? null,
                nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
                nodeTypesByNodeId: {},
            }).filter((issue) => issue.message.startsWith('icon '))
        );
        assert.deepEqual(perGraph.flat(), []);

        // Guard the fixture: the demo really does carry icons, so the empty result above is a
        // pass and not a silently skipped check.
        const icons = graphs
            .flatMap((graph) => (Array.isArray(graph.nodes) ? graph.nodes : []))
            .map((node) => String(node?.controlValues?.icon ?? '').trim())
            .filter((value) => value.length > 0);
        assert.ok(icons.length > 0);
        assert.ok(icons.includes('mdi:thermometer'));
    });

    it('does not depend on the MDI icon index', () => {
        const source = readFileSync(CAPABILITIES_PATH, 'utf8');
        assert.equal(source.includes('mdi-icons'), false);
        assert.equal(source.includes('mdiIcons'), false);
    });
});
