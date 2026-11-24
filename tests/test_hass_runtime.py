import json
import pathlib
import sys

import pytest

PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs').resolve()


@pytest.fixture(scope='module')
def hass():
    sys.path.insert(0, str(PKG_ROOT / 'mqtt'))
    sys.path.insert(0, str(PKG_ROOT / 'hass'))
    import otter_hass.runtime as rt

    yield rt
    sys.path.remove(str(PKG_ROOT / 'hass'))
    sys.path.remove(str(PKG_ROOT / 'mqtt'))


class FakeMqtt:
    """Minimal stand-in for otter_mqtt.runtime recording every call."""

    def __init__(self):
        self.wills = []
        self.cleared_wills = 0
        self.deferred = []
        self.published = []
        self.subscriptions = []
        self.publish_topics = []
        self.hooks = []
        self.message_hooks = []
        self.messages = {}
        # Consumed markers are per consumer key, mirroring `MqttRuntime._consumed`, so the
        # fake can express "two keys, one message".
        self.consumed = set()

    def configure_will(self, topic, payload, retain=True, qos=0):
        self.wills.append((topic, payload, retain, qos))

    def clear_will(self):
        self.cleared_wills += 1

    def publish_deferred(self, topic, payload, qos=0, retain=True, key=None, if_changed=None):
        self.deferred.append(
            {'topic': topic, 'payload': payload, 'qos': qos, 'retain': retain,
             'key': key, 'if_changed': if_changed}
        )

    def publish(self, topic, value, qos=0, retain=False, if_changed=None):
        self.published.append(
            {'topic': topic, 'value': value, 'qos': qos, 'retain': retain,
             'if_changed': if_changed}
        )

    def register_subscription(self, topic, qos=0):
        self.subscriptions.append((topic, qos))

    def register_publish(self, topic, qos=0):
        self.publish_topics.append((topic, qos))

    def on_connect(self, callback):
        if callback not in self.hooks:
            self.hooks.append(callback)

    def on_message(self, callback):
        if callback not in self.message_hooks:
            self.message_hooks.append(callback)

    def feed_hook(self, topic, payload):
        for callback in list(self.message_hooks):
            callback(topic, payload)

    def json_payload(self, value):
        return json.dumps(value, separators=(',', ':')).encode('utf-8')

    def take_updated(self, topic, value_type='string', json_key='', key=None,
                     require_connected=False):
        if not self.messages.get(topic):
            return False
        # Mirrors `MqttRuntime._consumed[consumer]`: the consumer is the caller's key, or
        # the topic when no key is given. A new message on the topic resets the markers.
        marker = (topic, key or topic)
        if marker in self.consumed:
            return False
        self.consumed.add(marker)
        return True

    def latest_value(self, topic, value_type='string', json_key='', default=None,
                     require_connected=False):
        entry = self.messages.get(topic)
        if not entry:
            return default
        return entry['payload']

    def feed(self, topic, payload):
        self.messages[topic] = {'payload': payload}
        self.consumed = {marker for marker in self.consumed if marker[0] != topic}


class DisabledMqtt(FakeMqtt):
    """``FakeMqtt`` whose settings say ``enabled=false``, i.e. MQTT is switched off."""

    def __init__(self):
        super().__init__()
        self.enabled = False


def make_runtime(hass):
    mqtt = FakeMqtt()
    return hass.HassRuntime(mqtt), mqtt


def configs(mqtt):
    return [json.loads(entry['payload'].decode('utf-8')) for entry in mqtt.deferred
            if entry['topic'].endswith('/config')]


class FakeClock:
    """Millisecond clock the tests advance by hand."""

    def __init__(self):
        self.now = 0

    def ticks_ms(self):
        return self.now

    def advance(self, seconds):
        self.now += int(round(seconds * 1000))


