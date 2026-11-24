// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readProjectVersion } from '../../tools/project-version.mjs';

const VERSION_FILE = path.join('src', 'micro_otter', '_version.py');

/**
 * Create a throwaway repository root.
 * @param {string | null} versionSource - Contents for `src/micro_otter/_version.py`; `null` leaves
 *     the file absent, which is the state of a checkout that was never installed.
 * @returns {string} Absolute path of the temporary root.
 */
function createRoot(versionSource) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-version-'));
    if (versionSource !== null) {
        const versionFile = path.join(root, VERSION_FILE);
        fs.mkdirSync(path.dirname(versionFile), { recursive: true });
        fs.writeFileSync(versionFile, versionSource, 'utf-8');
    }
    return root;
}

describe('readProjectVersion', () => {
    it('reads the version hatch-vcs wrote into _version.py', () => {
        const root = createRoot(
            "__version__ = version = '1.43.0'\n__version_tuple__ = version_tuple = (1, 43, 0)\n"
        );

        assert.equal(readProjectVersion(root), '1.43.0');
    });

    it('keeps a dev version with its commit suffix verbatim', () => {
        const root = createRoot("__version__ = version = '1.42.3.dev9+g013a0a74c'\n");

        assert.equal(readProjectVersion(root), '1.42.3.dev9+g013a0a74c');
    });

    it('fails the build instead of inventing a version when the file is missing', () => {
        const root = createRoot(null);

        assert.throws(() => readProjectVersion(root), /Cannot read .*_version\.py[\s\S]*uv sync/);
    });

    it('fails the build when the file carries no __version__ assignment', () => {
        const root = createRoot('# placeholder only\n');

        assert.throws(
            () => readProjectVersion(root),
            /No __version__ assignment found in .*_version\.py/
        );
    });
});
