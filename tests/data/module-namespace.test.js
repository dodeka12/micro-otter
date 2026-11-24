// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    isPackageModuleImport,
    isPackageModulePath,
} from '../../src/micro_otter/nodes/html/js/data/module-namespace.js';

describe('isPackageModulePath', () => {
    it('classifies otter_, moa_, and libs/ paths as library paths', () => {
        assert.equal(isPackageModulePath('otter_core/system.py'), true);
        assert.equal(isPackageModulePath('moa_hello/__init__.py'), true);
        assert.equal(isPackageModulePath('libs/win/helpers.py'), true);
    });

    it('rejects app, tools, and collection paths', () => {
        assert.equal(isPackageModulePath('app/main_loop.py'), false);
        assert.equal(isPackageModulePath('tools/wifi.py'), false);
        assert.equal(isPackageModulePath('collection/example.json'), false);
    });
});

describe('isPackageModuleImport', () => {
    it('classifies otter_ and moa_ dotted imports', () => {
        assert.equal(isPackageModuleImport('otter_core.system'), true);
        assert.equal(isPackageModuleImport('moa_hello'), true);
    });

    it('rejects non-package imports', () => {
        assert.equal(isPackageModuleImport('app.main_loop'), false);
        assert.equal(isPackageModuleImport('os'), false);
    });
});