@pytest.fixture
def clock(hass, monkeypatch):
    """Freeze the runtime on a clock only the test moves."""
    fake = FakeClock()
    monkeypatch.setattr(hass, '_ticks_ms', fake.ticks_ms)
    monkeypatch.setattr(hass, '_ticks_diff', lambda new, old: new - old)
    return fake


def test_requires_configure_before_any_topic(hass):
    runtime, _mqtt = make_runtime(hass)

    with pytest.raises(RuntimeError, match='configure\\(\\) must run before'):
        runtime.state_topic('sensor', 'temp')
    with pytest.raises(RuntimeError, match='configure\\(\\) must run before'):
        runtime.register_entity('sensor', 'temp')


def test_configure_rejects_an_empty_device_id(hass):
    runtime, _mqtt = make_runtime(hass)

    with pytest.raises(ValueError, match='needs a device_id'):
        runtime.configure('   ')


def test_configure_builds_device_and_topics(hass):
    runtime, mqtt = make_runtime(hass)
    device = runtime.configure('otter a1b2', device_name='Kitchen', model='X1',
                               sw_version='1.2.3')

    assert device['identifiers'] == ['otter_a1b2']
    assert device['name'] == 'Kitchen'
    assert device['manufacturer'] == 'Micro-Otter'
    assert device['model'] == 'X1'
    assert device['sw_version'] == '1.2.3'

    assert runtime.state_topic('sensor', 'temp') == 'otter/otter_a1b2/sensor/temp/state'
    assert runtime.command_topic('number', 'level') == 'otter/otter_a1b2/number/level/set'
    assert runtime.availability_topic() == 'otter/otter_a1b2/availability'
    assert runtime.config_topic('sensor', 'temp') == (
        'homeassistant/sensor/otter_a1b2/temp/config'
    )
    assert runtime.birth_topic() == 'homeassistant/status'
    assert runtime.state_topic('sensor', 'temp') == runtime.state_topic('sensor', 'temp')


