// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Contract tests for the repository-wide relative-link gate.
 *
 * The checker accepts a `DOCS_LINK_ROOT` override (and `--root`) so the tests can
 * point it at a temporary markdown tree instead of the real repository.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    collectMarkdownFiles,
    stripNonLinks,
    extractLinks,
    resolveTarget,
    headingSlugs,
    loadAllowlist,
    findBrokenLinks,
} from '../../tools/check_docs_links.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TOOL = join(REPO_ROOT, 'tools/check_docs_links.mjs');

describe('check_docs_links tool', () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'docs-links-'));
    });

    afterEach(() => {
        rmSync(tempRoot, { recursive: true, force: true });
    });

    function write(rel, content) {
        const abs = join(tempRoot, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
    }

    function runTool(args = []) {
        return spawnSync(process.execPath, [TOOL, '--root', tempRoot, ...args], {
            encoding: 'utf8',
        });
    }

    it('extractLinks finds inline links, images, titles, and reference definitions', () => {
        const md = [
            '[inline](a.md)',
            '![alt](img.png)',
            '[titled](b.md "a title")',
            '[ref]: ref.md',
        ].join('\n');
        const links = extractLinks(md);
        assert.deepEqual(links.map((l) => l.target), ['a.md', 'img.png', 'b.md', 'ref.md']);
        assert.deepEqual(links.map((l) => l.line), [1, 2, 3, 4]);
    });

    it('stripNonLinks blanks fenced, indented, inline code, and HTML comments', () => {
        const md = [
            '```js',
            '[code](x.md)',
            '```',
            '    [indented](y.md)',
            'inline `[span](z.md)` text',
            '<!-- [comment](w.md) -->',
            '[real](real.md)',
        ].join('\n');
        const stripped = stripNonLinks(md);
        assert.equal(stripped.includes('x.md'), false);
        assert.equal(stripped.includes('y.md'), false);
        assert.equal(stripped.includes('z.md'), false);
        assert.equal(stripped.includes('w.md'), false);
        assert.match(stripped, /\[real\]\(real\.md\)/);
    });

    it('resolveTarget ignores schemes, decodes, resolves relative and absolute', () => {
        const source = join(tempRoot, 'docs', 'a', 'page.md');
        assert.equal(resolveTarget(source, 'https://example.com/x'), null);
        assert.equal(resolveTarget(source, '<placeholder>'), null);
        assert.equal(resolveTarget(source, '#anchor-only'), null);
        const rel = resolveTarget(source, '../b.md', tempRoot);
        assert.equal(rel.candidates[0], join(tempRoot, 'docs', 'b.md'));
        const abs = resolveTarget(source, '/docs/b.md', tempRoot);
        assert.equal(abs.candidates[0], join(tempRoot, 'docs', 'b.md'));
        assert.equal(abs.candidates[1], join(tempRoot, 'user-docs', 'docs', 'b.md'));
        const encoded = resolveTarget(source, 'a%20b.md', tempRoot);
        assert.equal(encoded.candidates[0], join(tempRoot, 'docs', 'a', 'a b.md'));
    });

    it('headingSlugs handles punctuation, duplicates, explicit ids, and anchors', () => {
        const md = [
            '## Hello, World!',
            '## Hello, World!',
            '## Custom {#my-id}',
            '<a name="legacy"></a>',
        ].join('\n');
        const slugs = headingSlugs(md);
        assert.ok(slugs.has('hello-world'));
        assert.ok(slugs.has('hello-world-1'));
        assert.ok(slugs.has('my-id'));
        assert.ok(slugs.has('legacy'));
    });

    it('findBrokenLinks reports missing files/anchors and skips non-markdown fragments', () => {
        write('docs/page.md', '[ok](target.md) [bad](missing.md) [anchor](target.md#nope)');
        write('docs/target.md', '## Real Heading');
        write('docs/img.png', '');
        write('docs/page2.md', '[pic](img.png) [deep](img.png#ignored-fragment)');
        const files = collectMarkdownFiles({ root: tempRoot });
        const { broken } = findBrokenLinks({ root: tempRoot, files, allowlist: [] });
        const reasons = broken.map((b) => `${b.target}:${b.reason}`);
        assert.ok(reasons.includes('missing.md:missing file'));
        assert.ok(reasons.includes('target.md#nope:missing anchor'));
        assert.equal(broken.some((b) => b.target === 'img.png'), false);
    });

    it('allowlist suppresses matching hits and reports unused entries', () => {
        write('docs/page.md', '[a](./phase-1-foo.md)');
        const allowlist = [
            { path: 'docs/**', target: './phase-*.md', reason: 'template path' },
            { path: 'docs/**', target: 'unused.md', reason: 'unused' },
        ];
        const files = collectMarkdownFiles({ root: tempRoot });
        const result = findBrokenLinks({ root: tempRoot, files, allowlist });
        assert.equal(result.broken.length, 0);
        assert.deepEqual(result.unusedAllowlist, [allowlist[1]]);
    });

    it('loadAllowlist rejects a missing reason', () => {
        write('tools/docs-link-allowlist.json', JSON.stringify([{ path: 'a', target: 'b' }]));
        assert.throws(
            () => loadAllowlist(join(tempRoot, 'tools/docs-link-allowlist.json')),
            /reason/,
        );
    });

    it('CLI exits 0 on a clean tree and 2 on a broken link', () => {
        write('docs/page.md', '[ok](target.md)');
        write('docs/target.md', '# T');
        assert.equal(runTool().status, 0, runTool().stderr);

        write('docs/broken.md', '[nope](missing.md)');
        const broken = runTool();
        assert.equal(broken.status, 2);
        assert.match(broken.stdout, /missing\.md/);
    });

    it('CLI exits 2 on an unused allowlist entry', () => {
        write('docs/page.md', '[ok](target.md)');
        write('docs/target.md', '# T');
        write(
            'tools/docs-link-allowlist.json',
            JSON.stringify([{ path: 'docs/**', target: 'unused.md', reason: 'unused' }]),
        );
        const result = runTool();
        assert.equal(result.status, 2);
        assert.match(result.stdout, /unused allowlist entry/);
    });
});

