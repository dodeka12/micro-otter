import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readGeneralRuntimeCustomViewDefinition() {
    return JSON.parse(
        readFileSync(
            path.resolve('src/micro_otter/nodes/device/runtime/general/custom_view.json'),
            'utf8'
        )
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

        if (control.type === 'row' && Array.isArray(control.controls)) {
            functions.push(...collectControlFunctionDeclarations(control.controls));
        }
    }

    return functions;
}

describe('general runtime custom view runtimeImpact declarations', () => {
    it('uses supported runtimeImpact values for all action functions', () => {
        const definition = readGeneralRuntimeCustomViewDefinition();
        const toolbarFunctions = collectControlFunctionDeclarations(definition.toolbar?.controls || []);
        const sectionFunctions = (definition.sections || []).flatMap((section) =>
            collectControlFunctionDeclarations(section.controls || [])
        );
        const allFunctions = [...toolbarFunctions, ...sectionFunctions];

        assert.ok(allFunctions.length > 0, 'Expected at least one function declaration');

        for (const actionFn of allFunctions) {
            assert.ok(
                actionFn.runtimeImpact === undefined
                || actionFn.runtimeImpact === 'none'
                || actionFn.runtimeImpact === 'stop'
                || actionFn.runtimeImpact === 'restart',
                `Unsupported runtimeImpact for function ${actionFn.name}: ${String(actionFn.runtimeImpact)}`
            );
        }
    });

    it('declares expected runtimeImpact values for current general runtime actions', () => {
        const definition = readGeneralRuntimeCustomViewDefinition();
        const toolbarFunctions = collectControlFunctionDeclarations(definition.toolbar?.controls || []);
        const sectionFunctions = (definition.sections || []).flatMap((section) =>
            collectControlFunctionDeclarations(section.controls || [])
        );
        const functionsByName = new Map(
            [...toolbarFunctions, ...sectionFunctions].map((actionFn) => [actionFn.name, actionFn])
        );

        assert.equal(functionsByName.get('create_runtime_settings')?.runtimeImpact, 'none');
        assert.equal(functionsByName.get('read_runtime_settings')?.runtimeImpact, 'none');
        assert.equal(functionsByName.get('check_wifi_status')?.runtimeImpact, 'stop');
    });

    it('declares refresh execution intent for read/refresh actions', () => {
        const definition = readGeneralRuntimeCustomViewDefinition();

        const toolbarFunctions = collectControlFunctionDeclarations(definition.toolbar?.controls || []);
        const sectionFunctions = (definition.sections || []).flatMap((section) =>
            collectControlFunctionDeclarations(section.controls || [])
        );
        const functionsByName = new Map(
            [...toolbarFunctions, ...sectionFunctions].map((actionFn) => [actionFn.name, actionFn])
        );

        assert.equal(functionsByName.get('read_runtime_settings')?.executionIntent, 'refresh');
        assert.equal(functionsByName.get('check_wifi_status')?.executionIntent, 'refresh');
    });
});
