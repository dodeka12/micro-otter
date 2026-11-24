import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readText(relativePath) {
    return readFileSync(path.resolve(relativePath), 'utf8');
}

function readJson(relativePath) {
    return JSON.parse(readText(relativePath));
}

// Layout containers (`row`, `stack`) nest their children; the renderer walks
// both kinds, so the consistency checks must do the same.
function isLayoutContainer(entry) {
    return (
        (entry.type === 'row' || entry.type === 'stack') && Array.isArray(entry.controls)
    );
}

function collectControlFunctionDeclarations(controls = []) {
    const functions = [];

    for (const control of controls) {
        if (!control || typeof control !== 'object') {
            continue;
        }

        if (control.function && typeof control.function === 'object') {
            functions.push(control.function);
        }

        if (isLayoutContainer(control)) {
            functions.push(...collectControlFunctionDeclarations(control.controls));
        }
    }

    return functions;
}

function extractFunctionBlock(source, functionName) {
    const lines = source.split(/\r?\n/);
    const signaturePrefix = `def ${functionName}(`;
    const startIndex = lines.findIndex((line) => line.startsWith(signaturePrefix));

    if (startIndex === -1) {
        return '';
    }

    let endIndex = lines.length;
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        if (/^def [a-zA-Z_][a-zA-Z0-9_]*\(/.test(lines[i])) {
            endIndex = i;
            break;
        }
    }

    return lines.slice(startIndex, endIndex).join('\n');
}

