// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Home Assistant node generators: discovery entities on top of the MQTT runtime.

(function () {
    const globalScope =
        typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }

    function registerImport(context, statement) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport(statement);
        }
    }

    function ensureHassImport(context) {
        registerImport(context, 'from otter_hass import runtime as _hass');
    }

    function ensureMqttImport(context) {
        registerImport(context, 'from otter_mqtt import runtime as _mqtt');
    }

    function formatLiteral(value, context) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.formatLiteral === 'function') {
            return helpers.formatLiteral(value);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (value === null || value === undefined) {
            return 'None';
        }
        return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    function textValue(context, controlId, fallback) {
        const raw = controlValues(context)[controlId];
        if (raw === undefined || raw === null) {
            return fallback === undefined ? '' : fallback;
        }
        return String(raw).trim();
    }

    function objectId(context) {
        return textValue(context, 'objectId');
    }

    function booleanValue(context, controlId, fallback) {
        const raw = controlValues(context)[controlId];
        if (raw === undefined || raw === null) {
            return fallback;
        }
        return Boolean(raw);
    }

    function numberValue(context, controlId, fallback) {
        const raw = controlValues(context)[controlId];
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function inputConnected(context, index) {
        const meta = Array.isArray(context && context.inputsMeta) ? context.inputsMeta : [];
        return Boolean(meta[index] && meta[index].connected);
    }

    function isOutputConnected(context, index) {
        const meta = Array.isArray(context && context.outputsMeta) ? context.outputsMeta : [];
        if (meta.length === 0) {
            return Boolean(context && Array.isArray(context.outputs) && context.outputs[index]);
        }
        return Boolean(meta[index] && meta[index].connected);
    }

    function outputName(context, index) {
        if (context && Array.isArray(context.outputs) && context.outputs[index]) {
            return context.outputs[index];
        }
        return null;
    }

    /** Build a `{...}` literal, keeping only the keys that are set. */
    function configLiteral(entries, context, listEntry) {
        const parts = [];
        entries.forEach((entry) => {
            const key = entry[0];
            const value = entry[1];
            if (value === undefined || value === null || value === '') {
                return;
            }
            parts.push(formatLiteral(key, context) + ': ' + formatLiteral(value, context));
        });
        if (listEntry && Array.isArray(listEntry[1]) && listEntry[1].length > 0) {
            const items = listEntry[1].map((value) => formatLiteral(value, context)).join(', ');
            parts.push(formatLiteral(listEntry[0], context) + ': [' + items + ']');
        }
        return '{' + parts.join(', ') + '}';
    }

    /** Modes Home Assistant accepts for `availability_mode`. */
    const AVAILABILITY_MODES = ['all', 'any', 'latest'];

    /**
     * Reserved flag-list value that selects the bridge's device availability topic.
     * Mirrors `DEVICE_AVAILABILITY_ENTRY` in `nodes/availability-flags.ts`; it is never
     * forwarded to the runtime as a named flag.
     */
    const DEVICE_AVAILABILITY_ENTRY = '__device__';

    /**
     * Split the availability list into the device decision and the named flags.
     *
     * New nodes carry `__device__` in the list. A legacy `availability` control, if it is
     * still stored, wins so an un-migrated graph keeps its old output. A node with neither
     * a flag list nor a legacy control keeps the historical default of device availability.
     */
    function availabilitySelection(context) {
        const values = controlValues(context);
        const raw = values.availabilityFlags;
        const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
        const flags = [];
        let hasDeviceEntry = false;

        entries.forEach((entry) => {
            const flag = String(entry === undefined || entry === null ? '' : entry).trim();
            if (!flag) {
                return;
            }
            if (flag === DEVICE_AVAILABILITY_ENTRY) {
                hasDeviceEntry = true;
                return;
            }
            if (flags.indexOf(flag) < 0) {
                flags.push(flag);
            }
        });

        const hasLegacyControl = Object.prototype.hasOwnProperty.call(values, 'availability');
        const hasFlagControl = Object.prototype.hasOwnProperty.call(values, 'availabilityFlags');
        const device = hasLegacyControl
            ? Boolean(values.availability)
            : hasFlagControl
              ? hasDeviceEntry
              : true;

        return { device, flags };
    }

    /** Combination mode of the availability list; unknown values fall back to `all`. */
    function availabilityMode(context) {
        const mode = textValue(context, 'availabilityMode', 'all') || 'all';
        return AVAILABILITY_MODES.indexOf(mode) >= 0 ? mode : 'all';
    }

    function registerEntityStatement(component, entityId, configExpr, context, options) {
        const name = textValue(context, 'name');
        const expireAfter = numberValue(context, 'expireAfter', 0);
        const availability = availabilitySelection(context);
        // A state-less entity (button, or a writable node with `Report State` off) drops
        // the state topic; the caller decides, so a node without the control keeps its state.
        const reportState =
            options && options.reportState === false ? false : reportStateOf(context);
        const args = ["'" + component + "'", formatLiteral(entityId, context)];
        if (configExpr) {
            args.push('config=' + configExpr);
        }
        if (name) {
            args.push('name=' + formatLiteral(name, context));
        }
        if (expireAfter > 0) {
            args.push('expire_after=' + formatLiteral(expireAfter, context));
        }
        if (availability.flags.length > 0) {
            // The runtime turns the flag list into HA's `availability` list and drops the
            // scalar topic, so the device decision travels as a plain boolean.
            args.push('availability=' + formatLiteral(availability.device, context));
            args.push(
                'availability_flags=[' +
                    availability.flags.map((flag) => formatLiteral(flag, context)).join(', ') +
                    ']'
            );
            args.push('availability_mode=' + formatLiteral(availabilityMode(context), context));
        } else if (!availability.device) {
            args.push('availability=False');
        }
        if (!reportState) {
            args.push('report_state=False');
        }
        return '_hass.register_entity(' + args.join(', ') + ')';
    }

    globalScope.NodeInitGenerators.hassBridge = function (context) {
        ensureHassImport(context);
        ensureMqttImport(context);
        const controls = controlValues(context);
        const availability = booleanValue(context, 'availability', true);
        const will = booleanValue(context, 'will', true);
        const block =
            '_hass.configure(' +
            'device_id=' +
            formatLiteral(textValue(context, 'deviceId'), context) +
            ', ' +
            'device_name=' +
            formatLiteral(textValue(context, 'deviceName'), context) +
            ', ' +
            'discovery_prefix=' +
            formatLiteral(
                textValue(context, 'discoveryPrefix', 'homeassistant') || 'homeassistant',
                context
            ) +
            ', ' +
            'topic_prefix=' +
            formatLiteral(textValue(context, 'topicPrefix', 'otter') || 'otter', context) +
            ', ' +
            'availability=' +
            formatLiteral(availability, context) +
            ', ' +
            'manufacturer=' +
            formatLiteral(textValue(context, 'manufacturer', 'Micro-Otter'), context) +
            ', ' +
            'model=' +
            formatLiteral(textValue(context, 'model'), context) +
            ', ' +
            'sw_version=' +
            formatLiteral(textValue(context, 'swVersion'), context) +
            ', ' +
            'will=' +
            formatLiteral(will, context) +
            ')';
        // configure() must precede register_entity(): entity nodes keep priority 5 and the
        // mqtt registrations use 10, so graph iteration order can never put configure() last.
        return { init: { block, priority: 1, execute: '_mqtt.start()' } };
    };

    // The transpiler requires a loop implementation for every node, but the bridge is
    // configured once in init_mqtt() and the birth re-announce lives in otter_hass.runtime
    // (message hook), so an Init graph needs no loop.
    globalScope.NodeCodeGenerators.hassBridge = function () {
        return { statement: '# hass bridge: configured in init_mqtt', outputs: [] };
    };

    function nodeId(context) {
        const raw = context && context.node ? context.node.id : '';
        return raw === undefined || raw === null || raw === '' ? 'node' : String(raw);
    }

    /** Id of one availability flag; the runtime sanitises it into the topic segment. */
    function availabilityId(context) {
        return textValue(context, 'id');
    }

    /** Deferred-publish memo key of one flag node (`<prefix>_<node id>`). */
    function availabilityMemo(context, prefix) {
        return prefix + '_' + nodeId(context);
    }

    globalScope.NodeInitGenerators.hassAvailability = function (context) {
        const flagId = availabilityId(context);
        if (!flagId) {
            return {
                init: {
                    block: '# hass availability: id is empty',
                    priority: 5,
                    execute: '_mqtt.start()',
                },
            };
        }
        ensureHassImport(context);
        ensureMqttImport(context);
        return {
            init: {
                block:
                    '_mqtt.register_publish(' +
                    'topic=_hass.availability_topic(' +
                    formatLiteral(flagId, context) +
                    '), qos=0)',
                priority: 5,
                execute: '_mqtt.start()',
            },
        };
    };

    globalScope.NodeCodeGenerators.hassAvailability = function (context) {
        const flagId = availabilityId(context);
        if (!flagId) {
            return { statement: '# hass availability: id is empty', outputs: [] };
        }
        ensureHassImport(context);
        ensureMqttImport(context);
        const input = inputRef(context, 1, 'False');
        const enabled = inputRef(context, 0, 'True');
        // The broker retains the payload, so it is published once and only when it changes.
        return {
            statement:
                'if bool(' +
                enabled +
                '):\n    _mqtt.publish_deferred(' +
                'topic=_hass.availability_topic(' +
                formatLiteral(flagId, context) +
                '), ' +
                "payload=('online' if (" +
                input +
                ") else 'offline'), " +
                'qos=0, retain=True, ' +
                'key=' +
                formatLiteral(availabilityMemo(context, '_hass_avail'), context) +
                ', ' +
                'if_changed=' +
                formatLiteral(availabilityMemo(context, '_hass_avail_last'), context) +
                ')',
            outputs: [],
        };
    };

    /**
     * Loop generator of a writable entity.
     *
     * Output order is `value` (0), `command` (1), `updated` (2); each output is emitted only
     * when it is wired, in index order. `Command` reuses the `value` variable while Home
     * Assistant owns the value, so a graph that reads both emits a single runtime call.
     */
    function codeGeneratorForWritableEntity(spec) {
        return function (context) {
            ensureHassImport(context);
            const guard = entityGuard(spec.component, context);
            if (!guard.entityId) {
                return { statement: guard.statement, outputs: [] };
            }

            const entity = formatLiteral(guard.entityId, context);
            const input = inputRef(context, 1, spec.defaultInput);
            const authority = authorityOf(context);
            const commandExpr =
                "_hass.latest_command('" +
                spec.component +
                "', " +
                entity +
                ", value_type='" +
                spec.valueType +
                "', default=(" +
                input +
                '))';

            const valueVar = isOutputConnected(context, 0) ? outputName(context, 0) : null;
            const commandVar = isOutputConnected(context, 1) ? outputName(context, 1) : null;
            const updatedVar = isOutputConnected(context, 2) ? outputName(context, 2) : null;

            const lines = [];
            const outputs = [];

            if (valueVar) {
                lines.push(valueVar + ' = ' + (authority === 'device' ? input : commandExpr));
                outputs.push(valueVar);
            }
            if (commandVar) {
                const reuseValue = authority === 'homeassistant' && valueVar;
                lines.push(commandVar + ' = ' + (reuseValue ? valueVar : commandExpr));
                outputs.push(commandVar);
            }
            if (updatedVar) {
                lines.push(
                    updatedVar +
                        " = _hass.take_command('" +
                        spec.component +
                        "', " +
                        entity +
                        ", value_type='" +
                        spec.valueType +
                        "', key=" +
                        formatLiteral(commandKey(context), context) +
                        ')'
                );
                outputs.push(updatedVar);
            }
            // Command processing and the outputs stay unconditional; only state
            // publication is gated, so a disabled entity still accepts commands.
            if (reportStateOf(context)) {
                const stateExpr = inputConnected(context, 1)
                    ? input
                    : valueVar || spec.defaultState;
                const stateStatement = publishStateStatement(
                    spec.component,
                    guard.entityId,
                    stateExpr,
                    context
                );
                const enabled = inputRef(context, 0, 'True');
                lines.push('if bool(' + enabled + '):\n    ' + stateStatement);
            }

            if (lines.length === 0) {
                // Write-only control with nothing wired: the transpiler still needs a body,
                // and a comment keeps the generated app free of unused calls.
                return {
                    statement:
                        '# hass ' + spec.component + ': report state off and no outputs connected',
                    outputs: [],
                };
            }

            return { statement: lines.join('\n'), outputs };
        };
    }

    function publishStateStatement(component, entityId, valueExpr, context) {
        return (
            '_hass.publish_state(' +
            "'" +
            component +
            "', " +
            formatLiteral(entityId, context) +
            ', (' +
            valueExpr +
            '), retain=True)'
        );
    }

    function entityGuard(component, context) {
        const entityId = objectId(context);
        if (!entityId) {
            return { entityId: '', statement: '# hass ' + component + ': objectId is empty' };
        }
        return { entityId, statement: null };
    }

    /**
     * Who owns the value: `device` or `homeassistant`.
     *
     * A node without the control — a transpile fixture, an export older than the control,
     * a collection whose definition snapshot was never refreshed — behaves like
     * `homeassistant`. That is the behaviour every writable node had before the control
     * existed, so a missing key can never invert a saved graph.
     */
    function authorityOf(context) {
        const value = textValue(context, 'authority', 'homeassistant') || 'homeassistant';
        return value === 'device' ? 'device' : 'homeassistant';
    }

    /** `Report State` is on unless the node carries the control switched off. */
    function reportStateOf(context) {
        return booleanValue(context, 'reportState', true);
    }

    /**
     * Consume key of one node's `updated` output.
     *
     * The runtime default is the command topic, which two nodes on the same entity would
     * share — the faster node would swallow the edge. The node id makes the key per node,
     * exactly like the generated `node_<id>_out<idx>` variable names.
     */
    function commandKey(context) {
        return 'hass_cmd_' + nodeId(context);
    }

    function parseOptions(context) {
        return textValue(context, 'options')
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    /**
     * Shared contract of the writable entities (`number`, `switch`, `select`, `text`).
     *
     * They differ in component, value type, defaults and the discovery config they need;
     * authority, report state and the three outputs are the same everywhere.
     */
    const WRITABLE_ENTITIES = {
        number: {
            component: 'number',
            valueType: 'float',
            defaultInput: '0',
            defaultState: '0.0',
            config: (context) => [
                ['icon', textValue(context, 'icon')],
                ['min', numberValue(context, 'min', 0)],
                ['max', numberValue(context, 'max', 100)],
                ['step', numberValue(context, 'step', 1)],
                ['mode', textValue(context, 'mode', 'auto') || 'auto'],
                ['unit_of_measurement', textValue(context, 'unit')],
            ],
        },
        switch: {
            component: 'switch',
            valueType: 'bool',
            defaultInput: 'False',
            defaultState: 'False',
            config: (context) => [
                ['icon', textValue(context, 'icon')],
                ['payload_on', textValue(context, 'payloadOn', 'true') || 'true'],
                ['payload_off', textValue(context, 'payloadOff', 'false') || 'false'],
            ],
        },
        select: {
            component: 'select',
            valueType: 'string',
            defaultInput: "''",
            defaultState: "''",
            config: (context) => [['icon', textValue(context, 'icon')]],
            list: (context) => ['options', parseOptions(context)],
        },
        text: {
            component: 'text',
            valueType: 'string',
            defaultInput: "''",
            defaultState: "''",
            // `min`/`max` are the node's length contract, so they are always emitted;
            // `pattern` is omitted while empty, like every other config key.
            config: (context) => [
                ['icon', textValue(context, 'icon')],
                ['min', numberValue(context, 'min', 0)],
                ['max', numberValue(context, 'max', 255)],
                ['pattern', textValue(context, 'pattern')],
                ['mode', textValue(context, 'mode', 'text') || 'text'],
            ],
        },
    };

    /** Init generator of a writable entity: announce it and subscribe its command topic. */
    function initGeneratorForWritableEntity(spec) {
        return function (context) {
            ensureHassImport(context);
            const guard = entityGuard(spec.component, context);
            if (!guard.entityId) {
                return { init: { block: guard.statement, priority: 5, execute: '_mqtt.start()' } };
            }
            const config = configLiteral(
                spec.config(context),
                context,
                spec.list ? spec.list(context) : undefined
            );
            const block = registerEntityStatement(spec.component, guard.entityId, config, context);
            return { init: { block, priority: 5, execute: '_mqtt.start()' } };
        };
    }

    globalScope.NodeInitGenerators.hassSensor = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('sensor', context);
        if (!guard.entityId) {
            return { init: { block: guard.statement, priority: 5, execute: '_mqtt.start()' } };
        }
        const config = configLiteral(
            [
                ['icon', textValue(context, 'icon')],
                ['device_class', textValue(context, 'deviceClass')],
                ['unit_of_measurement', textValue(context, 'unit')],
                ['state_class', textValue(context, 'stateClass')],
            ],
            context
        );
        const block = registerEntityStatement('sensor', guard.entityId, config, context);
        return { init: { block, priority: 5, execute: '_mqtt.start()' } };
    };

    globalScope.NodeCodeGenerators.hassSensor = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('sensor', context);
        if (!guard.entityId) {
            return { statement: guard.statement, outputs: [] };
        }
        const value = inputRef(context, 1, 'None');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement:
                'if bool(' +
                enabled +
                '):\n    ' +
                publishStateStatement('sensor', guard.entityId, value, context),
            outputs: [],
        };
    };

    globalScope.NodeInitGenerators.hassBinarySensor = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('binary_sensor', context);
        if (!guard.entityId) {
            return { init: { block: guard.statement, priority: 5, execute: '_mqtt.start()' } };
        }
        const config = configLiteral(
            [
                ['icon', textValue(context, 'icon')],
                ['device_class', textValue(context, 'deviceClass')],
                ['payload_on', 'true'],
                ['payload_off', 'false'],
            ],
            context
        );
        const block = registerEntityStatement('binary_sensor', guard.entityId, config, context);
        return { init: { block, priority: 5, execute: '_mqtt.start()' } };
    };

    globalScope.NodeCodeGenerators.hassBinarySensor = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('binary_sensor', context);
        if (!guard.entityId) {
            return { statement: guard.statement, outputs: [] };
        }
        const value = inputRef(context, 1, 'False');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement:
                'if bool(' +
                enabled +
                '):\n    ' +
                publishStateStatement('binary_sensor', guard.entityId, value, context),
            outputs: [],
        };
    };

    // The three writable entities are one generator with three parameters; `hass-text`
    // (phase 5) is the fourth parameter set of the same contract.
    globalScope.NodeInitGenerators.hassNumber = initGeneratorForWritableEntity(
        WRITABLE_ENTITIES.number
    );
    globalScope.NodeCodeGenerators.hassNumber = codeGeneratorForWritableEntity(
        WRITABLE_ENTITIES.number
    );

    globalScope.NodeInitGenerators.hassSwitch = initGeneratorForWritableEntity(
        WRITABLE_ENTITIES.switch
    );
    globalScope.NodeCodeGenerators.hassSwitch = codeGeneratorForWritableEntity(
        WRITABLE_ENTITIES.switch
    );

    globalScope.NodeInitGenerators.hassSelect = initGeneratorForWritableEntity(
        WRITABLE_ENTITIES.select
    );
    globalScope.NodeCodeGenerators.hassSelect = codeGeneratorForWritableEntity(
        WRITABLE_ENTITIES.select
    );

    globalScope.NodeInitGenerators.hassText = initGeneratorForWritableEntity(
        WRITABLE_ENTITIES.text
    );
    globalScope.NodeCodeGenerators.hassText = codeGeneratorForWritableEntity(
        WRITABLE_ENTITIES.text
    );

    // The receive-only shape: a `button` has no value, only a press event. It announces a
    // command topic without a state topic and consumes the press as one edge.
    globalScope.NodeInitGenerators.hassButton = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('button', context);
        if (!guard.entityId) {
            return { init: { block: guard.statement, priority: 5, execute: '_mqtt.start()' } };
        }
        const config = configLiteral(
            [
                ['icon', textValue(context, 'icon')],
                ['payload_press', textValue(context, 'payloadPress', 'PRESS') || 'PRESS'],
            ],
            context
        );
        const block = registerEntityStatement('button', guard.entityId, config, context, {
            reportState: false,
        });
        return { init: { block, priority: 5, execute: '_mqtt.start()' } };
    };

    globalScope.NodeCodeGenerators.hassButton = function (context) {
        ensureHassImport(context);
        const guard = entityGuard('button', context);
        if (!guard.entityId) {
            return { statement: guard.statement, outputs: [] };
        }
        const pressedVar = isOutputConnected(context, 0) ? outputName(context, 0) : null;
        if (!pressedVar) {
            return { statement: '# hass button: pressed output is not connected', outputs: [] };
        }
        return {
            statement:
                pressedVar +
                " = _hass.take_command('button', " +
                formatLiteral(guard.entityId, context) +
                ", value_type='string', key=" +
                formatLiteral(commandKey(context), context) +
                ')',
            outputs: [pressedVar],
        };
    };
})();
