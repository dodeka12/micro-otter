import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Guards that the canonical validation page stays in step with the registries: every rule id
// and per-node check id in the tree must be named in the page, and no fifth mechanism may
// appear. The sources are read as text (TypeScript is not imported), matching
// custom-view-doc-code-consistency.test.js.

function readText(relativePath) {
    return readFileSync(path.resolve(relativePath), 'utf8');
}

function collect(patterns, source) {
    const ids = [];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            ids.push(match[1]);
        }
    }
    return ids;
}

describe('node validation docs/code consistency', () => {
    const page = readText('docs/dev/nodes/node-validation-architecture.md');
    const topicValidator = readText(
        'src/micro_otter/nodes/html/js/core/graph-topic-validator.ts'
    );
    const registry = readText('src/micro_otter/nodes/html/js/core/graph-rule-registry.ts');
    const packageModules = readdirSync('src/micro_otter/nodes/device/node_pkgs')
        .map((name) => `src/micro_otter/nodes/device/node_pkgs/${name}/node_capabilities.js`)
        .filter((file) => existsSync(file));

    it('documents every built-in rule id', () => {
        const builtins = collect(
            [/registerGraphTopicRule\('([^']+)'/g, /\bid:\s*'([^']+)'/g],
            topicValidator
        );
        assert.ok(builtins.length > 0, 'expected built-in rule ids');
        for (const id of builtins) {
            assert.ok(page.includes(id), `architecture page must document built-in rule '${id}'`);
        }
    });

    it('documents every package rule and per-node check id', () => {
        for (const file of packageModules) {
            const source = readText(file);
            const ids = collect([/\bid:\s*'([^']+)'/g, /register\('([^']+)'/g], source);
            for (const id of ids) {
                assert.ok(
                    page.includes(id),
                    `${file} registers '${id}' but the architecture page does not mention it`
                );
            }
        }
    });

    it('allows only the three legacy capability-check globals', () => {
        const globals = new Set();
        for (const file of packageModules) {
            const source = readText(file);
            for (const match of source.matchAll(/NodeCapabilityChecks\.([A-Za-z0-9_]+)\s*=/g)) {
                globals.add(match[1]);
            }
        }
        assert.deepEqual(
            [...globals].sort(),
            ['digitalInput', 'mathNode', 'servoNode'],
            'register through registerCapabilityChecks, not the global (see the architecture page)'
        );
    });

    it('keeps the shared registry package-agnostic', () => {
        assert.doesNotMatch(registry, /mqtt|hass|graph-topics/i);
    });

    it('keeps the page vocabulary and its layer headings', () => {
        for (const token of [
            "scope: 'graph'",
            "scope: 'collection'",
            'registerGraphRules',
            'globalThis.GraphRules',
            "source: 'graphRule'",
            'openPins',
        ]) {
            assert.ok(page.includes(token), `architecture page must mention '${token}'`);
        }
        assert.ok(page.includes('graph-resource-validation.md'));
        for (const layer of ['L0', 'L1', 'L2', 'L3', 'L4']) {
            assert.match(page, new RegExp(`^## ${layer}\\b`, 'm'));
        }
    });
});