def test_configure_sets_will_availability_and_birth_subscription(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    assert mqtt.wills == [('otter/dev1/availability', 'offline', True, 0)]
    assert mqtt.cleared_wills == 0
    assert mqtt.deferred[0]['topic'] == 'otter/dev1/availability'
    assert mqtt.deferred[0]['payload'] == 'online'
    assert mqtt.deferred[0]['retain'] is True
    assert ('homeassistant/status', 0) in mqtt.subscriptions
    assert len(mqtt.hooks) == 1


def test_configure_twice_keeps_one_hook_and_logs(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.configure('dev2', device_name='Second')

    out = capsys.readouterr().out
    assert len(mqtt.hooks) == 1
    assert runtime.device_id == 'dev2'
    assert 'configure() called again' in out
    assert "device='dev2'" in out
    assert '[error] hass:' not in out


def test_single_configure_logs_no_again_line(hass, capsys):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    out = capsys.readouterr().out
    assert 'configure() called again' not in out
    assert 'configure() called twice' not in out


def test_configure_without_availability_or_will(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1', availability=False)

    assert mqtt.wills == []
    assert mqtt.cleared_wills == 0
    assert all(entry['topic'] != 'otter/dev1/availability' for entry in mqtt.deferred)

    mqtt.cleared_wills = 0
    mqtt.wills = []
    runtime.configure('dev1', will=False)
    assert mqtt.wills == []
    assert mqtt.cleared_wills == 1


def test_connect_hook_counts_connections(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    mqtt.hooks[0]()
    mqtt.hooks[0]()

    out = capsys.readouterr().out
    assert runtime.connect_count == 2
    assert out.count('connected: entities=1') == 2


def _config_entries(mqtt):
    return [entry for entry in mqtt.deferred if entry['topic'].endswith('/config')]


def test_configure_registers_one_birth_hook(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    assert len(mqtt.message_hooks) == 1

    runtime.configure('dev2')
    # The bound method is identical (same function, same instance), so on_message
    # de-duplicates it: a second bridge does not register the handler twice.
    assert len(mqtt.message_hooks) == 1


def test_birth_hook_reannounces_once_on_online(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    before = len(_config_entries(mqtt))
    mqtt.feed_hook('homeassistant/status', 'online')
    out = capsys.readouterr().out

    assert out.count('birth: re-announcing 1 entities') == 1
    assert len(_config_entries(mqtt)) > before
    # The hook consumed the poll_birth() cursor: a following poll must not double-announce.
    assert runtime.poll_birth() is False


def test_birth_hook_offline_consumes_cursor_without_publish(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    before = len(_config_entries(mqtt))
    mqtt.feed_hook('homeassistant/status', 'offline')
    out = capsys.readouterr().out

    assert 'birth:' not in out
    assert len(_config_entries(mqtt)) == before
    assert runtime.poll_birth() is False


def test_birth_hook_ignores_other_topics(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    mqtt.feed('homeassistant/status', 'online')
    mqtt.feed_hook('some/other/topic', 'online')

    # The birth cursor is still unconsumed, so poll_birth() can still see it.
    assert runtime.poll_birth() is True


def test_birth_hook_online_without_entities_is_silent(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    before = len(_config_entries(mqtt))
    mqtt.feed_hook('homeassistant/status', 'online')
    out = capsys.readouterr().out

    assert 'birth:' not in out
    assert len(_config_entries(mqtt)) == before


def test_configure_without_on_message_still_polls(hass, monkeypatch):
    monkeypatch.delattr(FakeMqtt, 'on_message')
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    assert mqtt.message_hooks == []
    mqtt.feed('homeassistant/status', 'online')
    assert runtime.poll_birth() is True


def test_register_sensor_builds_the_discovery_config(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1', device_name='Kitchen', sw_version='1.0')

    config = runtime.register_entity(
        'sensor', 'temperature',
        config={'device_class': 'temperature', 'unit_of_measurement': '\u00b0C'},
        name='Temperature', expire_after=300,
    )

    assert config['name'] == 'Temperature'
    assert config['unique_id'] == 'dev1_sensor_temperature'
    assert config['state_topic'] == 'otter/dev1/sensor/temperature/state'
    assert 'command_topic' not in config
    assert config['device']['identifiers'] == ['dev1']
    assert config['origin']['name'] == 'Micro-Otter'
    assert config['origin']['sw'] == '1.0'
    assert config['availability_topic'] == 'otter/dev1/availability'
    assert config['payload_available'] == 'online'
    assert config['payload_not_available'] == 'offline'
    assert config['expire_after'] == 300
    assert config['device_class'] == 'temperature'

    published = [entry for entry in mqtt.deferred if entry['topic'].endswith('/config')]
    assert len(published) == 1
    assert published[0]['topic'] == 'homeassistant/sensor/dev1/temperature/config'
    assert published[0]['retain'] is True
    assert json.loads(published[0]['payload'].decode('utf-8')) == config
    assert ('otter/dev1/sensor/temperature/state', 0) in mqtt.publish_topics
    assert mqtt.subscriptions.count(('homeassistant/status', 0)) == 1


def test_user_config_keys_win(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    config = runtime.register_entity(
        'sensor', 'temperature',
        config={'icon': 'mdi:thermometer', 'unique_id': 'custom-id',
                'unit_of_measurement': '%'},
    )

    assert config['icon'] == 'mdi:thermometer'
    assert config['unique_id'] == 'custom-id'
    assert config['unit_of_measurement'] == '%'
    assert config['name'] == 'temperature'


def test_writable_components_get_a_command_topic(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    number = runtime.register_entity('number', 'level')
    assert number['command_topic'] == 'otter/dev1/number/level/set'
    assert ('otter/dev1/number/level/set', 0) in mqtt.subscriptions

    subscriptions_before = len(mqtt.subscriptions)
    sensor = runtime.register_entity('sensor', 'temp')
    assert 'command_topic' not in sensor
    assert len(mqtt.subscriptions) == subscriptions_before


def test_availability_can_be_disabled(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1', availability=False)

    config = runtime.register_entity('sensor', 'temp')
    assert 'availability_topic' not in config
    assert 'payload_available' not in config
    assert 'payload_not_available' not in config

    per_entity = runtime.register_entity('sensor', 'other', availability=False)
    assert 'availability_topic' not in per_entity


def test_availability_topic_has_a_named_flag_form(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    assert runtime.availability_topic() == 'otter/dev1/availability'
    assert runtime.availability_topic(None) == 'otter/dev1/availability'
    assert runtime.availability_topic('') == 'otter/dev1/availability'
    assert runtime.availability_topic('heating') == 'otter/dev1/availability/heating'
    assert runtime.availability_topic('Heat Pump 1') == (
        'otter/dev1/availability/Heat_Pump_1'
    )


def test_register_entity_with_flags_uses_the_availability_list(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    config = runtime.register_entity(
        'sensor', 'temperature', availability_flags=['heating'], availability_mode='all'
    )

    assert config['availability'] == [
        {'topic': 'otter/dev1/availability',
         'payload_available': 'online', 'payload_not_available': 'offline'},
        {'topic': 'otter/dev1/availability/heating',
         'payload_available': 'online', 'payload_not_available': 'offline'},
    ]
    assert config['availability_mode'] == 'all'
    assert 'availability_topic' not in config
    assert 'payload_available' not in config
    assert 'payload_not_available' not in config


def test_availability_mode_is_forwarded_and_clamped(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    any_mode = runtime.register_entity(
        'sensor', 'a', availability_flags=['heating'], availability_mode='any'
    )
    assert any_mode['availability_mode'] == 'any'

    latest_mode = runtime.register_entity(
        'sensor', 'b', availability_flags=['heating'], availability_mode='latest'
    )
    assert latest_mode['availability_mode'] == 'latest'

    bogus_mode = runtime.register_entity(
        'sensor', 'c', availability_flags=['heating'], availability_mode='whatever'
    )
    assert bogus_mode['availability_mode'] == 'all'


def test_availability_flags_without_the_device_flag(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    per_entity = runtime.register_entity(
        'sensor', 'a', availability=False, availability_flags=['heating']
    )
    assert [entry['topic'] for entry in per_entity['availability']] == [
        'otter/dev1/availability/heating'
    ]

    runtime.configure('dev1', availability=False)
    device_off = runtime.register_entity('sensor', 'b', availability_flags=['heating'])
    assert [entry['topic'] for entry in device_off['availability']] == [
        'otter/dev1/availability/heating'
    ]


def test_availability_flags_drop_empty_ids(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    config = runtime.register_entity(
        'sensor', 'a', availability_flags=['', '   ', None, 'heating']
    )

    assert [entry['topic'] for entry in config['availability']] == [
        'otter/dev1/availability',
        'otter/dev1/availability/heating',
    ]

    only_empty = runtime.register_entity('sensor', 'b', availability_flags=['', '  '])
    assert 'availability' not in only_empty
    assert only_empty['availability_topic'] == 'otter/dev1/availability'


def test_expire_after_is_optional(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    assert 'expire_after' not in runtime.register_entity('sensor', 'a')
    assert runtime.register_entity('sensor', 'b', expire_after=0).get('expire_after') is None
    assert runtime.register_entity('sensor', 'c', expire_after=60)['expire_after'] == 60


def test_expire_after_repeats_an_unchanged_state_each_half_window(hass, clock):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('binary_sensor', 'alarm', expire_after=10)

    runtime.publish_state('binary_sensor', 'alarm', False)
    assert mqtt.published[-1]['if_changed'] == 'hass_state_binary_sensor_alarm'
    assert mqtt.published[-1]['retain'] is True

    clock.advance(4)
    runtime.publish_state('binary_sensor', 'alarm', False)
    assert mqtt.published[-1]['if_changed'] == 'hass_state_binary_sensor_alarm'

    # Half of the window has passed: the unchanged value goes out once more, which is what
    # restarts Home Assistant's expire_after timer on a live device.
    clock.advance(1)
    runtime.publish_state('binary_sensor', 'alarm', False)
    assert mqtt.published[-1]['if_changed'] is None
    assert mqtt.published[-1]['value'] is False

    runtime.publish_state('binary_sensor', 'alarm', False)
    assert mqtt.published[-1]['if_changed'] == 'hass_state_binary_sensor_alarm'


def test_expire_after_restarts_the_window_on_a_value_change(hass, clock):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp', expire_after=10)

    runtime.publish_state('sensor', 'temp', 1.0)
    clock.advance(4)
    runtime.publish_state('sensor', 'temp', 2.0)
    assert mqtt.published[-1]['if_changed'] == 'hass_state_sensor_temp'

    clock.advance(4)  # 4 s after the change: still inside the first half of the window
    runtime.publish_state('sensor', 'temp', 2.0)
    assert mqtt.published[-1]['if_changed'] == 'hass_state_sensor_temp'

    clock.advance(1)  # 5 s after the change: the unchanged value is repeated
    runtime.publish_state('sensor', 'temp', 2.0)
    assert mqtt.published[-1]['if_changed'] is None


def test_entities_without_expire_after_never_repeat_the_state(hass, clock):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp')

    runtime.publish_state('sensor', 'temp', 21.5)
    clock.advance(3600)
    runtime.publish_state('sensor', 'temp', 21.5)

    assert mqtt.published[-1]['if_changed'] == 'hass_state_sensor_temp'


def test_heartbeat_is_skipped_when_deduplication_is_off(hass, clock):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'temp', expire_after=10)

    runtime.publish_state('sensor', 'temp', 1.0, if_changed=False)
    clock.advance(60)
    runtime.publish_state('sensor', 'temp', 1.0, if_changed=False)

    assert [entry['if_changed'] for entry in mqtt.published] == [None, None]


def test_entity_log_reports_expire_and_availability(hass, capsys):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('otter-test')

    runtime.register_entity('number', 'time', expire_after=10)
    runtime.register_entity('sensor', 'level', availability_flags=['Timer'],
                            availability_mode='any')
    runtime.register_entity('binary_sensor', 'alarm', availability=False)

    lines = capsys.readouterr().out.splitlines()
    number_line = next(line for line in lines if 'entity: number.time' in line)
    assert "state='otter/otter-test/number/time/state'" in number_line
    assert 'expire=10s' in number_line
    assert "availability='otter/otter-test/availability'" in number_line
    assert 'mode=' not in number_line

    sensor_line = next(line for line in lines if 'entity: sensor.level' in line)
    assert 'expire=none' in sensor_line
    assert (
        "availability='otter/otter-test/availability', "
        "'otter/otter-test/availability/Timer' mode=any" in sensor_line
    )

    alarm_line = next(line for line in lines if 'entity: binary_sensor.alarm' in line)
    assert 'availability=none' in alarm_line


def test_register_entity_twice_keeps_one_entry(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    runtime.register_entity('sensor', 'temp', name='Old')
    runtime.register_entity('sensor', 'temp', name='New')

    assert runtime.entity_count == 1
    assert runtime.entity_count_for('sensor') == 1
    published = [entry for entry in mqtt.deferred if entry['topic'].endswith('/config')]
    assert len(published) == 2
    assert configs(mqtt)[-1]['name'] == 'New'


def test_register_entity_rejects_an_empty_id(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    with pytest.raises(ValueError, match='needs a component and an object_id'):
        runtime.register_entity('sensor', '  ')


def test_announce_all_republishes_every_config(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'a')
    runtime.register_entity('number', 'b')

    mqtt.deferred.clear()
    assert runtime.announce_all() == 2

    assert [entry['topic'] for entry in mqtt.deferred] == [
        'homeassistant/sensor/dev1/a/config',
        'homeassistant/number/dev1/b/config',
    ]
    assert all(entry['if_changed'] is None for entry in mqtt.deferred)


def test_poll_birth_reannounces_on_online(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('sensor', 'a')
    mqtt.deferred.clear()

    mqtt.feed('homeassistant/status', 'offline')
    assert runtime.poll_birth() is False
    assert mqtt.deferred == []

    mqtt.feed('homeassistant/status', 'online')
    assert runtime.poll_birth() is True
    assert len(mqtt.deferred) == 1
    assert runtime.poll_birth() is False


def test_poll_birth_without_configuration_is_silent(hass):
    runtime, mqtt = make_runtime(hass)
    mqtt.feed('homeassistant/status', 'online')

    assert runtime.poll_birth() is False


def test_publish_state_is_retained_and_deduplicated(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    runtime.publish_state('sensor', 'temp', 21.5)
    entry = mqtt.published[-1]

    assert entry['topic'] == 'otter/dev1/sensor/temp/state'
    assert entry['value'] == 21.5
    assert entry['retain'] is True
    assert entry['if_changed'] == 'hass_state_sensor_temp'

    runtime.publish_state('sensor', 'temp', 21.5, if_changed=False)
    assert mqtt.published[-1]['if_changed'] is None


def test_latest_and_take_command(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    mqtt.feed('otter/dev1/number/level/set', 42.5)

    assert runtime.latest_command('number', 'level', value_type='float') == 42.5
    assert runtime.take_command('number', 'level', value_type='float') is True
    assert runtime.take_command('number', 'level', value_type='float') is False


def test_two_command_keys_each_see_one_update(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    mqtt.feed('otter/dev1/number/level/set', 42.5)

    assert runtime.take_command('number', 'level', key='hass_cmd_5') is True
    assert runtime.take_command('number', 'level', key='hass_cmd_7') is True
    assert runtime.take_command('number', 'level', key='hass_cmd_5') is False
    assert runtime.take_command('number', 'level', key='hass_cmd_7') is False


def test_the_default_command_key_is_independent_of_the_node_key(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    mqtt.feed('otter/dev1/number/level/set', 1)

    assert runtime.take_command('number', 'level') is True
    assert runtime.take_command('number', 'level', key='hass_cmd_9') is True


def test_module_wrappers_use_the_singleton(hass, monkeypatch):
    mqtt = FakeMqtt()
    runtime = hass.HassRuntime(mqtt)
    monkeypatch.setattr(hass, '_RUNTIME', runtime)

    hass.configure('dev1', device_name='Kitchen')
    temp_config = hass.register_entity('sensor', 'temp', availability_flags=['heating'])
    hass.publish_state('sensor', 'temp', 1)

    assert runtime.device_id == 'dev1'
    assert hass.state_topic('sensor', 'temp') == 'otter/dev1/sensor/temp/state'
    assert hass.availability_topic() == 'otter/dev1/availability'
    assert hass.availability_topic('heating') == 'otter/dev1/availability/heating'
    assert temp_config['availability_mode'] == 'all'
    assert hass.command_topic('switch', 'relay') == 'otter/dev1/switch/relay/set'
    assert hass.announce_all() == 1
    assert hass.poll_birth() is False
    assert hass.latest_command('switch', 'relay', value_type='bool') is None
    assert hass.take_command('switch', 'relay') is False


def test_register_entity_warns_about_publish_and_subscribe_when_mqtt_is_disabled(hass, capsys):
    runtime = hass.HassRuntime(DisabledMqtt())
    runtime.configure('otter-test')
    capsys.readouterr()

    runtime.register_entity('switch', 'relay', name='Relay')

    warnings = [line for line in capsys.readouterr().out.splitlines()
                if line.startswith('[warning]')]
    assert len(warnings) == 1
    assert 'hass: entity: switch.relay publish and subscribe' in warnings[0]
    assert 'MQTT disabled (enabled=false in /mqtt_settings.json)' in warnings[0]
    assert "state='otter/otter-test/switch/relay/state'" in warnings[0]
    assert "command='otter/otter-test/switch/relay/set'" in warnings[0]


def test_publish_state_warns_once_per_entity_when_mqtt_is_disabled(hass, capsys):
    runtime = hass.HassRuntime(DisabledMqtt())
    runtime.configure('otter-test')
    runtime.register_entity('sensor', 'temperature')
    capsys.readouterr()

    runtime.publish_state('sensor', 'temperature', 21.5)
    runtime.publish_state('sensor', 'temperature', 22.5)
    runtime.publish_state('binary_sensor', 'window', True)

    warnings = [line for line in capsys.readouterr().out.splitlines()
                if line.startswith('[warning]') and 'state:' in line]
    assert len(warnings) == 2
    assert "state: sensor.temperature publish with MQTT disabled" in warnings[0]
    assert "topic='otter/otter-test/sensor/temperature/state'" in warnings[0]
    assert 'enabled=false in /mqtt_settings.json' in warnings[0]
    assert 'state: binary_sensor.window' in warnings[1]


def test_entity_registration_warns_once_per_entity(hass, capsys):
    runtime = hass.HassRuntime(DisabledMqtt())
    runtime.configure('otter-test')

    runtime.register_entity('sensor', 'temperature')
    runtime.register_entity('sensor', 'temperature')
    runtime.announce_all()

    warnings = [line for line in capsys.readouterr().out.splitlines()
                if line.startswith('[warning]')]
    assert len(warnings) == 1


def test_no_warning_when_mqtt_is_enabled(hass, capsys):
    mqtt = FakeMqtt()
    mqtt.enabled = True
    runtime = hass.HassRuntime(mqtt)
    runtime.configure('otter-test')

    runtime.register_entity('switch', 'relay')
    runtime.publish_state('switch', 'relay', True)

    out = capsys.readouterr().out
    assert '[warning]' not in out


def test_no_warning_when_the_transport_reports_no_enabled_state(hass, capsys):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('otter-test')

    runtime.register_entity('switch', 'relay')
    runtime.publish_state('switch', 'relay', True)

    out = capsys.readouterr().out
    assert '[warning]' not in out


def test_report_state_false_omits_the_state_topic(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')

    config = runtime.register_entity('number', 'level', report_state=False)

    assert 'state_topic' not in config
    assert config['command_topic'] == 'otter/dev1/number/level/set'
    assert ('otter/dev1/number/level/set', 0) in mqtt.subscriptions
    assert all(topic != 'otter/dev1/number/level/state' for topic, _qos in mqtt.publish_topics)
    assert 'state_topic' not in configs(mqtt)[-1]


def test_report_state_defaults_to_a_state_topic(hass):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')

    default_config = runtime.register_entity('number', 'a')
    explicit_config = runtime.register_entity('number', 'b', report_state=True)

    assert default_config['state_topic'] == 'otter/dev1/number/a/state'
    assert explicit_config['state_topic'] == 'otter/dev1/number/b/state'


def test_publish_state_of_a_state_less_entity_is_a_logged_no_op(hass, capsys):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('number', 'level', report_state=False)
    capsys.readouterr()

    assert runtime.publish_state('number', 'level', 1) is False
    assert runtime.publish_state('number', 'level', 2) is False

    assert mqtt.published == []
    warnings = [line for line in capsys.readouterr().out.splitlines()
                if line.startswith('[warning]')]
    assert len(warnings) == 1
    assert 'hass: state: number.level has no state topic (report_state=False)' in warnings[0]


def test_state_less_entity_still_receives_commands(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('number', 'level', report_state=False)
    mqtt.feed('otter/dev1/number/level/set', 42.5)

    assert runtime.latest_command('number', 'level', value_type='float') == 42.5
    assert runtime.take_command('number', 'level', value_type='float') is True
    assert runtime.take_command('number', 'level', value_type='float') is False


def test_report_state_false_is_rejected_for_a_read_only_component(hass, capsys):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')
    capsys.readouterr()

    config = runtime.register_entity('sensor', 'temperature', report_state=False)

    assert config['state_topic'] == 'otter/dev1/sensor/temperature/state'
    errors = [line for line in capsys.readouterr().out.splitlines()
              if line.startswith('[error]')]
    assert len(errors) == 1
    assert "component 'sensor' has no command topic either" in errors[0]
    assert 'report_state=True used instead' in errors[0]


@pytest.mark.parametrize('component', ['number', 'switch', 'select', 'text', 'button'])
def test_every_writable_component_may_omit_the_state_topic(hass, capsys, component):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')
    capsys.readouterr()

    config = runtime.register_entity(component, 'x', report_state=False)

    assert 'state_topic' not in config
    assert capsys.readouterr().out.count('[error]') == 0


def test_state_less_entity_never_heartbeats(hass, clock):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('number', 'level', expire_after=10, report_state=False)
    runtime.register_entity('sensor', 'temp', expire_after=10)

    for _step in range(6):
        runtime.publish_state('number', 'level', 1)
        runtime.publish_state('sensor', 'temp', 21.5)
        clock.advance(5)

    # Only the stateful entity repeats; the state-less one has no window to keep alive.
    assert len(mqtt.published) >= 2
    assert {entry['topic'] for entry in mqtt.published} == {'otter/dev1/sensor/temp/state'}


def test_announce_all_includes_the_state_less_config(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    runtime.register_entity('number', 'level', report_state=False)
    before = len(configs(mqtt))

    assert runtime.announce_all(force=True) == 1

    payloads = configs(mqtt)
    assert len(payloads) == before + 1
    assert 'state_topic' not in payloads[-1]
    assert payloads[-1]['command_topic'] == 'otter/dev1/number/level/set'


def test_entity_log_names_a_state_less_entity(hass, capsys):
    runtime, _mqtt = make_runtime(hass)
    runtime.configure('dev1')
    capsys.readouterr()

    runtime.register_entity('button', 'reset', report_state=False)

    lines = [line for line in capsys.readouterr().out.splitlines()
             if 'hass: entity: button.reset' in line]
    assert len(lines) == 1
    assert 'state=none' in lines[0]
    assert "command='otter/dev1/button/reset/set'" in lines[0]


def test_button_press_is_a_consumed_edge_per_key(hass):
    runtime, mqtt = make_runtime(hass)
    runtime.configure('dev1')
    config = runtime.register_entity(
        'button', 'restart', config={'payload_press': 'PRESS'}, report_state=False
    )

    assert 'state_topic' not in config
    assert config['command_topic'] == 'otter/dev1/button/restart/set'
    assert config['payload_press'] == 'PRESS'

    mqtt.feed('otter/dev1/button/restart/set', 'PRESS')

    assert runtime.take_command('button', 'restart', value_type='string',
                               key='hass_cmd_7') is True
    assert runtime.take_command('button', 'restart', value_type='string',
                               key='hass_cmd_7') is False
    # A second node on the same entity still sees the same press exactly once.
    assert runtime.take_command('button', 'restart', value_type='string',
                               key='hass_cmd_8') is True
    assert runtime.take_command('button', 'restart', value_type='string',
                               key='hass_cmd_8') is False

    # A button reports no state, so a stray publish stays on the device.
    assert runtime.publish_state('button', 'restart', True) is False
    assert mqtt.published == []

