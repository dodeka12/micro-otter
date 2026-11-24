// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Source-level contract for the app wiring: `App.initialize()` starts the deployment progress
// controller once, after the workspace and the startup repair dialog, through the real
// `ProgressEventBus`. Assertions use stable substrings, never line numbers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js', 'app', 'main.ts');
const source = readFileSync(mainPath, 'utf8');

describe('main.ts — deployment progress wiring', () => {
    it('imports the controller and the dialog view', () => {
        assert.match(source, /from '\.\/deployment-progress-controller\.js'/);
        assert.match(source, /from '\.\.\/views\/deployment-progress-dialog-view\.js'/);
        assert.match(source, /startDeploymentProgressController/);
        assert.match(source, /DeploymentProgressDialogView/);
    });

    it('declares the stop handle and a start method on the app class', () => {
        assert.match(source, /stopDeploymentProgress: \(\(\) => void\) \| null;/);
        assert.match(source, /this\.stopDeploymentProgress = null;/);
        assert.match(source, /startDeploymentProgress\(\): void \{/);
    });

    it('starts the controller after the workspace and the startup repair dialog', () => {
        const repair = source.indexOf('showPendingCollectionRepairDialog');
        const start = source.indexOf('this.startDeploymentProgress();');

        assert.ok(repair >= 0, 'repair dialog call still present');
        assert.ok(start >= 0, 'controller started from initialize()');
        assert.ok(
            start > repair,
            'the repair dialog must not be the victim of the progress dialog'
        );
        assert.ok(
            source.indexOf('startDeploymentProgress()', start + 1) >= 0,
            'the start method exists after its call site'
        );
    });

    it('subscribes through the real ProgressEventBus and returns an unsubscribe', () => {
        assert.match(source, /subscribe: \(listener\) => \{/);
        assert.match(source, /ProgressEventBus\.subscribe\(listener\);/);
        assert.match(source, /return \(\) => ProgressEventBus\.unsubscribe\(listener\);/);
    });

    it('builds a DeploymentProgressDialogView with the translated title', () => {
        assert.match(source, /createDialog: \(title: string\) =>/);
        assert.match(source, /new DeploymentProgressDialogView\(\{/);
        assert.match(source, /title,/);
    });

    it('registers the dialog view with the logger', () => {
        assert.match(source, /logger\.register\('DeploymentProgressDialogView'\);/);
    });
});
