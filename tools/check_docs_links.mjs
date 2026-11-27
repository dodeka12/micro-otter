#!/usr/bin/env node
// Repository-wide relative-link gate.
//
// Scans every markdown tree the repository publishes (README.md, CONTRIBUTING.md,
// AGENTS.md, docs/, user-docs/, ai/, .cline/, dev/), skips the private plan tree
// (ldev/) and build output, and fails (exit 2) on a relative link whose target
// does not exist (or whose #fragment names no heading), on a case-mismatched
// path, and on an allowlist entry that matches nothing. `--root <dir>` and the
// DOCS_LINK_ROOT environment variable override the repository root, mirroring
// PAYLOAD_CHECK_ROOT.
//
// Contract: docs/dev/guides/testing-architecture.md (the check:docs-links row).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCAN_ROOTS = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'docs/', 'user-docs/', 'ai/', '.cline/', 'dev/'];
const EXCLUDED_PREFIXES = ['ldev/', 'site/', '_dist/', 'node_modules/', '.venv/'];

function rootOverride() {
    return process.env.DOCS_LINK_ROOT || null;
}

function trackedFiles(root) {
    try {
        const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.split('\0').filter((f) => f.length > 0);
    } catch {
        const result = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else result.push(path.relative(root, full).split(path.sep).join('/'));
            }
        };
        walk(root);
        return result;
    }
}

export function collectMarkdownFiles({ root, roots = SCAN_ROOTS } = {}) {
    const files = trackedFiles(root).filter((f) => f.endsWith('.md'));
    const inRoots = files.filter((f) => roots.some((r) => (r.endsWith('/') ? f.startsWith(r) : f === r)));
    return inRoots.filter((f) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)));
}

function blank(text) {
    return text.replace(/[^\r\n]/g, ' ');
}

