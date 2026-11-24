// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import fs from 'node:fs';
import path from 'node:path';

const VERSION_SOURCE_PATH = 'src/micro_otter/_version.py';
const VERSION_PATTERN = /__version__\s*=\s*version\s*=\s*'([^']+)'/;

/**
 * Read the version hatch-vcs stamped into `src/micro_otter/_version.py`.
 *
 * That file is a build output (`[tool.hatch.build.hooks.vcs]` in `pyproject.toml`), so a checkout
 * that was never installed has no readable version. That is a build error, not a reason to invent
 * one: a bundle stamped `0.0.0-dev` looks exactly like a broken release, while a failed build names
 * the command that fixes it.
 *
 * @param {string} root - Repository root that holds `src/micro_otter/_version.py`.
 * @returns {string} The stamped version, for example `1.43.0` or `1.42.3.dev9+g013a0a74c`.
 * @throws {Error} When the file is unreadable or carries no `__version__` assignment.
 */
export function readProjectVersion(root) {
    const versionFilePath = path.resolve(root, VERSION_SOURCE_PATH);
    const relativePath = path.relative(root, versionFilePath);
    const remediation =
        `Run \`uv sync\` (or \`pip install -e .\`) so hatch-vcs writes ${relativePath}: ` +
        'the app version is a build output and is never tracked.';

    let source;
    try {
        source = fs.readFileSync(versionFilePath, 'utf-8');
    } catch {
        throw new Error(`Cannot read ${relativePath}. ${remediation}`);
    }

    const match = source.match(VERSION_PATTERN);
    if (!match || !match[1]) {
        throw new Error(`No __version__ assignment found in ${relativePath}. ${remediation}`);
    }

    return match[1];
}
