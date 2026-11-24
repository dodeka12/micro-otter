# Test Import Analysis Report

Analysis performed on: January 18, 2026

## Executive Summary

- **Total test files analyzed:** 36
- **Tests with broken imports (Legacy):** 13
- **Tests with all valid imports (V2):** 23

---

## 🔴 TEST FILES WITH BROKEN IMPORTS (Definitely Legacy - 13 files)

These test files import source files that no longer exist in the v2 codebase. They are definitely legacy tests that reference the old v1 architecture.

### 1. capability-validator.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/capability-validator.js`
  - **Status:** Does not exist in v2

### 2. device-collections.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/device-collections.js`
  - **Status:** Does not exist in v2

### 3. device-config-schema.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/device-config-schema.js`
  - **Status:** Does not exist in v2
- ❌ `../../src/micro_otter/nodes/html/js/core/workspace-schema.js`
  - **Status:** Does not exist in v2

### 4. device-sync-helpers.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/device-config-schema.js`
  - **Status:** Does not exist in v2
**Valid imports:**
- ✓ `../../src/micro_otter/nodes/html/js/webserial/deployer/device-sync-helpers.js`

### 5. flagged-version.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/data/flagged_version.js`
  - **Status:** Does not exist in v2 (underscore vs hyphen: v2 uses `flagged-version.js`)

### 6. graph-panel-collection-options.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/graph-panel-collection-options.js`
  - **Status:** Does not exist in v2

### 7. node-configs.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/device-config-schema.js`
  - **Status:** Does not exist in v2
**Valid imports:**
- ✓ `../../src/micro_otter/nodes/html/js/webserial/deployer/node-configs.js`

### 8. node-graph.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/data/viewport_config.js`
  - **Status:** Does not exist in v2 (underscore vs hyphen: v2 uses `viewport-config.js`)
**Valid imports:**
- ✓ `../../src/micro_otter/nodes/html/js/data/node-graph.js`

### 9. packages-loader.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/packages.js`
  - **Status:** Does not exist in v2

### 10. packages-merge.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/packages.js`
  - **Status:** Does not exist in v2

### 11. packages-registry.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/core/packages.js`
  - **Status:** Does not exist in v2

### 12. transpiler-connector-metadata.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/nodes/transpiler-helpers.js`
  - **Status:** Does not exist in v2

### 13. viewport-config.test.js
**Broken imports:**
- ❌ `../../src/micro_otter/nodes/html/js/data/viewport_config.js`
  - **Status:** Does not exist in v2 (underscore vs hyphen: v2 uses `viewport-config.js`)

---

## ✅ TEST FILES WITH ALL VALID IMPORTS (Likely V2 - 23 files)

These test files import only source files that exist in the current v2 codebase, or they have no source imports at all (they test Node.js built-in functionality or use dynamic imports).

### Tests with Valid Source Imports (7 files)

1. **collection.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/data/collection.js`

2. **i18n-service.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/i18n/i18n-service.js`

3. **i18n-view-integration.test.js** (6 imports)
   - ✓ `../../src/micro_otter/nodes/html/js/i18n/i18n-service.js`
   - ✓ `../../src/micro_otter/nodes/html/js/views/view-manager.js`
   - ✓ `../../src/micro_otter/nodes/html/js/views/view-base.js`
   - ✓ `../../src/micro_otter/nodes/html/js/views/view-factory.js`
   - ✓ `../../src/micro_otter/nodes/html/js/views/split-view.js`
   - ✓ `../../src/micro_otter/nodes/html/js/views/tabbed-view.js`

4. **indexed-store.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/data/indexed-store.js`

5. **profile-package-gate.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/webserial/deployer/package-gate.js`

6. **progress-events.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/core/progress-events.js`

7. **view-store.test.js**
   - ✓ `../../src/micro_otter/nodes/html/js/data/view-store.js`

### Tests with No Source Imports (16 files)

These tests use dynamic imports (`await import()`) or only import Node.js built-in modules:

1. **device-packages-guard.test.js**
2. **packages-asset-planner.test.js** (uses dynamic imports)
3. **packages-transpiler-assets.test.js** (uses dynamic imports)
4. **stdmo-capabilities.test.js** (uses dynamic imports)
5. **syntax-check.test.js** (tests syntax checking with Node.js)
6. **transpiler-assignment-behavior.test.js** (uses dynamic imports)
7. **transpiler-function-callable.test.js** (uses dynamic imports)
8. **transpiler-function-padding.test.js** (uses dynamic imports)
9. **transpiler-function-prelude.test.js** (uses dynamic imports)
10. **transpiler-generator-metadata.test.js** (uses dynamic imports)
11. **transpiler-generator-padding.test.js** (uses dynamic imports)
12. **transpiler-generator-return-shape.test.js** (uses dynamic imports)
13. **transpiler-output-connection-guard.test.js** (uses dynamic imports)
14. **transpiler-output-vars.test.js** (uses dynamic imports)
15. **transpiler-servo-function.test.js** (uses dynamic imports)
16. **transpiler-unconnected-outputs.test.js** (uses dynamic imports)

---

## Missing Source Files

The following source files are referenced by legacy tests but don't exist in the v2 codebase:

### Core Module Files (missing from `src/micro_otter/nodes/html/js/core/`)
- ❌ `capability-validator.js`
- ❌ `device-collections.js`
- ❌ `device-config-schema.js`
- ❌ `graph-panel-collection-options.js`
- ❌ `packages.js`
- ❌ `workspace-schema.js`

### Data Module Files (naming convention changes)
- ❌ `data/flagged_version.js` → exists as `data/flagged-version.js`
- ❌ `data/viewport_config.js` → exists as `data/viewport-config.js`

### Node Module Files (missing from `src/micro_otter/nodes/html/js/nodes/`)
- ❌ `transpiler-helpers.js`

---

## Recommendations

1. **Archive Legacy Tests:** The 13 test files with broken imports should be moved to `tests-obsolete/` since they test v1 code that no longer exists.

2. **Update Naming Convention Tests:** Some tests like `flagged-version.test.js` and `viewport-config.test.js` have broken imports due to naming convention changes (underscore → hyphen). These could potentially be updated to test the v2 equivalents if the functionality is similar.

3. **Maintain V2 Tests:** The 23 tests with valid imports are actively testing the current v2 codebase and should be maintained.

4. **Dynamic Import Tests:** The 16 tests using dynamic imports (mostly transpiler tests) are particularly valuable as they test the core transpilation functionality and should be regularly run.

---

## Files Currently in V2 Codebase

For reference, the v2 codebase contains 73 JavaScript files organized into these directories:
- `app/` - Application entry points
- `core/` - Core functionality
- `data/` - Data models and storage
- `i18n/` - Internationalization
- `nodes/` - Node UI components
- `views/` - View system
- `webserial/` - Serial communication and deployment

**Note:** There are also 38 JavaScript files in the `v1/` directory that represent the legacy codebase.