export function stripNonLinks(markdown) {
    // Blank fenced code blocks (```/~~~, allowing up to 3 leading spaces) with a
    // line-based tracker, so an indented fence never leaks its sample into the
    // link scan while line numbers are preserved.
    const lines = markdown.split(/\r?\n/);
    let fenceChar = null;
    const out = [];
    for (const line of lines) {
        const trimmed = line.trimStart();
        if (fenceChar === null) {
            const fence = trimmed.match(/^(`{3,}|~{3,})/);
            if (fence) {
                fenceChar = fence[1][0];
                out.push(blank(line));
                continue;
            }
            out.push(line);
        } else {
            out.push(blank(line));
            if (trimmed.startsWith(fenceChar.repeat(3))) fenceChar = null;
        }
    }
    let text = out.join('\n');
    text = text.replace(/<!--[\s\S]*?-->/g, blank);
    text = text.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, blank);
    text = text.replace(/^ {4,}[^\n]*$/gm, blank);
    text = text.replace(/`[^`\n]*`/g, blank);
    return text;
}

export function extractLinks(markdown) {
    const links = [];
    const lines = markdown.split(/\r?\n/);
    const inline = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    lines.forEach((line, index) => {
        for (const m of line.matchAll(inline)) {
            links.push({ line: index + 1, raw: m[0], target: m[2] });
        }
        const ref = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)/);
        if (ref) links.push({ line: index + 1, raw: ref[0], target: ref[2] });
    });
    return links;
}

export function resolveTarget(sourcePath, target, root = process.cwd()) {
    let t = target.replace(/\s+"[^"]*"$/, '');
    if (/^(https?|mailto|tel|ftp|data):/i.test(t)) return null;
    if (t.startsWith('<') && t.endsWith('>')) return null;
    try {
        t = decodeURIComponent(t);
    } catch {
        /* keep the raw target */
    }
    const hashIndex = t.indexOf('#');
    let fragment = null;
    if (hashIndex >= 0) {
        fragment = t.slice(hashIndex + 1);
        t = t.slice(0, hashIndex);
    }
    const qIndex = t.indexOf('?');
    if (qIndex >= 0) t = t.slice(0, qIndex);
    if (t === '') return null; // anchors-only
    if (t.startsWith('/')) {
        const rel = t.slice(1);
        return { candidates: [path.join(root, rel), path.join(root, 'user-docs', rel)], fragment };
    }
    return { candidates: [path.resolve(path.dirname(sourcePath), t)], fragment };
}

export function headingSlugs(markdown) {
    const slugs = new Set();
    const occurrences = new Map();
    const add = (slug) => {
        const base = slug.toLowerCase().replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '-');
        const count = (occurrences.get(base) || 0) + 1;
        occurrences.set(base, count);
        slugs.add(count === 1 ? base : `${base}-${count - 1}`);
    };
    const lines = markdown.split(/\r?\n/);
    for (const line of lines) {
        const explicit = line.match(/\{#([^}]+)\}/g);
        if (explicit) explicit.forEach((m) => slugs.add(m.slice(2, -1)));
        const name = line.match(/<a\s+name="([^"]+)"/i);
        if (name) slugs.add(name[1]);
        const id = line.match(/\bid="([^"]+)"/i);
        if (id) slugs.add(id[1]);
        const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
        if (heading && !line.includes('{#') && !line.includes('<a ')) add(heading[1]);
    }
    return slugs;
}

export function loadAllowlist(pathname) {
    const raw = fs.readFileSync(pathname, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error(`${pathname} must be an array`);
    for (const entry of entries) {
        if (!entry.path || !entry.target || !entry.reason) {
            throw new Error(`allowlist entry needs path, target, and reason: ${JSON.stringify(entry)}`);
        }
    }
    return entries;
}

function globMatches(pattern, value) {
    const regex = new RegExp(
        '^' + pattern.split(/\*+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
    );
    return regex.test(value);
}

function relPath(root, absPath) {
    return path.relative(root, absPath).split(path.sep).join('/');
}

export function findBrokenLinks({ root, files, allowlist = [] }) {
    const tracked = trackedFiles(root);
    const fileSet = new Set(tracked);
    const dirSet = new Set();
    for (const f of tracked) {
        const parts = f.split('/');
        for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
    }
    const broken = [];
    const usedAllowlist = new Set();

    for (const rel of files) {
        const sourcePath = path.join(root, rel);
        const markdown = fs.readFileSync(sourcePath, 'utf8');
        const stripped = stripNonLinks(markdown);
        for (const { line, target } of extractLinks(stripped)) {
            const resolved = resolveTarget(sourcePath, target, root);
            if (!resolved) continue;
            const allow = allowlist.find((e) => globMatches(e.path, rel) && globMatches(e.target, target));
            if (allow) {
                usedAllowlist.add(allowlist.indexOf(allow));
                continue;
            }
            const hit = resolved.candidates.find((c) => {
                const r = relPath(root, c);
                return fileSet.has(r) || dirSet.has(r);
            });
            if (!hit) {
                broken.push({ file: rel, line, target, reason: 'missing file' });
                continue;
            }
            const hitRel = relPath(root, hit);
            const isMarkdownFile = fileSet.has(hitRel) && hit.endsWith('.md');
            if (resolved.fragment && !/^L\d+$/.test(resolved.fragment) && isMarkdownFile) {
                const targetMarkdown = fs.readFileSync(hit, 'utf8');
                if (!headingSlugs(targetMarkdown).has(resolved.fragment)) {
                    broken.push({ file: rel, line, target, reason: 'missing anchor' });
                }
            }
        }
    }

    const unusedAllowlist = allowlist
        .map((entry, index) => ({ entry, index }))
        .filter(({ index }) => !usedAllowlist.has(index))
        .map(({ entry }) => entry);

    return { broken, unusedAllowlist };
}

export function main(argv = process.argv.slice(2)) {
    let root = rootOverride() || process.cwd();
    let json = false;
    let noAllowlist = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--root') root = path.resolve(argv[++i]);
        else if (arg === '--json') json = true;
        else if (arg === '--no-allowlist') noAllowlist = true;
        else if (arg === '--help') {
            console.log('usage: node tools/check_docs_links.mjs [--root <dir>] [--json] [--no-allowlist]');
            return;
        }
    }
    const allowlistPath = path.join(root, 'tools', 'docs-link-allowlist.json');

    let allowlist = [];
    if (!noAllowlist && fs.existsSync(allowlistPath)) {
        try {
            allowlist = loadAllowlist(allowlistPath);
        } catch (error) {
            console.error(`invalid allowlist: ${error.message}`);
            process.exit(2);
        }
    }

    const files = collectMarkdownFiles({ root });
    const { broken, unusedAllowlist } = findBrokenLinks({ root, files, allowlist });

    if (json) {
        console.log(JSON.stringify({ broken, unusedAllowlist }, null, 2));
    } else {
        for (const b of broken) console.log(`${b.file}:${b.line} → ${b.target} (${b.reason})`);
        for (const u of unusedAllowlist) console.log(`unused allowlist entry: ${u.path} → ${u.target}`);
    }

    if (broken.length > 0 || unusedAllowlist.length > 0) process.exit(2);
    console.log(`${files.length} files checked, 0 broken links, 0 unused allowlist entries`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

