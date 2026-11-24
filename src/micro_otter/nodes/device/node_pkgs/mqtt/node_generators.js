// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// MQTT node generators: central init_mqtt contributions + read/write loop statements.

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

    function ensureMqttImport(context) {
        registerImport(context, 'import otter_mqtt.runtime as _mqtt');
    }

    function ensureVarsImport(context) {
        registerImport(context, 'import otter_vars.store as _store');
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

    function nodeId(context) {
        return String((context && context.node && context.node.id) ?? 'node').replace(
            /[^A-Za-z0-9_]/g,
            '_'
        );
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function topicLiteral(context) {
        return formatLiteral(effectiveTopic(context), context);
    }

    const TOPIC_NEW_SENTINEL = '__new__';

    // The `graphTopics` dropdown stores the sentinel while the user types a new topic
    // into the sibling text control: resolve it in exactly one place.
    function effectiveTopicFor(controlId, customControlId, context) {
        const controls = controlValues(context);
        const raw = String(controls[controlId] ?? '').trim();
        if (raw === TOPIC_NEW_SENTINEL) {
            return String(controls[customControlId] ?? '').trim();
        }
        return raw;
    }

    function effectiveTopic(context) {
        return effectiveTopicFor('topic', 'customTopic', context);
    }

    function topicLiteralFor(controlId, customControlId, context) {
        return formatLiteral(effectiveTopicFor(controlId, customControlId, context), context);
    }

    function hasTopic(controlId, customControlId, context) {
        return effectiveTopicFor(controlId, customControlId, context) !== '';
    }

    function qosLiteral(context) {
        const qos = controlValues(context).qos;
        return formatLiteral(qos === undefined || qos === null ? 0 : qos, context);
    }

    function retainLiteral(context) {
        const retain = controlValues(context).retain;
        // Absent means "graph saved before the default changed": keep the new
        // default, otherwise stored graphs would silently publish unretained.
        return formatLiteral(
            retain === undefined || retain === null ? true : Boolean(retain),
            context
        );
    }

    globalScope.NodeInitGenerators.mqttRead = function (context) {
        ensureMqttImport(context);
        const block = `_mqtt.register_subscription(topic=${topicLiteral(context)}, qos=${qosLiteral(context)})`;
        return { init: { block, priority: 10, execute: '_mqtt.start()' } };
    };

    globalScope.NodeInitGenerators.mqttWrite = function (context) {
        ensureMqttImport(context);
        const block = `_mqtt.register_publish(topic=${topicLiteral(context)}, qos=${qosLiteral(context)})`;
        return { init: { block, priority: 10, execute: '_mqtt.start()' } };
    };

    globalScope.NodeCodeGenerators.mqttRead = function (context) {
        ensureMqttImport(context);
        const controls = controlValues(context);
        const valueType = controls.valueType || 'string';
        const jsonKey = controls.jsonKey || '';
        const requireConnected = Boolean(controls.defaultWhenDisconnected);
        const outputs = Array.isArray(context.outputs) ? context.outputs : [];
        const meta = Array.isArray(context.outputsMeta) ? context.outputsMeta : [];
        if (!meta.some((entry) => entry && entry.connected)) {
            return { statement: '# mqtt read outputs not connected', outputs: [] };
        }

        const inputs = Array.isArray(context.inputs) ? context.inputs : [];
        const defaultExpr = inputs[0] ?? 'None';
        const consumerKey = formatLiteral(`_mqtt_read_${nodeId(context)}`, context);
        const args =
            `topic=${topicLiteral(context)}, value_type=${formatLiteral(valueType, context)}, ` +
            `json_key=${formatLiteral(jsonKey, context)}, ` +
            `require_connected=${formatLiteral(requireConnected, context)}`;
        const mode = controls.payloadMode || 'value';
        if (mode === 'json-store') {
            const namespace = String(controls.storeNamespace || '').trim();
            const tempVar = `_mqtt_json_${nodeId(context)}`;
            const lines = [];
            if (outputs[0]) {
                lines.push(`${outputs[0]} = _mqtt.latest_value(${args}, default=(${defaultExpr}))`);
            }
            if (outputs[1]) {
                lines.push(`${outputs[1]} = _mqtt.take_updated(${args}, key=${consumerKey})`);
                if (namespace) {
                    ensureVarsImport(context);
                    lines.push(`if ${outputs[1]}:`);
                    lines.push(
                        `    ${tempVar} = _mqtt.json_value(_mqtt.latest(${topicLiteral(context)}))`
                    );
                    lines.push(`    if isinstance(${tempVar}, dict):`);
                    lines.push(
                        `        _store.replace(${formatLiteral(namespace, context)}, ${tempVar})`
                    );
                } else {
                    lines.push('# mqtt read: payload mode json-store without a store namespace');
                }
            }
            return { statement: lines.join('\n'), outputs: outputs.slice() };
        }

        const lines = [];
        if (outputs[0]) {
            lines.push(`${outputs[0]} = _mqtt.latest_value(${args}, default=(${defaultExpr}))`);
        }
        if (outputs[1]) {
            lines.push(`${outputs[1]} = _mqtt.take_updated(${args}, key=${consumerKey})`);
        }
        return { statement: lines.join('\n'), outputs: outputs.slice() };
    };

    globalScope.NodeCodeGenerators.mqttStatus = function (context) {
        ensureMqttImport(context);
        const outputs = Array.isArray(context.outputs) ? context.outputs : [];
        const meta = Array.isArray(context.outputsMeta) ? context.outputsMeta : [];
        if (!outputs[0] || !meta.some((entry) => entry && entry.connected)) {
            return { statement: '# mqtt status output not connected', outputs: [] };
        }
        return {
            statement: `${outputs[0]} = _mqtt.is_connected()`,
            outputs: outputs.slice(),
        };
    };

    globalScope.NodeCodeGenerators.mqttWrite = function (context) {
        ensureMqttImport(context);
        const controls = controlValues(context);
        const publishMode = controls.publishMode || 'on-change';
        const inputs = Array.isArray(context.inputs) ? context.inputs : [];
        const mode = controls.payloadMode || 'value';
        let valueExpr = inputs[1] ?? 'None';
        if (mode === 'json-store') {
            const namespace = String(controls.storeNamespace || '').trim();
            if (!namespace) {
                return {
                    statement: '# mqtt write: payload mode json-store without a store namespace',
                    outputs: [],
                };
            }
            ensureVarsImport(context);
            valueExpr = `_mqtt.json_payload(_store.items(${formatLiteral(namespace, context)}))`;
        }
        const ifChanged =
            publishMode === 'on-change'
                ? formatLiteral(`_mqtt_last_${nodeId(context)}`, context)
                : 'None';
        const enabled = inputRef(context, 0, 'True');
        const publishStatement =
            `_mqtt.publish(topic=${topicLiteral(context)}, value=(${valueExpr}), ` +
            `qos=${qosLiteral(context)}, retain=${retainLiteral(context)}, ` +
            `if_changed=${ifChanged})`;
        return {
            statement: `if bool(${enabled}):\n    ${publishStatement}`,
            outputs: [],
        };
    };

    globalScope.NodeInitGenerators.mqttWill = function (context) {
        ensureMqttImport(context);
        const controls = controlValues(context);
        const payload = String(controls.willPayload ?? 'offline');
        const qos = controls.willQos;
        const block =
            `_mqtt.configure_will(topic=${topicLiteralFor('willTopic', 'customWillTopic', context)}, ` +
            `payload=${formatLiteral(payload, context)}, ` +
            `retain=${formatLiteral(controls.willRetain !== false, context)}, ` +
            `qos=${formatLiteral(qos === undefined || qos === null ? 0 : qos, context)})`;
        return { init: { block, priority: 10, execute: '_mqtt.start()' } };
    };

    // The transpiler requires a loop implementation for every node, but the will is
    // configured once in init_mqtt(): a comment keeps the generated loop readable.
    globalScope.NodeCodeGenerators.mqttWill = function () {
        return { statement: '# mqtt will: configured in init_mqtt', outputs: [] };
    };

    globalScope.NodeInitGenerators.mqttAnnounce = function (context) {
        ensureMqttImport(context);
        const blocks = [
            `_mqtt.register_publish(topic=${topicLiteralFor('announceTopic', 'customAnnounceTopic', context)}, qos=${qosLiteral(context)})`,
        ];
        if (hasTopic('triggerTopic', 'customTriggerTopic', context)) {
            blocks.push(
                `_mqtt.register_subscription(topic=${topicLiteralFor('triggerTopic', 'customTriggerTopic', context)}, qos=0)`
            );
        }
        return { init: { block: blocks.join('\n'), priority: 10, execute: '_mqtt.start()' } };
    };

    globalScope.NodeCodeGenerators.mqttAnnounce = function (context) {
        ensureMqttImport(context);
        const controls = controlValues(context);
        const id = nodeId(context);
        const mode = controls.payloadMode || 'value';
        const namespace = String(controls.storeNamespace || '').trim();
        const topic = topicLiteralFor('announceTopic', 'customAnnounceTopic', context);
        const trigger = hasTopic('triggerTopic', 'customTriggerTopic', context)
            ? topicLiteralFor('triggerTopic', 'customTriggerTopic', context)
            : null;
        const inputs = Array.isArray(context.inputs) ? context.inputs : [];
        const inputsMeta = Array.isArray(context.inputsMeta) ? context.inputsMeta : [];
        const inputConnected = Boolean(inputsMeta[1] && inputsMeta[1].connected);
        let valueExpr;

        if (mode === 'json-store') {
            if (!namespace) {
                return {
                    statement:
                        '# mqtt announce: payload mode json-store without a store namespace',
                    outputs: [],
                };
            }
            ensureVarsImport(context);
            valueExpr = `_mqtt.json_payload(_store.items(${formatLiteral(namespace, context)}))`;
        } else if (inputConnected && inputs[1]) {
            // An unconnected input still carries a default literal, so the connection
            // flag — not the reference — decides between input and control.
            valueExpr = inputs[1];
        } else {
            valueExpr = formatLiteral(String(controls.payload ?? ''), context);
        }

        const fired = `_mqtt_ann_trig_${id}`;
        const lastKey = `_mqtt_announce_last_${id}`;
        const everyLoop = controls.publishMode === 'every-loop';
        const expected = String(controls.triggerValue ?? '').trim();
        const lines = [];

        if (trigger) {
            lines.push(
                `${fired} = _mqtt.take_updated(topic=${trigger}, value_type='string', ` +
                    `key=${formatLiteral(`_mqtt_announce_trig_${id}`, context)})`
            );
            if (expected) {
                lines.push(`if ${fired}:`);
                lines.push(
                    `    ${fired} = _mqtt.latest_value(topic=${trigger}, value_type='string') == ` +
                        `${formatLiteral(expected, context)}`
                );
            }
        }

        let ifChangedExpr;
        if (everyLoop) {
            ifChangedExpr = 'None';
        } else if (trigger) {
            ifChangedExpr = `(None if ${fired} else ${formatLiteral(lastKey, context)})`;
        } else {
            ifChangedExpr = formatLiteral(lastKey, context);
        }

        lines.push(
            `_mqtt.publish_deferred(topic=${topic}, payload=(${valueExpr}), ` +
                `qos=${qosLiteral(context)}, retain=${retainLiteral(context)}, ` +
                `key=${formatLiteral(`_mqtt_announce_${id}`, context)}, ` +
                `if_changed=${ifChangedExpr})`
        );
        // A disabled announce node is fully inert: trigger consumption belongs to the
        // publish effect, so a trigger held while off may fire once when re-enabled.
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    ${lines.join('\n    ')}`,
            outputs: [],
        };
    };
})();

