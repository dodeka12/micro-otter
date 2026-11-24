import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Guards that the core tuple page stays in step with the shipped definitions: the page must name
// the real node type ids and every connector/control id of those nodes, must not claim a runtime
// module that does not exist, and every Markdown link in it must resolve. Sources are read as text
// (definitions JSON only), matching node-validation-docs-consistency.test.js.

const pagePath = 'docs/dev/nodes/core-tuple-node-system.md';
const definitionsPath = 'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json';
const indexPaths = ['docs/dev/nodes/index.md', 'docs/dev/README.md'];

const documentedNodes = ['compose', 'decompose', 'tuple-select', 'select', 'select-index'];

function readText(relativePath) {
    return readFileSync(path.resolve(relativePath), 'utf8');
}

function loadDefinitions() {
    return JSON.parse(readText(definitionsPath)).nodeTypes;
}

describe('core tuple docs/code consistency', () => {
    const page = readText(pagePath);
    const definitions = loadDefinitions();

    it('documents the type and every tuple-related node', () => {
        for (const token of [
            'core.tuple',
            'core.select',
            'core.compose',
            'core.decompose',
            'core.tuple-select',
            'core.select-index',
        ]) {
            assert.ok(page.includes(token), `page must name '${token}'`);
        }
    });

    it('names every connector family and control id of the documented nodes', () => {
        documentedNodes.forEach((typeId) => {
            const definition = definitions[typeId];
            assert.ok(definition, `missing ${typeId} definition`);

            // Positional families are documented as `item_1 … item_8`, so the page only has to
            // name the first and last id; every additional control id must appear verbatim.
            [definition.inputs || [], definition.outputs || []].forEach((connectors) => {
                if (connectors.length === 0) {
                    return;
                }
                const ids = connectors.map((connector) => connector.id);
                [ids[0], ids[ids.length - 1]].forEach((id) => {
                    assert.ok(page.includes(id), `${typeId} connector '${id}' is not documented`);
                });
            });
            (definition.controls || []).forEach((control) => {
                assert.ok(
                    page.includes(control.id),
                    `${typeId} control '${control.id}' is not documented`
                );
            });
        });
    });

    it('claims no runtime tuple module', () => {
        assert.doesNotMatch(page, /^\s*(?:import|from)\s+otter_core/mi);
        assert.doesNotMatch(page, /otter_core\.tuples?\s+(?:module|provides|is imported)/i);
        assert.ok(
            page.includes('There is **no** tuple runtime module'),
            'the page must state that no runtime module exists'
        );
    });

    it('resolves every relative Markdown link', () => {
        const pageDir = path.dirname(path.resolve(pagePath));
        const links = [...page.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]);

        assert.ok(links.length > 0, 'expected relative links to other docs pages');
        for (const link of links) {
            if (/^[a-z]+:/i.test(link) || link.startsWith('#')) {
                continue;
            }
            const target = path.resolve(pageDir, link);
            assert.ok(existsSync(target), `broken documentation link '${link}'`);
        }
    });

    it('is linked from the node and developer documentation indexes', () => {
        indexPaths.forEach((indexPath) => {
            assert.ok(
                readText(indexPath).includes('core-tuple-node-system.md'),
                `${indexPath} must link the core tuple page`
            );
        });
    });
});
