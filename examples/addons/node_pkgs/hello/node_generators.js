// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Hello example add-on: the code generator behind the `hello.greet` node type.

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }

    /**
     * Generate the loop expression for the ``hello.greet`` node.
     *
     * Registers the ``moa_hello`` import once (the transpiler deduplicates it) and
     * emits a call to its ``greeting()`` function, whose string result the
     * transpiler assigns to the node's output.
     *
     * @param {object} context - Generator context from the transpiler.
     * @returns {{expression: string}} The generated expression.
     */
    globalScope.NodeCodeGenerators.moaHelloGreet = function (context) {
        const helpers = (context && context.helpers) || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import moa_hello');
        }
        return { expression: 'moa_hello.greeting()' };
    };
})();