describe('custom view doc/code consistency', () => {
    const architectureDoc = readText('docs/dev/view-system/custom-view-architecture.md');
    const rendererSource = readText(
        'src/micro_otter/nodes/html/js/views/custom-runtime-renderer.ts'
    );
    const runtimeDefinition = readJson(
        'src/micro_otter/nodes/device/runtime/general/custom_view.json'
    );
    const customSettingsSource = readText(
        'src/micro_otter/nodes/device/runtime/general/otter_runtime/custom_settings.py'
    );

    it('keeps schema version aligned between docs and runtime definition', () => {
        assert.match(architectureDoc, /custom-view-v1\.json/);
        assert.equal(
            runtimeDefinition.$schema,
            'https://micro-otter.dev/schemas/custom-view-v1.json'
        );
    });

    it('keeps execution boundary contract aligned between docs and renderer', () => {
        assert.match(
            architectureDoc,
            /executeCustomViewAction\(functionName, parameters, \{ runtimeImpact \}\)/
        );
        assert.match(rendererSource, /executeCustomViewAction\(/);
        assert.match(rendererSource, /direct executeCode fallback is not supported/);
        assert.doesNotMatch(rendererSource, /\.executeCode\(/);
    });

    it('keeps runtimeImpact semantics aligned with documented contract', () => {
        const toolbarFunctions = collectControlFunctionDeclarations(
            runtimeDefinition.toolbar?.controls || []
        );
        const sectionFunctions = (runtimeDefinition.sections || []).flatMap((section) =>
            collectControlFunctionDeclarations(section.controls || [])
        );
        const allFunctions = [...toolbarFunctions, ...sectionFunctions];
        const allowedValues = new Set(['none', 'stop', 'restart']);

        assert.ok(allFunctions.length > 0, 'Expected at least one runtime function declaration');

        for (const actionFn of allFunctions) {
            if (actionFn.runtimeImpact !== undefined) {
                assert.ok(
                    allowedValues.has(actionFn.runtimeImpact),
                    `Unsupported runtimeImpact for ${actionFn.name}: ${String(actionFn.runtimeImpact)}`
                );
            }
        }

        const functionsByName = new Map(allFunctions.map((actionFn) => [actionFn.name, actionFn]));
        assert.equal(functionsByName.get('create_runtime_settings')?.runtimeImpact, 'none');
        assert.equal(functionsByName.get('read_runtime_settings')?.runtimeImpact, 'none');
        assert.equal(functionsByName.get('check_wifi_status')?.runtimeImpact, 'stop');
        assert.equal(functionsByName.get('read_runtime_settings')?.executionIntent, 'refresh');
        assert.equal(functionsByName.get('check_wifi_status')?.executionIntent, 'refresh');
    });

    it('keeps general runtime custom-settings functions on structured JSON return contract', () => {
        const functionNames = [
            'check_wifi_status',
            'read_runtime_settings',
            'create_runtime_settings',
        ];

        for (const functionName of functionNames) {
            const block = extractFunctionBlock(customSettingsSource, functionName);
            assert.ok(block.length > 0, `Function block not found: ${functionName}`);
            assert.match(block, /return json\.dumps\(/);
        }

        const createRuntimeSettingsBlock = extractFunctionBlock(
            customSettingsSource,
            'create_runtime_settings'
        );
        assert.match(createRuntimeSettingsBlock, /'success': True/);
        assert.match(createRuntimeSettingsBlock, /if wifi_result\.get\('success'\) is False/);
        assert.match(createRuntimeSettingsBlock, /if webserver_result\.get\('success'\) is False/);
    });
});

function collectDeclaredControls(entries = []) {
    const controls = [];

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        if (isLayoutContainer(entry)) {
            controls.push(...collectDeclaredControls(entry.controls));
            continue;
        }

        if (typeof entry.id === 'string') {
            controls.push(entry);
        }
    }

    return controls;
}

function collectFunctionDeclarations(definition) {
    const functions = [];

    for (const control of definition.toolbar?.controls || []) {
        if (control?.function) {
            functions.push(control.function);
        }
    }

    for (const call of definition.setup?.calls || []) {
        functions.push(call);
    }

    for (const section of definition.sections || []) {
        functions.push(...collectControlFunctionDeclarations(section.controls || []));
    }

    return functions;
}

function resolveI18nKey(bundle, key) {
    let current = bundle;

    for (const segment of key.split('.')) {
        if (!current || typeof current !== 'object' || !(segment in current)) {
            return undefined;
        }
        current = current[segment];
    }

    return typeof current === 'string' ? current : undefined;
}

function readCustomSettingsBlock(functionName) {
    const source = readText(
        'src/micro_otter/nodes/device/runtime/general/otter_runtime/custom_settings.py'
    );
    return extractFunctionBlock(source, functionName);
}

describe('custom view wiring consistency', () => {
    const runtimeDefinition = readJson(
        'src/micro_otter/nodes/device/runtime/general/custom_view.json'
    );
    const declaredControls = collectDeclaredControls([
        ...(runtimeDefinition.toolbar?.controls || []),
        ...(runtimeDefinition.sections || []).flatMap((section) => section.controls || []),
    ]);
    const declaredIds = new Set(declaredControls.map((control) => control.id));

    it('resolves every control reference to a declared control', () => {
        const references = [];

        for (const control of declaredControls) {
            for (const key of ['validate', 'enableOnDirty', 'disableOnDirty', 'clearDirty']) {
                for (const id of control[key] || []) {
                    references.push([key, id]);
                }
            }

            const visibility = control.visibleWhen;
            for (const condition of Array.isArray(visibility) ? visibility : visibility ? [visibility] : []) {
                if (condition?.controlId) {
                    references.push(['visibleWhen', condition.controlId]);
                }
            }
        }

        for (const actionFn of collectFunctionDeclarations(runtimeDefinition)) {
            for (const parameter of actionFn.parameters || []) {
                const match = typeof parameter === 'string' ? parameter.match(/^\$\{([A-Za-z0-9_]+)\}$/) : null;
                if (match) {
                    references.push(['parameters', match[1]]);
                }
            }

            const mapping = actionFn.mapping || actionFn.onSuccess?.mapping || {};
            for (const value of Object.values(mapping)) {
                if (typeof value === 'string') {
                    references.push(['mapping', value]);
                }
            }
        }

        assert.ok(references.length > 0, 'Expected control references in the view definition');

        for (const [source, controlId] of references) {
            assert.ok(
                declaredIds.has(controlId),
                `${source} references undeclared control id: ${controlId}`
            );
        }
    });

    it('keeps create_runtime_settings parameters in signature order', () => {
        const expected = [
            'wifi_sta_enabled',
            'wifi_sta_ssid',
            'wifi_sta_password',
            'wifi_ap_enabled',
            'wifi_ap_ssid',
            'wifi_ap_password',
        ];
        const block = readCustomSettingsBlock('create_runtime_settings');
        const signature = block.slice(0, block.indexOf('):'));
        const positional = signature
            .split('\n')
            .map((line) => line.trim().replace(/,$/, ''))
            .filter((line) => /^[a-z_][a-z0-9_]*$/.test(line));

        assert.deepEqual(positional, expected);

        const upload = (runtimeDefinition.toolbar?.controls || []).find(
            (control) => control.function?.name === 'create_runtime_settings'
        );
        assert.ok(upload, 'Expected a create_runtime_settings toolbar button');

        const parameterIds = (upload.function.parameters || [])
            .slice(0, expected.length)
            .map((parameter) => parameter.replace(/^\$\{|\}$/g, ''));

        assert.deepEqual(parameterIds, expected);
    });

    it('keeps the access-point password rule aligned with the device', () => {
        const apPassword = declaredControls.find((control) => control.id === 'wifi_ap_password');
        assert.ok(apPassword, 'Expected a wifi_ap_password control');

        const validation = apPassword.validation || {};
        assert.equal(
            validation.allowEmpty,
            true,
            'wifi_ap_password must allow an empty value (open access point)'
        );
        assert.equal(
            validation.minLength,
            undefined,
            'wifi_ap_password must not use minLength: an empty password is allowed'
        );

        const pattern = new RegExp(validation.pattern || '');
        assert.ok(pattern.test('otter12345'), 'An 8-63 character password must be accepted');
        assert.ok(pattern.test('x'.repeat(63)), 'A 63 character password must be accepted');
        assert.ok(
            !pattern.test(''),
            'The pattern must reject an empty value; empty is allowed via allowEmpty'
        );
        assert.ok(!pattern.test('otter'), 'Passwords shorter than 8 characters must be rejected');
        assert.ok(!pattern.test('x'.repeat(64)), 'Passwords longer than 63 characters must be rejected');

        const profileValidation = extractFunctionBlock(
            readText('src/micro_otter/nodes/device/tools/wifi_manager.py'),
            '_validate_profile'
        );
        assert.ok(
            profileValidation.includes('if password and (len(password) < 8'),
            'tools.wifi_manager must keep accepting an empty password for both profiles'
        );
    });

    it('keeps download and setup mapping symmetric and profile-aware', () => {
        const download = (runtimeDefinition.toolbar?.controls || []).find(
            (control) => control.function?.name === 'read_runtime_settings'
        );
        assert.ok(download, 'Expected a read_runtime_settings toolbar button');

        const downloadMapping = download.function.onSuccess?.mapping || {};
        const setupMapping = runtimeDefinition.setup?.calls?.[0]?.mapping || {};

        assert.deepEqual(Object.keys(downloadMapping).sort(), Object.keys(setupMapping).sort());

        const readBlock = readCustomSettingsBlock('read_runtime_settings');
        for (const key of [
            'wifi_sta_enabled',
            'wifi_sta_ssid',
            'wifi_sta_password',
            'wifi_ap_enabled',
            'wifi_ap_ssid',
            'wifi_ap_password',
        ]) {
            assert.ok(
                readBlock.includes(`'${key}':`),
                `read_runtime_settings() must expose ${key}`
            );
        }
    });
});

function collectI18nKeys(node, keys = new Set()) {
    if (Array.isArray(node)) {
        for (const entry of node) {
            collectI18nKeys(entry, keys);
        }
        return keys;
    }

    if (!node || typeof node !== 'object') {
        return keys;
    }

    for (const [property, value] of Object.entries(node)) {
        if (
            typeof value === 'string' &&
            ['label', 'placeholder', 'message', 'errorMessage', 'title', 'defaultValue'].includes(
                property
            ) &&
            /^generalRuntime\./.test(value)
        ) {
            keys.add(value);
        } else {
            collectI18nKeys(value, keys);
        }
    }

    return keys;
}

describe('custom view locale coverage', () => {
    const runtimeDefinition = readJson(
        'src/micro_otter/nodes/device/runtime/general/custom_view.json'
    );
    const bundles = {
        en: readJson('src/micro_otter/nodes/device/runtime/general/locales/en.json'),
        de: readJson('src/micro_otter/nodes/device/runtime/general/locales/de.json'),
    };

    it('defines every view key in both languages', () => {
        const keys = [...collectI18nKeys(runtimeDefinition)].sort();

        assert.ok(keys.length > 0, 'Expected i18n keys in the view definition');

        for (const [language, bundle] of Object.entries(bundles)) {
            for (const key of keys) {
                assert.ok(
                    resolveI18nKey(bundle, key) !== undefined,
                    `${language}.json is missing ${key}`
                );
            }
        }
    });
});
