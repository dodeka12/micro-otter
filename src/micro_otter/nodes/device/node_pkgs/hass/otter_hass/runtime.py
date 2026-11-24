# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Home Assistant MQTT discovery on top of ``otter_mqtt.runtime``.

The module owns the Home Assistant wire contract and nothing else: discovery topics and
payloads, availability, the birth re-announce, state publication and command intake. The
MQTT transport (connect, will, retained replay, JSON) lives in ``otter_mqtt.runtime``.
"""

try:
    from otter_mqtt import runtime as _mqtt
except ImportError:  # pragma: no cover - host/dev fallback
    _mqtt = None

try:
    import utime as _time
except ImportError:  # pragma: no cover - host fallback
    try:
        import time as _time
    except ImportError:
        _time = None

_LOG_SOURCE = 'hass'

DEFAULT_DISCOVERY_PREFIX = 'homeassistant'
DEFAULT_TOPIC_PREFIX = 'otter'

# Settings file the MQTT transport reads; the warnings name it so the fix is obvious.
DEFAULT_MQTT_SETTINGS_FILE = '/mqtt_settings.json'

# Components whose discovery config needs a command topic (HA publishes to it).
WRITABLE_COMPONENTS = ('number', 'switch', 'select', 'text', 'button')

# Home Assistant combines several availability topics with one of these modes.
AVAILABILITY_MODES = ('all', 'any', 'latest')

# Payloads Home Assistant compares the availability topics against.
PAYLOAD_AVAILABLE = 'online'
PAYLOAD_NOT_AVAILABLE = 'offline'


def _log(level, message):
    """Emit one ``[level] hass: message`` line the web console can filter.

    ``level`` must be a canonical device log prefix (see
    docs/dev/device-communication/log-prefix-conventions.md); anything else would
    be shown under ``raw``.
    """
    print('[{}] {}: {}'.format(level, _LOG_SOURCE, message))


def _info(message):
    """Normal progress of the Home Assistant bridge."""
    _log('info', message)


def _success(message):
    """The bridge re-attached to the broker and re-announced its entities."""
    _log('success', message)


def _error(message):
    """A bridge operation failed."""
    _log('error', message)


def _warning(message):
    """The bridge works, but what it asked for cannot reach the broker as configured."""
    _log('warning', message)


def _sanitize_id(value):
    """Reduce an id to the characters that are safe in a topic segment and a unique_id."""
    text = str(value if value is not None else '').strip()
    result = []
    for char in text:
        # MicroPython's str has no isalnum(): isalpha()/isdigit() cover the same ground.
        if char.isalpha() or char.isdigit() or char in ('_', '-'):
            result.append(char)
        else:
            result.append('_')
    return ''.join(result).strip('_')


def _trim_prefix(value, fallback):
    """Normalise a topic prefix (no leading/trailing slashes, never empty)."""
    text = str(value if value is not None else '').strip().strip('/')
    return text or fallback


def _availability_mode(value):
    """Clamp the combination mode to a value Home Assistant understands."""
    text = str(value if value is not None else '').strip()
    return text if text in AVAILABILITY_MODES else 'all'


def _availability_entry(topic):
    """One ``availability`` list entry Home Assistant compares a payload against."""
    return {
        'topic': topic,
        'payload_available': PAYLOAD_AVAILABLE,
        'payload_not_available': PAYLOAD_NOT_AVAILABLE,
    }


def _ticks_ms():
    """Millisecond clock: MicroPython ticks, host wall clock, or 0 when absent."""
    if _time is None:
        return 0
    ticks_ms = getattr(_time, 'ticks_ms', None)
    if ticks_ms is not None:
        return ticks_ms()
    try:
        return int(_time.time() * 1000)
    except Exception:
        return 0


def _ticks_diff(new, old):
    """Wraparound-safe tick difference (MicroPython) or plain subtraction."""
    if _time is not None:
        ticks_diff = getattr(_time, 'ticks_diff', None)
        if ticks_diff is not None:
            return ticks_diff(new, old)
    return new - old


def _availability_summary(config):
    """Render the availability contract of one entity as a single log fragment.

    Mirrors the two forms Home Assistant accepts: the ``availability`` list (device entry
    plus named flags, combined by ``availability_mode``) and the scalar topic pair.
    """
    entries = config.get('availability')
    if isinstance(entries, (list, tuple)) and entries:
        topics = []
        for entry in entries:
            if isinstance(entry, dict):
                topics.append("'" + str(entry.get('topic', '')) + "'")
        return 'availability={} mode={}'.format(
            ', '.join(topics), _availability_mode(config.get('availability_mode'))
        )
    topic = config.get('availability_topic')
    if topic:
        return "availability='{}'".format(topic)
    return 'availability=none'


def _mqtt_settings_file():
    """Settings file the MQTT transport reads, named as its own log lines name it.

    Returns:
        The path shown in the disabled-MQTT warnings, e.g. ``/mqtt_settings.json``.
    """
    return getattr(_mqtt, 'MQTT_SETTINGS_FILE', DEFAULT_MQTT_SETTINGS_FILE)


def _mqtt_runtime_of(mqtt):
    """Resolve the object that carries the MQTT settings state for this bridge.

    ``otter_hass`` talks to ``otter_mqtt.runtime`` through its module functions, so the
    settings live on the singleton that module's ``ensure_runtime()`` returns. A caller
    that injected an object (host tests, a future asset) is used as it is.

    Args:
        mqtt: The MQTT module or a stand-in for it.

    Returns:
        The runtime object, or None when none can be resolved.
    """
    ensure = getattr(mqtt, 'ensure_runtime', None)
    if ensure is None:
        return mqtt
    try:
        return ensure()
    except Exception:
        return None


def _mqtt_is_disabled(mqtt):
    """Whether the MQTT transport is switched off in ``/mqtt_settings.json``.

    ``MqttRuntime.enabled`` is a bool property. A stand-in without that attribute (host
    tests, an older asset) counts as enabled, so the warnings below can only fire when
    the settings really say ``enabled=false``.

    Args:
        mqtt: The MQTT module or a stand-in for it.

    Returns:
        True only for an explicit ``enabled == False``.
    """
    runtime = _mqtt_runtime_of(mqtt)
    if runtime is None:
        return False
    return getattr(runtime, 'enabled', None) is False


class HassRuntime:
    """Device-scoped Home Assistant discovery runtime."""

    def __init__(self, mqtt=None):
        self._mqtt = mqtt if mqtt is not None else _mqtt
        self._device_id = ''
        self._device_name = ''
        self._discovery_prefix = DEFAULT_DISCOVERY_PREFIX
        self._topic_prefix = DEFAULT_TOPIC_PREFIX
        self._device = {}
        self._origin = {}
        self._availability = True
        self._entities = {}
        self._topic_cache = {}
        self._state_marks = {}
        self._connect_count = 0
        self._configure_calls = 0
        self._disabled_reports = set()  # topics already reported as unreachable
        self._no_state_reports = set()  # entities already reported as state-less

    @property
    def device_id(self):
        return self._device_id

    @property
    def configured(self):
        return bool(self._device_id)

    @property
    def entity_count(self):
        return len(self._entities)

    @property
    def connect_count(self):
        return self._connect_count

    def _require_mqtt(self, caller):
        if self._mqtt is None:
            raise RuntimeError('hass: ' + caller + ' needs otter_mqtt.runtime')
        return self._mqtt

    def _require_configured(self, caller):
        if not self._device_id:
            raise RuntimeError('hass: configure() must run before ' + caller)
        return self._mqtt

    def _report_mqtt_disabled(self, key, message):
        """Warn once per key about topics that cannot leave the device.

        ``otter_mqtt`` keeps accepting publishes and subscriptions while ``enabled`` is
        false: it stores them and never connects. A graph built from Home Assistant
        nodes therefore looks healthy in the log while the broker sees nothing at all,
        so the first publish and the first subscription of an entity say what they
        could not do. Called by `register_entity()` and `publish_state()` only.

        Args:
            key: De-duplication key, e.g. ``('state', 'binary_sensor', 'my_sensor_1')``.
            message: Warning text, printed at most once per key.

        Returns:
            True when the transport is switched off, whether or not the line was new.
        """
        if not _mqtt_is_disabled(self._mqtt):
            return False
        if key not in self._disabled_reports:
            self._disabled_reports.add(key)
            _warning(message)
        return True

    def _report_state_less(self, component_id, entity_id):
        """Warn once per entity that a state-less entity has nowhere to publish to.

        A graph written for an older package version still calls ``publish_state()``
        for an entity whose ``Report State`` is off. The call is a no-op by design, so
        the first one explains why the state never changes in Home Assistant.

        Args:
            component_id: Sanitised Home Assistant component (``number``, ``button``, …).
            entity_id: Sanitised object id of the entity.
        """
        key = (component_id, entity_id)
        if key in self._no_state_reports:
            return
        self._no_state_reports.add(key)
        _warning(
            'state: {}.{} has no state topic (report_state=False)'.format(
                component_id, entity_id
            )
        )

    def configure(self, device_id, device_name=None, discovery_prefix=DEFAULT_DISCOVERY_PREFIX,
                  topic_prefix=DEFAULT_TOPIC_PREFIX, availability=True,
                  manufacturer='Micro-Otter', model=None, sw_version=None, will=True):
        """Configure the device card, availability and birth handling."""
        mqtt = self._require_mqtt('configure()')
        sanitized = _sanitize_id(device_id)
        if not sanitized:
            raise ValueError('hass: configure() needs a device_id')

        self._configure_calls += 1
        if self._configure_calls > 1:
            _info(
                "configure() called again; the last hass-bridge wins (device='{}')".format(sanitized)
            )

        self._device_id = sanitized
        self._device_name = str(device_name or sanitized)
        self._discovery_prefix = _trim_prefix(discovery_prefix, DEFAULT_DISCOVERY_PREFIX)
        self._topic_prefix = _trim_prefix(topic_prefix, DEFAULT_TOPIC_PREFIX)
        self._availability = bool(availability)
        self._topic_cache = {}

        device = {'identifiers': [sanitized], 'name': self._device_name}
        if manufacturer:
            device['manufacturer'] = str(manufacturer)
        if model:
            device['model'] = str(model)
        if sw_version:
            device['sw_version'] = str(sw_version)
        self._device = device

        origin = {'name': 'Micro-Otter'}
        if sw_version:
            origin['sw'] = str(sw_version)
        self._origin = origin

        mqtt.on_connect(self._on_connect)

        if self._availability:
            if will:
                mqtt.configure_will(
                    self.availability_topic(), PAYLOAD_NOT_AVAILABLE, retain=True, qos=0
                )
            else:
                mqtt.clear_will()
            mqtt.publish_deferred(
                self.availability_topic(), PAYLOAD_AVAILABLE, qos=0, retain=True,
                key='_hass_availability',
            )

        mqtt.register_subscription(self.birth_topic(), qos=0)
        register_message = getattr(mqtt, 'on_message', None)
        if register_message is not None:
            # Older otter_mqtt assets have no message hooks: poll_birth() stays the fallback.
            register_message(self._on_message)
        _info(
            "configure: device='{}' name='{}' discovery='{}' topic='{}' availability={}".format(
                sanitized, self._device_name, self._discovery_prefix, self._topic_prefix,
                self._availability,
            )
        )
        return dict(device)

    def _on_connect(self):
        """Connect hook: diagnostics only, the retained payloads replay themselves."""
        self._connect_count += 1
        _success('connected: entities={}'.format(len(self._entities)))

    def _base_topic(self):
        return '{}/{}'.format(self._topic_prefix, self._device_id)

    def state_topic(self, component, object_id):
        """Topic this entity publishes its state to."""
        self._require_mqtt('state_topic()')
        if not self._device_id:
            raise RuntimeError('hass: configure() must run before state_topic()')
        cache_key = ('state', component, object_id)
        cached = self._topic_cache.get(cache_key)
        if cached is None:
            cached = '{}/{}/{}/state'.format(
                self._base_topic(), _sanitize_id(component), _sanitize_id(object_id)
            )
            self._topic_cache[cache_key] = cached
        return cached

    def command_topic(self, component, object_id):
        """Topic Home Assistant publishes commands to."""
        self._require_mqtt('command_topic()')
        if not self._device_id:
            raise RuntimeError('hass: configure() must run before command_topic()')
        cache_key = ('command', component, object_id)
        cached = self._topic_cache.get(cache_key)
        if cached is None:
            cached = '{}/{}/{}/set'.format(
                self._base_topic(), _sanitize_id(component), _sanitize_id(object_id)
            )
            self._topic_cache[cache_key] = cached
        return cached

    def availability_topic(self, flag_id=None):
        """Retained ``online``/``offline`` topic of this device or of one named flag."""
        self._require_mqtt('availability_topic()')
        if not self._device_id:
            raise RuntimeError('hass: configure() must run before availability_topic()')
        base = '{}/availability'.format(self._base_topic())
        flag = _sanitize_id(flag_id) if flag_id is not None else ''
        return '{}/{}'.format(base, flag) if flag else base

    def birth_topic(self):
        """Home Assistant status topic (``<prefix>/status``)."""
        return '{}/status'.format(self._discovery_prefix)

    def config_topic(self, component, object_id):
        """Discovery config topic of one entity."""
        return '{}/{}/{}/{}/config'.format(
            self._discovery_prefix,
            _sanitize_id(component),
            self._device_id,
            _sanitize_id(object_id),
        )

    def register_entity(self, component, object_id, config=None, name=None,
                        state_topic=None, command_topic=None, availability=True,
                        expire_after=None, availability_flags=None,
                        availability_mode='all', report_state=True):
        """Build, store and announce the discovery config of one entity.

        Also subscribes the command topic of a writable component. While MQTT is
        switched off, the publish and the subscription are only queued; the first
        registration of an entity reports that as a warning.

        ``report_state=False`` announces a state-less entity: the discovery config
        carries no ``state_topic`` and Home Assistant keeps the value the user picked
        (the "optimistic" shape a ``button`` needs and a write-only control wants).
        Only a component with a command topic can be announced that way — a
        ``sensor`` without a state topic would have neither direction, so it logs an
        error and keeps its state topic.
        """
        mqtt = self._require_configured('register_entity()')
        component_id = _sanitize_id(component)
        entity_id = _sanitize_id(object_id)
        if not component_id or not entity_id:
            raise ValueError('hass: register_entity() needs a component and an object_id')

        report_state = bool(report_state)
        if not report_state and component_id not in WRITABLE_COMPONENTS:
            _error(
                "entity: {}.{} cannot omit the state topic: component '{}' has no command "
                'topic either, so the entity would have neither direction '
                '(report_state=True used instead)'.format(
                    component_id, entity_id, component_id
                )
            )
            report_state = True

        full = dict(config or {})
        display_name = str(name).strip() if name is not None else ''
        if 'name' not in full:
            full['name'] = display_name or entity_id
        if 'unique_id' not in full:
            full['unique_id'] = '{}_{}_{}'.format(self._device_id, component_id, entity_id)

        resolved_state_topic = None
        if report_state:
            resolved_state_topic = str(state_topic or self.state_topic(component_id, entity_id))
            full['state_topic'] = resolved_state_topic
        else:
            # A caller config may carry a state topic; a state-less entity must not.
            full.pop('state_topic', None)

        writable = component_id in WRITABLE_COMPONENTS
        if writable and 'command_topic' not in full:
            full['command_topic'] = str(
                command_topic or self.command_topic(component_id, entity_id)
            )

        flag_ids = [flag for flag in (availability_flags or []) if _sanitize_id(flag)]
        if flag_ids:
            # Home Assistant forbids the scalar topic and the list at the same time, so
            # the list form drops it and carries every topic it needs explicitly.
            entries = []
            if availability and self._availability:
                entries.append(_availability_entry(self.availability_topic()))
            for flag_id in flag_ids:
                entries.append(_availability_entry(self.availability_topic(flag_id)))
            full['availability'] = entries
            full['availability_mode'] = _availability_mode(availability_mode)
        elif availability and self._availability:
            full.setdefault('availability_topic', self.availability_topic())
            full.setdefault('payload_available', PAYLOAD_AVAILABLE)
            full.setdefault('payload_not_available', PAYLOAD_NOT_AVAILABLE)

        if expire_after is not None:
            try:
                expire_value = int(expire_after)
            except (TypeError, ValueError):
                expire_value = 0
            if expire_value > 0:
                full.setdefault('expire_after', expire_value)

        full.setdefault('device', dict(self._device))
        full.setdefault('origin', dict(self._origin))

        if resolved_state_topic:
            mqtt.register_publish(resolved_state_topic, qos=0)
        if full.get('command_topic'):
            mqtt.register_subscription(full['command_topic'], qos=0)

        state_fragment = (
            "state='{}'".format(resolved_state_topic) if resolved_state_topic else 'state=none'
        )
        command_fragment = (
            " command='{}'".format(full['command_topic']) if full.get('command_topic') else ''
        )
        self._report_mqtt_disabled(
            ('entity', component_id, entity_id),
            "entity: {}.{} publish{} with MQTT disabled (enabled=false in {}), "
            "so every topic stays on the device: {}{}".format(
                component_id,
                entity_id,
                ' and subscribe' if full.get('command_topic') else '',
                _mqtt_settings_file(),
                state_fragment,
                command_fragment,
            ),
        )

        key = (component_id, entity_id)
        self._entities[key] = full
        self._publish_config(component_id, entity_id, full)
        expire = self._expire_after_of(key)
        _info(
            "entity: {}.{} {}{} expire={} {}".format(
                component_id,
                entity_id,
                state_fragment,
                command_fragment,
                '{}s'.format(expire) if expire > 0 else 'none',
                _availability_summary(full),
            )
        )
        return dict(full)

    def _publish_config(self, component, object_id, config, force=False):
        """Publish one discovery config (retained, replayed on every connect)."""
        mqtt = self._require_mqtt('_publish_config()')
        key = 'hass_config_{}_{}'.format(component, object_id)
        mqtt.publish_deferred(
            self.config_topic(component, object_id),
            mqtt.json_payload(config),
            qos=0,
            retain=True,
            key=key,
            if_changed=None if force else key,
        )

    def announce_all(self, force=True):
        """Re-publish every stored discovery config."""
        for (component, object_id), config in self._entities.items():
            self._publish_config(component, object_id, config, force=force)
        return len(self._entities)

    def poll_birth(self):
        """Re-announce everything when Home Assistant publishes ``online``."""
        mqtt = self._mqtt
        if mqtt is None or not self._device_id:
            return False
        topic = self.birth_topic()
        if not mqtt.take_updated(topic, value_type='string', key='_hass_birth'):
            return False
        if mqtt.latest_value(topic, value_type='string', default='') != 'online':
            return False
        _info('birth: re-announcing {} entities'.format(len(self._entities)))
        self.announce_all()
        return True

    def _on_message(self, topic, payload):
        """Birth hook: re-announce every entity when HA publishes ``online``.

        Consumes the poll_birth() cursor first, so a bridge that also contributes a loop
        statement (code from an older package version) cannot announce twice.
        """
        if str(topic) != self.birth_topic():
            return
        self._mqtt.take_updated(self.birth_topic(), value_type='string', key='_hass_birth')
        if str(payload).strip().lower() != 'online':
            return
        if not self._entities:
            return
        _info('birth: re-announcing {} entities'.format(len(self._entities)))
        self.announce_all()

    def _expire_after_of(self, key):
        """`expire_after` of a registered entity in seconds (0 when it has none)."""
        config = self._entities.get(key)
        if not config:
            return 0
        try:
            return int(config.get('expire_after') or 0)
        except (TypeError, ValueError):
            return 0

    def _state_memo(self, component, object_id, value, memo):
        """De-duplication key for one state publish, or None to repeat the value.

        Home Assistant expires a state ``expire_after`` seconds after the *last message* on
        its state topic. The state published here is retained and de-duplicated, so a value
        that never changes would age out on a perfectly live device; while such an entity is
        registered, its current value is therefore repeated once per half window. Entities
        without ``expire_after`` keep the plain memo and never publish twice.

        A state-less entity (``report_state=False``) never reaches this method:
        ``publish_state()`` returns before the heartbeat, so there is no window to keep
        alive and ``expire_after`` is ignored.
        """
        key = (component, object_id)
        expire = self._expire_after_of(key)
        if expire <= 0:
            return memo
        now = _ticks_ms()
        mark = self._state_marks.get(key)
        if mark is None or mark[1] != value:
            # A real change restarts Home Assistant's expiry timer by itself.
            self._state_marks[key] = (now, value)
            return memo
        if _ticks_diff(now, mark[0]) < (expire * 1000) // 2:
            return memo
        self._state_marks[key] = (now, value)
        return None

    def publish_state(self, component, object_id, value, retain=True, qos=0, if_changed=True):
        """Publish one entity state, retained, de-duplicated per entity.

        `_state_memo()` keeps an entity with `expire_after` alive on Home Assistant; every
        other entity publishes on change only. While MQTT is switched off the first
        publish of an entity is reported as a warning, because the value stays on the
        device.

        Returns:
            False when the entity has no state topic (``report_state=False``), True
            otherwise. The reason is logged once per entity at ``warning`` level.
        """
        mqtt = self._require_mqtt('publish_state()')
        component_id = _sanitize_id(component)
        entity_id = _sanitize_id(object_id)
        config = self._entities.get((component_id, entity_id))
        if config is not None and not config.get('state_topic'):
            self._report_state_less(component_id, entity_id)
            return False
        state_topic = self.state_topic(component_id, entity_id)
        self._report_mqtt_disabled(
            ('state', component_id, entity_id),
            "state: {}.{} publish with MQTT disabled (enabled=false in {}), "
            "topic='{}' is queued only".format(
                component_id, entity_id, _mqtt_settings_file(), state_topic
            ),
        )
        memo = 'hass_state_{}_{}'.format(component_id, entity_id) if if_changed else None
        if memo is not None:
            memo = self._state_memo(component_id, entity_id, value, memo)
        mqtt.publish(
            state_topic,
            value,
            qos=qos,
            retain=retain,
            if_changed=memo,
        )
        return True

    def latest_command(self, component, object_id, value_type='string', default=None,
                       require_connected=False):
        """Current command value for a writable entity (sticky, typed)."""
        mqtt = self._require_mqtt('latest_command()')
        return mqtt.latest_value(
            self.command_topic(component, object_id),
            value_type=value_type,
            default=default,
            require_connected=require_connected,
        )

    def take_command(self, component, object_id, value_type='string', key=None):
        """Consume the pending command of a writable entity, reporting whether it is new."""
        mqtt = self._require_mqtt('take_command()')
        return mqtt.take_updated(
            self.command_topic(component, object_id),
            value_type=value_type,
            key=key or 'hass_cmd_{}_{}'.format(_sanitize_id(component), _sanitize_id(object_id)),
        )

    def entity_count_for(self, component):
        """Number of registered entities of one component."""
        return len([key for key in self._entities if key[0] == component])


_RUNTIME = None


def ensure_runtime():
    global _RUNTIME
    if _RUNTIME is None:
        _RUNTIME = HassRuntime()
    return _RUNTIME


def configure(device_id, device_name=None, discovery_prefix=DEFAULT_DISCOVERY_PREFIX,
              topic_prefix=DEFAULT_TOPIC_PREFIX, availability=True,
              manufacturer='Micro-Otter', model=None, sw_version=None, will=True):
    return ensure_runtime().configure(
        device_id,
        device_name=device_name,
        discovery_prefix=discovery_prefix,
        topic_prefix=topic_prefix,
        availability=availability,
        manufacturer=manufacturer,
        model=model,
        sw_version=sw_version,
        will=will,
    )


def register_entity(component, object_id, config=None, name=None, state_topic=None,
                    command_topic=None, availability=True, expire_after=None,
                    availability_flags=None, availability_mode='all', report_state=True):
    return ensure_runtime().register_entity(
        component,
        object_id,
        config=config,
        name=name,
        state_topic=state_topic,
        command_topic=command_topic,
        availability=availability,
        expire_after=expire_after,
        availability_flags=availability_flags,
        availability_mode=availability_mode,
        report_state=report_state,
    )


def announce_all(force=True):
    return ensure_runtime().announce_all(force=force)


def poll_birth():
    return ensure_runtime().poll_birth()


def publish_state(component, object_id, value, retain=True, qos=0, if_changed=True):
    return ensure_runtime().publish_state(
        component, object_id, value, retain=retain, qos=qos, if_changed=if_changed
    )


def latest_command(component, object_id, value_type='string', default=None,
                   require_connected=False):
    return ensure_runtime().latest_command(
        component, object_id, value_type=value_type, default=default,
        require_connected=require_connected,
    )


def take_command(component, object_id, value_type='string', key=None):
    return ensure_runtime().take_command(component, object_id, value_type=value_type, key=key)


def state_topic(component, object_id):
    return ensure_runtime().state_topic(component, object_id)


def command_topic(component, object_id):
    return ensure_runtime().command_topic(component, object_id)


def availability_topic(flag_id=None):
    return ensure_runtime().availability_topic(flag_id)
