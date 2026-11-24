import asyncio
import importlib
import json
import pathlib
import sys
import types

import pytest

MQTT_PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs/mqtt').resolve()


@pytest.fixture(scope='module')
def runtime():
    sys.path.insert(0, str(MQTT_PKG_ROOT))
    import otter_mqtt.runtime as rt

    yield rt
    sys.path.remove(str(MQTT_PKG_ROOT))


class FakeClient:
    def __init__(self, settings):
        self.settings = settings
        self.cb = None
        self.connected = False
        self.subscribed = []
        self.published = []
        self.disconnect_calls = 0
        self.pings = 0
        self.will = None
        self.calls = []

    def set_callback(self, cb):
        self.cb = cb

    def set_last_will(self, topic, msg, retain=False, qos=0):
        self.will = (topic, msg, retain, qos)
        self.calls.append('will')

    def connect(self):
        self.calls.append('connect')
        self.connected = True

    def disconnect(self):
        self.disconnect_calls += 1
        self.connected = False

    def subscribe(self, topic, qos):
        self.subscribed.append((topic, qos))

    def publish(self, topic, msg, retain=False, qos=0):
        self.published.append((topic, msg, retain, qos))

    def check_msg(self):
        return None

    def ping(self):
        self.pings += 1


def test_load_settings_defaults_when_missing(runtime, tmp_path):
    settings = runtime._load_settings(path=str(tmp_path / 'missing.json'))
    assert settings == {
        'enabled': False,
        'host': '',
        'port': 1883,
        'client_id': '',
        'user': '',
        'password': '',
        'keepalive': 60,
        'pump_delay_ms': 50,
        'resync_interval_s': 30,
    }


def test_load_settings_overrides(runtime, tmp_path):
    settings_path = tmp_path / 'mqtt_settings.json'
    settings_path.write_text(
        json.dumps(
            {'enabled': True, 'host': 'broker.local', 'port': 8883, 'pump_delay_ms': 120}
        )
    )
    settings = runtime._load_settings(path=str(settings_path))
    assert settings['enabled'] is True
    assert settings['host'] == 'broker.local'
    assert settings['port'] == 8883
    assert settings['pump_delay_ms'] == 120
    assert settings['keepalive'] == 60


def test_ensure_runtime_singleton_and_dedupe(runtime, monkeypatch):
    monkeypatch.setattr(runtime, '_RUNTIME', None)
    first = runtime.ensure_runtime()
    second = runtime.ensure_runtime()
    assert first is second

    first.register_subscription('a/b', 0)
    first.register_subscription('a/b', 0)
    first.register_subscription('a/b', 1)
    first.register_publish('c/d', 0)
    first.register_publish('c/d', 0)
    assert first._subscriptions == [('a/b', 0), ('a/b', 1)]
    assert first._publish_topics == [('c/d', 0)]


def test_on_message_stores_decoded_payload(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.latest('sensors/temp') == '21.5'
    assert rt.take_latest('sensors/temp') == '21.5'
    assert rt.take_latest('sensors/temp') is None


def test_on_message_before_start_is_usable(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    entry = rt._messages['sensors/temp']
    assert entry['epoch'] == 0
    assert rt._entry_is_usable(entry) is True


def test_on_message_hook_receives_decoded_strings(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    calls = []
    rt.on_message(lambda topic, payload: calls.append((topic, payload)))
    rt._on_message(b'home/x', b'online')
    assert calls == [('home/x', 'online')]


def test_on_message_hook_dedupes_bound_method(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    calls = []

    class Recorder:
        def record(self, topic, payload):
            calls.append((topic, payload))

    recorder = Recorder()
    rt.on_message(recorder.record)
    rt.on_message(recorder.record)
    rt._on_message(b'home/x', b'online')
    assert len(calls) == 1


def test_raising_message_hook_keeps_pump_and_pull_path(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': False})
    second_calls = []

    def boom(topic, payload):
        raise RuntimeError('boom')

    def second(topic, payload):
        second_calls.append((topic, payload))

    rt.on_message(boom)
    rt.on_message(second)
    rt._on_message(b'home/x', b'online')

    out = capsys.readouterr().out
    assert out.count('[error] mqtt: message hook failed') == 1
    assert second_calls == [('home/x', 'online')]
    assert rt.latest_value('home/x') == 'online'


def test_message_hook_can_publish(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt._client = client
    rt._connected = True

    rt.on_message(lambda topic, payload: rt.publish('reply/x', 'ack'))
    rt._on_message(b'home/x', b'online')

    assert ('reply/x', b'ack', False, 0) in client.published


def test_two_message_hooks_run_in_registration_order(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    order = []

    def first(topic, payload):
        order.append('first')

    def second(topic, payload):
        order.append('second')

    rt.on_message(first)
    rt.on_message(second)
    rt._on_message(b'home/x', b'online')
    assert order == ['first', 'second']


def test_reconnect_starts_new_connect_epoch(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    assert rt._connect_epoch == 1
    rt._on_message(b'sensors/temp', b'21.5')
    old_entry = rt._messages['sensors/temp']

    rt.disconnect()
    assert rt._connect_epoch == 2
    rt.start()

    assert rt._connect_epoch == 3
    assert rt._entry_is_usable(old_entry) is False

    rt._on_message(b'sensors/temp', b'22.5')
    assert rt._entry_is_usable(rt._messages['sensors/temp']) is True


def test_pump_loss_invalidates_stored_messages(runtime):
    class BrokenClient(FakeClient):
        def check_msg(self):
            raise OSError('link down')

    client = BrokenClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt._on_message(b'sensors/temp', b'21.5')

    asyncio.run(rt._pump())

    assert rt._entry_is_usable(rt._messages['sensors/temp']) is False


def test_entry_is_usable_handles_missing_entry(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    assert rt._entry_is_usable(None) is False


def _counting_coerce(runtime, monkeypatch):
    calls = []
    original = runtime.coerce

    def counting(payload, value_type='string', json_key=''):
        calls.append((payload, value_type, json_key))
        return original(payload, value_type, json_key)

    monkeypatch.setattr(runtime, 'coerce', counting)
    return calls


def test_coerced_value_parses_once_per_sequence(runtime, monkeypatch):
    calls = _counting_coerce(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')

    assert rt._coerced_value('sensors/temp', 'float', '') == 21.5
    assert rt._coerced_value('sensors/temp', 'float', '') == 21.5
    assert len(calls) == 1

    rt._on_message(b'sensors/temp', b'22.5')

    assert rt._coerced_value('sensors/temp', 'float', '') == 22.5
    assert len(calls) == 2


def test_coerced_value_caches_per_type(runtime, monkeypatch):
    calls = _counting_coerce(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')

    assert rt._coerced_value('sensors/temp', 'float', '') == 21.5
    assert rt._coerced_value('sensors/temp', 'string', '') == '21.5'
    assert rt._coerced_value('sensors/temp', 'float', '') == 21.5
    assert rt._coerced_value('sensors/temp', 'string', '') == '21.5'
    assert len(calls) == 2
    assert len(rt._coerced) == 2


def test_coerced_value_caches_failures(runtime, monkeypatch):
    calls = _counting_coerce(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'not json')

    assert rt._coerced_value('sensors/temp', 'float', 'v') is None
    assert rt._coerced_value('sensors/temp', 'float', 'v') is None
    assert len(calls) == 1


def test_coerced_value_without_message(runtime, monkeypatch):
    calls = _counting_coerce(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': False})
    assert rt._coerced_value('missing/topic', 'float', '') is None
    assert calls == []


def test_latest_value_uses_configured_default(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    assert rt.latest_value('missing/topic', 'float', default=1.5) == 1.5


def test_latest_value_falls_back_to_type_default(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    assert rt.latest_value('missing/topic', 'float') == 0.0
    assert rt.latest_value('missing/topic', 'int') == 0
    assert rt.latest_value('missing/topic', 'bool') is False
    assert rt.latest_value('missing/topic', 'string') == ''
    assert rt.latest_value('missing/topic') == ''


def test_latest_value_coerces_the_default(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    value = rt.latest_value('missing/topic', 'float', default=0)
    assert value == 0.0
    assert isinstance(value, float)
    assert rt.latest_value('missing/topic', 'string', default=0) == '0'
    assert rt.latest_value('missing/topic', 'int', default='abc') == 0


def test_latest_value_is_sticky(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.latest_value('sensors/temp', 'float', default=1.5) == 21.5
    # Consuming the freshness must not clear the value (this was the crash).
    assert rt.take_latest('sensors/temp') == '21.5'
    assert rt.latest_value('sensors/temp', 'float', default=1.5) == 21.5
    for value_type in ('float', 'int', 'bool', 'string'):
        assert rt.latest_value('missing/topic', value_type) is not None


def test_latest_value_uses_default_for_unusable_payload(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'not json')
    assert rt.latest_value('sensors/temp', 'float', default=2.5) == 2.5


def test_latest_value_require_connected(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.latest_value('sensors/temp', 'float', default=1.5, require_connected=True) == 21.5
    assert rt.latest_value('sensors/temp', 'float', default=1.5) == 21.5

    rt.disconnect()

    assert rt.latest_value('sensors/temp', 'float', default=1.5, require_connected=True) == 1.5
    assert rt.latest_value('sensors/temp', 'float', default=1.5) == 21.5


def test_take_updated_reports_once_per_consumer(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is True
    assert rt.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is False


def test_take_updated_is_per_node(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is True
    assert rt.take_updated('sensors/temp', 'float', key='_mqtt_read_2') is True
    assert rt.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is False


def test_take_updated_and_take_latest_use_independent_cursors(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.take_updated('sensors/temp', 'float', key='a') is True
    assert rt.take_latest('sensors/temp') == '21.5'
    assert rt.take_updated('sensors/temp', 'float', key='a') is False

    rt._on_message(b'sensors/temp', b'22.5')
    assert rt.take_latest('sensors/temp') == '22.5'
    assert rt.take_updated('sensors/temp', 'float', key='a') is True


def test_take_updated_skips_malformed_payload(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'not json')
    assert rt.take_updated('sensors/temp', 'float', json_key='v', key='a') is False
    rt._on_message(b'sensors/temp', b'{"v": 3}')
    assert rt.take_updated('sensors/temp', 'float', json_key='v', key='a') is True


def test_take_updated_require_connected_keeps_cursor(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt._on_message(b'sensors/temp', b'21.5')
    rt.disconnect()

    assert rt.take_updated('sensors/temp', 'float', key='a', require_connected=True) is False

    rt.start()

    assert rt.take_updated('sensors/temp', 'float', key='a', require_connected=True) is False
    rt._on_message(b'sensors/temp', b'22.5')
    assert rt.take_updated('sensors/temp', 'float', key='a', require_connected=True) is True


def test_has_new_is_a_peek_per_consumer(runtime):
    rt = runtime.MqttRuntime({'enabled': False})
    rt._on_message(b'sensors/temp', b'21.5')
    assert rt.has_new('sensors/temp') is True
    assert rt.has_new('sensors/temp') is True
    assert rt.has_new('sensors/temp', key='a') is True

    assert rt.take_updated('sensors/temp', 'string', key='a') is True
    assert rt.has_new('sensors/temp', key='a') is False
    assert rt.has_new('sensors/temp') is True

    assert rt.has_new('missing/topic') is False


def test_start_connects_and_subscribes(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.register_subscription('a/b', 0)
    rt.register_subscription('a/b', 1)
    rt.start()
    assert client.connected is True
    assert client.subscribed == [('a/b', 0), ('a/b', 1)]


def test_start_and_publish_disabled(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': False}, client_factory=lambda settings: client)
    rt.register_subscription('a/b', 0)
    rt.start()
    assert rt._client is None
    assert client.connected is False
    rt.publish('a/b', 'x')
    assert client.published == []


def test_publish_skips_unchanged(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')
    rt.publish('a/b', 'x', if_changed='key1')
    rt.publish('a/b', 'y', if_changed='key1')
    assert [entry[1] for entry in client.published] == [b'x', b'y']


def test_publish_while_disconnected_is_sent_after_start(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.publish('a/b', 'x', if_changed='key1')
    assert client.published == []

    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')

    assert [entry[1] for entry in client.published] == [b'x']


def test_publish_failure_does_not_record_the_memo(runtime):
    class FailingOnceClient(FakeClient):
        def __init__(self, settings):
            super().__init__(settings)
            self.failures_left = 1

        def publish(self, topic, msg, retain=False, qos=0):
            if self.failures_left:
                self.failures_left -= 1
                raise OSError('boom')
            super().publish(topic, msg, retain=retain, qos=qos)

    client = FailingOnceClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()

    rt.publish('a/b', 'x', if_changed='key1')
    assert client.published == []

    rt.publish('a/b', 'x', if_changed='key1')
    assert [entry[1] for entry in client.published] == [b'x']


def test_publish_resends_identical_value_after_reconnect(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')
    assert [entry[1] for entry in client.published] == [b'x']

    rt.disconnect()
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')

    assert [entry[1] for entry in client.published] == [b'x', b'x']


def test_publish_resends_identical_value_after_connection_loss(runtime):
    class FlakyClient(FakeClient):
        def __init__(self, settings):
            super().__init__(settings)
            self.fail = True

        def check_msg(self):
            if self.fail:
                raise OSError(-1)
            return None

    client = FlakyClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')

    asyncio.run(rt._pump())
    assert rt.connected is False
    assert rt._client is None

    client.fail = False
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')

    assert [entry[1] for entry in client.published] == [b'x', b'x']


def test_publish_duplicate_after_reconnect_is_suppressed_again(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')

    rt.disconnect()
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')
    rt.publish('a/b', 'x', if_changed='key1')

    assert [entry[1] for entry in client.published] == [b'x', b'x']


def test_disconnect_clears_other_keys(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')
    rt.publish('c/d', 'y', if_changed='key2')
    assert [entry[1] for entry in client.published] == [b'x', b'y']

    rt.disconnect()
    rt.start()
    rt.publish('a/b', 'x', if_changed='key1')
    rt.publish('c/d', 'y', if_changed='key2')

    assert [entry[1] for entry in client.published] == [b'x', b'y', b'x', b'y']


def test_coerce_converts_values(runtime):
    assert runtime.coerce(b'21.5', 'float') == 21.5
    assert runtime.coerce(b'21', 'int') == 21
    assert runtime.coerce(b'true', 'bool') is True
    assert runtime.coerce(b'hello', 'string') == 'hello'
    assert runtime.coerce(b'{"temp": 23.0}', 'float', 'temp') == 23.0
    assert runtime.coerce(b'{"v": 3}', 'int', 'v') == 3
    assert runtime.coerce(b'false', 'bool') is False
    assert runtime.coerce(None, 'float') is None


def test_coerce_missing_json_key_reports_failure(runtime):
    assert runtime.coerce(b'{"other": 1}', 'string', 'v') is None
    assert runtime.coerce(b'{"other": 1}', 'int', 'v') is None


def test_coerce_error_paths_report_failure(runtime):
    assert runtime.coerce(None, 'float') is None
    assert runtime.coerce(b'not json', 'int', 'v') is None
    assert runtime.coerce(b'[1,2]', 'int', 'v') is None


def test_coerce_bool_edge_cases(runtime):
    # Unstructured payloads with no numeric mapping are the failure case.
    assert runtime.coerce(b'{"v": [1]}', 'bool', 'v') is None
    assert runtime.coerce(b'off', 'bool') is False
    assert runtime.coerce(b'1', 'bool') is True
    # Arbitrary strings keep their defined token mapping instead of failing.
    assert runtime.coerce(b'xyz', 'bool') is False


def test_disconnect_closes_client_and_is_idempotent(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    assert rt.connected is True

    rt.disconnect()

    assert client.disconnect_calls == 1
    assert rt.connected is False
    assert rt._client is None

    rt.disconnect()  # safe to call again with no client

    assert client.disconnect_calls == 1


def test_late_registration_subscribes_immediately(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    assert rt.connected is True

    rt.register_subscription('a/b', 1)

    assert client.subscribed == [('a/b', 1)]
    assert rt._subscriptions == [('a/b', 1)]


def test_late_registration_while_disabled_waits_for_start(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': False}, client_factory=lambda settings: client)

    rt.register_subscription('a/b', 0)

    assert client.subscribed == []
    assert rt._subscriptions == [('a/b', 0)]


def test_duplicate_late_registration_subscribes_once(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()

    rt.register_subscription('a/b', 0)
    rt.register_subscription('a/b', 0)

    assert client.subscribed == [('a/b', 0)]


def test_late_registration_survives_subscribe_failure(runtime):
    class FailingSubscribeClient(FakeClient):
        def subscribe(self, topic, qos):
            raise OSError('broker gone')

    client = FailingSubscribeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()

    rt.register_subscription('a/b', 0)

    assert rt._subscriptions == [('a/b', 0)]
    assert rt.connected is True


def test_start_after_disconnect_reconnects_and_resubscribes(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.register_subscription('a/b', 0)
    rt.start()
    assert client.subscribed == [('a/b', 0)]

    rt.disconnect()
    assert rt.connected is False

    rt.start()

    assert rt.connected is True
    assert client.subscribed == [('a/b', 0), ('a/b', 0)]


def test_pump_marks_disconnected_when_check_msg_raises(runtime):
    class BrokenClient(FakeClient):
        def check_msg(self):
            raise OSError('link down')

    client = BrokenClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    assert rt.connected is True

    asyncio.run(rt._pump())

    assert rt.connected is False
    assert rt._client is None


def test_default_client_factory_uses_simple_client(monkeypatch):
    monkeypatch.setitem(sys.modules, 'usocket', types.ModuleType('usocket'))
    monkeypatch.setitem(sys.modules, 'ustruct', types.ModuleType('ustruct'))
    ubinascii = types.ModuleType('ubinascii')
    ubinascii.hexlify = lambda data: data
    monkeypatch.setitem(sys.modules, 'ubinascii', ubinascii)

    sys.path.insert(0, str(MQTT_PKG_ROOT))
    try:
        import otter_mqtt.runtime as runtime_mod
        import otter_mqtt.umqtt.simple as simple_mod

        importlib.reload(runtime_mod)
        assert runtime_mod.MQTTClient is simple_mod.MQTTClient
    finally:
        sys.path.remove(str(MQTT_PKG_ROOT))


def test_module_wrappers_delegate_to_singleton(runtime, monkeypatch):
    monkeypatch.setattr(runtime, '_RUNTIME', None)
    singleton = runtime.ensure_runtime()
    singleton._on_message(b'sensors/temp', b'21.5')

    assert runtime.latest('sensors/temp') == '21.5'
    assert runtime.latest_value('sensors/temp', 'float') == 21.5
    assert runtime.has_new('sensors/temp') is True
    assert runtime.has_new('sensors/temp', key='a') is True
    assert runtime.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is True
    assert runtime.take_updated('sensors/temp', 'float', key='_mqtt_read_1') is False
    assert runtime.take_latest('sensors/temp') == '21.5'
    assert runtime.take_latest('sensors/temp') is None
    assert runtime.is_connected() is False


def test_module_is_connected_reports_runtime_state(runtime, monkeypatch):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    monkeypatch.setattr(runtime, '_RUNTIME', rt)

    assert runtime.is_connected() is False
    rt.start()
    assert runtime.is_connected() is True


def test_module_helpers_without_settings_file(monkeypatch, runtime):
    monkeypatch.setattr(runtime, '_RUNTIME', None)
    ready = runtime.ensure_runtime()
    assert ready.enabled is False
    assert runtime.latest_value('anything', 'int') == 0
    assert runtime.take_updated('anything') is False


def test_resync_interval_s_reads_and_clamps(runtime):
    assert runtime.MqttRuntime({'resync_interval_s': 45}).resync_interval_s == 45
    assert runtime.MqttRuntime({'resync_interval_s': 0}).resync_interval_s == 1
    assert runtime.MqttRuntime({}).resync_interval_s == 30
    assert runtime.MqttRuntime({'resync_interval_s': 'bad'}).resync_interval_s == 30


class MQTTException(Exception):
    """Stand-in for otter_mqtt.umqtt.simple.MQTTException (name matters)."""


def test_describe_error_maps_connack_codes(runtime):
    assert runtime._describe_error(MQTTException(5)) == 'MQTTException: 5 (not-authorized)'
    assert runtime._describe_error(MQTTException(4)) == (
        'MQTTException: 4 (bad-username-or-password)'
    )
    # Plain OSErrors keep their errno-looking argument without a reason suffix.
    assert runtime._describe_error(OSError(-2)) == 'OSError: -2'
    assert runtime._describe_error(OSError(2)) == 'OSError: 2'
    assert runtime._describe_error(ValueError('boom')) == 'ValueError: boom'


def test_target_formats_host_and_default_port(runtime):
    assert runtime._target({'host': 'broker.local', 'port': 8883}) == 'mqtt://broker.local:8883'
    assert runtime._target({'host': 'broker.local', 'port': 0}) == 'mqtt://broker.local:1883'
    assert runtime._target({'host': '', 'port': 1883}) == 'mqtt://<empty>:1883'
    assert runtime._target({'host': 'broker.local', 'port': 'bad'}) == 'mqtt://broker.local:1883'


def test_ticks_helpers_are_monotonic_enough(runtime):
    start = runtime._ticks_ms()
    assert runtime._ticks_diff(runtime._ticks_ms(), start) >= 0
    assert runtime._elapsed_ms(0) == 0
    assert runtime._elapsed_ms(start) >= 0


def test_info_and_error_use_console_prefixes(runtime, capsys):
    runtime._info('hello')
    runtime._error('boom')

    out = capsys.readouterr().out
    assert '[info] mqtt: hello' in out
    assert '[error] mqtt: boom' in out


def test_drop_socket_never_raises(runtime):
    class BrokenSocket:
        def __init__(self):
            self.closed = 0

        def close(self):
            self.closed += 1
            raise RuntimeError('boom')

    sock = BrokenSocket()
    runtime._drop_socket(types.SimpleNamespace(sock=sock))

    assert sock.closed == 1
    runtime._drop_socket(types.SimpleNamespace(sock=None))
    runtime._drop_socket(object())


def test_load_settings_logs_file_and_flags(runtime, tmp_path, capsys):
    settings_path = tmp_path / 'mqtt_settings.json'
    settings_path.write_text(
        json.dumps(
            {
                'enabled': True,
                'host': 'broker.local',
                'port': 8883,
                'user': 'otter',
                'password': 'secret',
            }
        )
    )

    runtime._load_settings(path=str(settings_path))

    out = capsys.readouterr().out
    assert f'settings: file={settings_path} loaded' in out
    assert 'enabled=True' in out
    assert "host='broker.local'" in out
    assert 'port=8883' in out
    assert 'user=otter' in out
    assert 'password=set' in out
    assert 'keepalive=60' in out
    assert 'secret' not in out


def test_load_settings_logs_missing_file(runtime, tmp_path, capsys):
    missing = tmp_path / 'missing.json'

    runtime._load_settings(path=str(missing))

    out = capsys.readouterr().out
    assert f'settings: file={missing} not found, using defaults' in out


def test_load_settings_logs_invalid_json(runtime, tmp_path, capsys):
    broken = tmp_path / 'broken.json'
    broken.write_text('not json')

    settings = runtime._load_settings(path=str(broken))

    out = capsys.readouterr().out
    assert '[warning] mqtt: settings: load failed' in out
    assert 'using defaults' in out
    assert settings['keepalive'] == 60


def test_register_logs_deferred_immediate_and_duplicate(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True})

    rt.register_subscription('a/b', 0)
    rt.register_subscription('a/b', 0)

    out = capsys.readouterr().out
    assert "register: subscription topic='a/b' qos=0 (deferred)" in out
    assert "register: subscription topic='a/b' qos=0 (duplicate ignored)" in out
    assert '(immediate)' not in out

    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    rt.register_subscription('c/d', 1)

    out = capsys.readouterr().out
    assert "register: subscription topic='c/d' qos=1 (immediate)" in out
    assert "subscribe: 'c/d' qos=1 ok" in out
    assert client.subscribed == [('c/d', 1)]


def test_register_publish_logs_once(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True})

    rt.register_publish('a/b', 0)
    rt.register_publish('a/b', 0)
    rt.register_publish('a/b', 1)

    out = capsys.readouterr().out
    assert out.count("register: publish topic='a/b' qos=0") == 1
    assert "register: publish topic='a/b' qos=1" in out
    assert rt._publish_topics == [('a/b', 0), ('a/b', 1)]


class FailingClient(FakeClient):
    def __init__(self, settings, error=None):
        super().__init__(settings)
        self.error = error or OSError(-2)
        self.sock = types.SimpleNamespace(closed=0, close=self._close)

    def _close(self):
        self.sock.closed += 1

    def connect(self):
        raise self.error


def _recording_client(runtime, monkeypatch):
    """Replace the real client class with one that records its constructor kwargs."""
    created = []

    class RecordingClient(FakeClient):
        def __init__(self, client_id, host, port=1883, user=None, password=None,
                     keepalive=60):
            super().__init__({})
            created.append(
                {
                    'client_id': client_id,
                    'host': host,
                    'port': port,
                    'user': user,
                    'password': password,
                    'keepalive': keepalive,
                }
            )

    monkeypatch.setattr(runtime, 'MQTTClient', RecordingClient)
    return created


def test_start_logs_target_and_connect_result(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime(
        {'enabled': True, 'host': 'broker.local', 'port': 1883},
        client_factory=lambda settings: client,
    )
    rt.register_subscription('a/b', 0)
    rt.register_subscription('c/d', 1)

    rt.start()

    out = capsys.readouterr().out
    assert 'start: requested enabled=True connected=False' in out
    assert 'connect: mqtt://broker.local:1883 client_id=custom' in out
    assert 'keepalive=60' in out
    assert 'user=none' in out
    assert 'password=unset' in out
    assert 'connect: ok mqtt://broker.local:1883 (' in out
    assert "subscribe: 'a/b' qos=0 ok" in out
    assert "subscribe: 'c/d' qos=1 ok" in out
    assert rt.connected is True


def test_start_skipped_when_disabled_is_logged(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': False})

    rt.start()

    out = capsys.readouterr().out
    assert 'start: skipped, disabled by settings (/mqtt_settings.json)' in out
    assert rt._client is None


def test_start_skipped_when_already_connected_is_logged(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.start()

    out = capsys.readouterr().out
    assert 'start: skipped, already connected' in out
    assert client.connected is True


def test_start_skipped_when_client_missing_is_logged(runtime, monkeypatch, capsys):
    monkeypatch.setattr(runtime, 'MQTTClient', None)
    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local'})

    rt.start()

    out = capsys.readouterr().out
    assert 'otter_mqtt.umqtt.simple not importable' in out
    assert rt._client is None
    assert rt.connected is False


def _fake_machine_with_wlan(connected):
    """`machine` stand-in whose `WLAN(...).isconnected()` reports `connected`."""

    class WLAN:
        STA_IF = 0

        def __init__(self, iface):
            self.iface = iface

        def isconnected(self):
            return connected

    return types.SimpleNamespace(WLAN=WLAN)


def test_station_link_reports_unknown_without_machine(runtime, monkeypatch):
    monkeypatch.setattr(runtime, '_machine', None)
    assert runtime._station_link_up() is None


def test_station_link_reports_unknown_without_wlan(runtime, monkeypatch):
    monkeypatch.setattr(runtime, '_machine', types.SimpleNamespace())
    assert runtime._station_link_up() is None


def test_station_link_reports_unknown_when_the_wlan_raises(runtime, monkeypatch):
    class BrokenWLAN:
        STA_IF = 0

        def __init__(self, iface):
            raise OSError('wlan not initialised')

    monkeypatch.setattr(runtime, '_machine', types.SimpleNamespace(WLAN=BrokenWLAN))
    assert runtime._station_link_up() is None


def test_start_defers_when_the_station_link_is_down(runtime, monkeypatch, capsys):
    # A hard reset reassociates the station after init_mqtt() ran; connecting then would
    # block in getaddrinfo/connect without a timeout and announce nothing.
    monkeypatch.setattr(runtime, '_machine', _fake_machine_with_wlan(False))
    created = []

    def factory(settings):
        created.append(settings)
        return FakeClient(settings)

    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local'}, client_factory=factory)

    rt.start()

    out = capsys.readouterr().out
    assert 'start: requested enabled=True connected=False wifi=down' in out
    assert 'start: deferred, wifi station link is down' in out
    assert created == []
    assert rt._client is None
    assert rt.connected is False


def test_start_connects_when_the_station_link_is_up(runtime, monkeypatch, capsys):
    monkeypatch.setattr(runtime, '_machine', _fake_machine_with_wlan(True))
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()

    out = capsys.readouterr().out
    assert 'start: requested enabled=True connected=False wifi=up' in out
    assert rt.connected is True
    assert client.connected is True


def test_start_proceeds_when_the_platform_cannot_report_the_link(runtime, monkeypatch):
    monkeypatch.setattr(runtime, '_machine', None)
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()

    assert rt.connected is True


def test_connect_failure_logs_error_and_clears_client(runtime, capsys):
    client = FailingClient({}, OSError(-2))
    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local'},
                             client_factory=lambda settings: client)

    rt.start()

    out = capsys.readouterr().out
    assert '[error] mqtt: connect failed mqtt://broker.local:1883' in out
    assert 'OSError: -2' in out
    assert rt._client is None
    assert rt.connected is False
    assert client.sock.closed == 1


def test_connect_failure_maps_connack_code(runtime, capsys):
    client = FailingClient({}, MQTTException(5))
    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local'},
                             client_factory=lambda settings: client)

    rt.start()

    out = capsys.readouterr().out
    assert 'MQTTException: 5 (not-authorized)' in out


def test_user_without_password_uses_empty_password(runtime, monkeypatch, capsys):
    created = _recording_client(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local', 'user': 'otter'})

    rt.start()

    out = capsys.readouterr().out
    assert created[0]['user'] == 'otter'
    assert created[0]['password'] == ''
    assert 'user configured without password, sending empty password' in out
    assert 'password=unset' in out
    assert rt.connected is True


def test_password_without_user_is_dropped(runtime, monkeypatch, capsys):
    created = _recording_client(runtime, monkeypatch)
    rt = runtime.MqttRuntime({'enabled': True, 'host': 'broker.local', 'password': 'secret'})

    rt.start()

    out = capsys.readouterr().out
    assert created[0]['user'] is None
    assert created[0]['password'] is None
    assert 'password ignored (no username configured)' in out
    assert 'secret' not in out


def test_start_tolerates_malformed_port_and_keepalive(runtime, monkeypatch, capsys):
    created = _recording_client(runtime, monkeypatch)
    rt = runtime.MqttRuntime(
        {'enabled': True, 'host': 'broker.local', 'port': 'bad', 'keepalive': 'bad'}
    )

    rt.start()

    assert created[0]['port'] == 1883
    assert created[0]['keepalive'] == 60
    assert rt.connected is True
    assert 'keepalive=60' in capsys.readouterr().out


def test_pump_logs_start_and_stop(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True, 'pump_delay_ms': 10})

    class OneShotClient(FakeClient):
        def check_msg(self):
            # Clearing the client ends the pump loop after one iteration.
            rt._client = None

    rt._client = OneShotClient({})

    asyncio.run(rt._pump())

    out = capsys.readouterr().out
    assert 'pump: stopped (client cleared)' in out


def test_pump_start_logs_delay_and_missing_loop(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True, 'pump_delay_ms': 25})

    # No running loop outside asyncio.run(): the pump must say why it is idle.
    rt._start_pump()

    out = capsys.readouterr().out
    assert 'pump: not started (no running event loop)' in out
    assert rt._pump_task is None

    async def start_inside_loop():
        rt._client = FakeClient({})
        rt._start_pump()
        task = rt._pump_task
        rt._client = None
        if task is not None:
            await task

    capsys.readouterr()
    asyncio.run(start_inside_loop())

    out = capsys.readouterr().out
    assert 'pump: started delay_ms=25' in out
    assert 'pump: stopped (client cleared)' in out


def test_pump_logs_connection_lost(runtime, capsys):
    class BrokenClient(FakeClient):
        def check_msg(self):
            raise OSError(-1)

    client = BrokenClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    asyncio.run(rt._pump())

    out = capsys.readouterr().out
    assert '[error] mqtt: connection lost (OSError: -1)' in out
    assert rt.connected is False
    assert rt._client is None


def test_first_message_logged_once_per_topic(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': False})

    rt._on_message(b'sensors/temp', b'21.5')
    rt._on_message(b'sensors/temp', b'22.5')
    rt._on_message(b'sensors/hum', b'{"h": 40}')

    out = capsys.readouterr().out
    assert out.count("message: topic='sensors/temp'") == 1
    assert out.count("message: topic='sensors/hum'") == 1
    assert "payload='22.5'" not in out
    assert rt.latest('sensors/temp') == '22.5'


def test_message_log_truncates_long_payloads(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': False})

    rt._on_message(b'long/topic', b'x' * 100)

    out = capsys.readouterr().out
    assert "payload='{}...'".format('x' * 32) in out
    assert 'x' * 40 not in out


def test_publish_skip_logged_once_per_topic(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True})

    rt.publish('a/b', 'x')
    rt.publish('a/b', 'y')
    rt.publish('c/d', 'z')

    out = capsys.readouterr().out
    assert out.count("publish: skipped (not connected) topic='a/b'") == 1
    assert out.count("publish: skipped (not connected) topic='c/d'") == 1


def test_publish_failure_logged_once_per_topic(runtime, capsys):
    class FailingPublishClient(FakeClient):
        def publish(self, topic, msg, retain=False, qos=0):
            raise OSError(-1)

    client = FailingPublishClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x')
    rt.publish('a/b', 'y')

    out = capsys.readouterr().out
    assert out.count("[error] mqtt: publish failed topic='a/b' (OSError: -1)") == 1


def test_publish_logs_first_success_per_topic(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x', retain=True)

    out = capsys.readouterr().out
    assert (
        "[success] mqtt: publish: first ok topic='a/b' qos=0 retain=True payload='x'" in out
    )
    assert out.count('publish: first ok') == 1


def test_publish_success_log_is_once_per_topic(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x')
    rt.publish('a/b', 'y')
    rt.publish('c/d', 'z')

    out = capsys.readouterr().out
    assert out.count("publish: first ok topic='a/b'") == 1
    assert out.count("publish: first ok topic='c/d'") == 1


def test_publish_success_log_repeats_after_reconnect(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x')
    rt.disconnect()
    rt.start()
    rt.publish('a/b', 'x')

    out = capsys.readouterr().out
    assert out.count("publish: first ok topic='a/b'") == 2


def test_publish_success_log_truncates_long_payload(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x' * 40)

    out = capsys.readouterr().out
    assert "payload='{}...'".format('x' * 32) in out
    assert 'x' * 33 not in out


def test_failed_publish_does_not_consume_the_first_ok_slot(runtime, capsys):
    class FailingOnceClient(FakeClient):
        def __init__(self, settings):
            super().__init__(settings)
            self.failures_left = 1

        def publish(self, topic, msg, retain=False, qos=0):
            if self.failures_left:
                self.failures_left -= 1
                raise OSError(-1)
            super().publish(topic, msg, retain=retain, qos=qos)

    client = FailingOnceClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.publish('a/b', 'x')
    rt.publish('a/b', 'y')

    out = capsys.readouterr().out
    assert out.count("publish: first ok topic='a/b'") == 1
    assert "payload='y'" in out


def test_publish_success_log_skipped_when_disabled(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': False})

    rt.publish('a/b', 'x')

    assert 'publish: first ok' not in capsys.readouterr().out


def test_disconnect_logs_request_and_done(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()
    capsys.readouterr()

    rt.disconnect()

    out = capsys.readouterr().out
    assert 'disconnect: requested connected=True' in out
    assert 'disconnect: done' in out
    assert rt.connected is False


def _started_runtime(runtime, monkeypatch, settings=None, client=None):
    """Start a runtime whose clock reads 1000 ms, returning (runtime, client)."""
    monkeypatch.setattr(runtime, '_ticks_ms', lambda: 1000)
    client = client or FakeClient({})
    config = {'enabled': True, 'keepalive': 60}
    config.update(settings or {})
    rt = runtime.MqttRuntime(config, client_factory=lambda _settings: client)
    rt.start()
    return rt, client


def test_keepalive_tick_sends_ping_at_half_window(runtime, monkeypatch):
    rt, client = _started_runtime(runtime, monkeypatch)

    assert rt._last_tx_ms == 1000
    assert rt._keepalive_tick(now=31000) is True

    assert client.pings == 1
    assert rt._last_tx_ms == 31000


def test_keepalive_tick_resends_on_next_window(runtime, monkeypatch):
    rt, client = _started_runtime(runtime, monkeypatch)

    rt._keepalive_tick(now=31000)
    rt._keepalive_tick(now=40000)
    rt._keepalive_tick(now=61000)

    assert client.pings == 2


def test_keepalive_tick_is_silent_before_half_window(runtime, monkeypatch):
    rt, client = _started_runtime(runtime, monkeypatch)

    assert rt._keepalive_tick(now=20000) is True

    assert client.pings == 0
    assert rt._last_tx_ms == 1000


def test_keepalive_tick_disabled_for_zero_or_malformed(runtime, monkeypatch):
    rt, client = _started_runtime(runtime, monkeypatch, {'keepalive': 0})
    assert rt._keepalive_ms() == 0
    assert rt._keepalive_tick(now=10 ** 9) is True
    assert client.pings == 0

    rt, client = _started_runtime(runtime, monkeypatch, {'keepalive': 'bad'})
    assert rt._keepalive_ms() == 0
    assert rt._keepalive_tick(now=10 ** 9) is True
    assert client.pings == 0


def test_keepalive_tick_skips_clients_without_ping(runtime, monkeypatch):
    rt, _client = _started_runtime(runtime, monkeypatch)
    rt._client = types.SimpleNamespace()

    assert rt._keepalive_tick(now=31000) is True
    assert rt._last_tx_ms == 1000


def test_keepalive_tick_without_client_is_a_noop(runtime):
    rt = runtime.MqttRuntime({'enabled': True, 'keepalive': 60})

    assert rt._keepalive_tick(now=10 ** 9) is True


def test_keepalive_tick_returns_false_when_ping_raises(runtime, monkeypatch, capsys):
    class BrokenPingClient(FakeClient):
        def ping(self):
            raise OSError(-1)

    rt, _client = _started_runtime(runtime, monkeypatch, client=BrokenPingClient({}))
    capsys.readouterr()

    assert rt._keepalive_tick(now=31000) is False

    out = capsys.readouterr().out
    assert '[error] mqtt: keepalive ping failed (OSError: -1)' in out


def test_publish_resets_keepalive_clock(runtime, monkeypatch):
    rt, client = _started_runtime(runtime, monkeypatch)
    monkeypatch.setattr(runtime, '_ticks_ms', lambda: 20000)

    rt.publish('a/b', 'x')

    assert rt._last_tx_ms == 20000
    assert rt._keepalive_tick(now=40000) is True
    assert client.pings == 0
    assert client.published == [('a/b', b'x', False, 0)]


def test_pump_pings_when_idle_and_stops_when_ping_fails(runtime, monkeypatch, capsys):
    clock = {'now': 1000}

    monkeypatch.setattr(runtime, '_ticks_ms', lambda: clock['now'])

    class IdlePingingClient(FakeClient):
        def check_msg(self):
            # Every poll advances the clock past half the keepalive window.
            clock['now'] += 31000

        def ping(self):
            self.pings += 1
            raise OSError(-1)

    client = IdlePingingClient({})
    rt = runtime.MqttRuntime(
        {'enabled': True, 'keepalive': 60}, client_factory=lambda _settings: client
    )
    rt.start()
    capsys.readouterr()

    asyncio.run(rt._pump())

    out = capsys.readouterr().out
    assert client.pings == 1
    assert '[error] mqtt: keepalive ping failed (OSError: -1)' in out
    assert 'keepalive: link torn down after failed ping' in out
    assert rt.connected is False
    assert rt._client is None


def test_pump_does_not_ping_inside_the_window(runtime, monkeypatch):
    clock = {'now': 1000, 'polls': 0}

    monkeypatch.setattr(runtime, '_ticks_ms', lambda: clock['now'])

    class QuietClient(FakeClient):
        def check_msg(self):
            clock['now'] += 100
            clock['polls'] += 1
            if clock['polls'] >= 5:
                rt._client = None

    client = QuietClient({})
    rt = runtime.MqttRuntime(
        {'enabled': True, 'keepalive': 60}, client_factory=lambda _settings: client
    )
    rt.start()

    asyncio.run(rt._pump())

    assert clock['polls'] == 5
    assert client.pings == 0
    assert rt.connected is True


def test_pump_start_logs_keepalive_window(runtime, capsys):
    rt = runtime.MqttRuntime({'enabled': True, 'keepalive': 60, 'pump_delay_ms': 25})
    rt._client = FakeClient({})

    async def start_inside_loop():
        rt._start_pump()
        task = rt._pump_task
        rt._client = None
        if task is not None:
            await task

    asyncio.run(start_inside_loop())

    out = capsys.readouterr().out
    assert 'pump: started delay_ms=25 keepalive_ms=60000' in out


def test_pump_start_treats_missing_loop_as_info(runtime, monkeypatch, capsys):
    class NoLoopAsyncio:
        @staticmethod
        def create_task(coro):
            coro.close()
            raise RuntimeError('no running event loop')

    monkeypatch.setattr(runtime, 'asyncio', NoLoopAsyncio)
    rt = runtime.MqttRuntime({'enabled': True})

    rt._start_pump()

    out = capsys.readouterr().out
    assert '[info] mqtt: pump: not started (no running event loop)' in out
    assert '[error]' not in out
    assert rt._pump_task is None


def test_pump_start_logs_other_failures_as_errors(runtime, monkeypatch, capsys):
    class BrokenAsyncio:
        @staticmethod
        def create_task(coro):
            coro.close()
            raise ValueError('boom')

    monkeypatch.setattr(runtime, 'asyncio', BrokenAsyncio)
    rt = runtime.MqttRuntime({'enabled': True})

    rt._start_pump()

    out = capsys.readouterr().out
    assert '[error] mqtt: pump: start failed (ValueError: boom)' in out
    assert rt._pump_task is None


class WillLegacyClient(FakeClient):
    """Client whose MQTT implementation has no last-will support."""

    set_last_will = None


def test_configure_will_is_applied_before_connect(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.configure_will('home/status', 'offline')
    rt.start()

    assert client.will == ('home/status', b'offline', True, 0)
    assert client.calls == ['will', 'connect']


def test_start_without_will_never_calls_set_last_will(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()

    assert client.will is None
    assert 'will' not in client.calls


def test_will_is_reapplied_on_every_new_client(runtime):
    clients = []

    def factory(settings):
        client = FakeClient(settings)
        clients.append(client)
        return client

    rt = runtime.MqttRuntime({'enabled': True}, client_factory=factory)
    rt.configure_will('home/status', 'offline')
    rt.start()
    rt.disconnect()
    rt.start()

    assert len(clients) == 2
    assert clients[0].will == ('home/status', b'offline', True, 0)
    assert clients[1].will == ('home/status', b'offline', True, 0)


def test_clear_will_removes_it_from_the_next_connection(runtime):
    clients = []

    def factory(settings):
        client = FakeClient(settings)
        clients.append(client)
        return client

    rt = runtime.MqttRuntime({'enabled': True}, client_factory=factory)
    rt.configure_will('home/status', 'offline')
    rt.start()
    rt.clear_will()
    rt.disconnect()
    rt.start()

    assert clients[1].will is None


def test_client_without_set_last_will_is_tolerated(runtime, capsys):
    client = WillLegacyClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.configure_will('home/status', 'offline')
    rt.start()

    out = capsys.readouterr().out
    assert rt.connected is True
    assert out.count('will: client does not support set_last_will') == 1


def test_will_payload_encoding_matches_publish(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.configure_will('home/status', b'raw', retain=False, qos=1)
    assert rt._will == ('home/status', b'raw', False, 1)

    rt.configure_will('home/status', True)
    assert rt._will[1] == b'true'

    rt.configure_will('home/status', 42)
    assert rt._will[1] == b'42'


def test_publish_deferred_publishes_on_connect_once(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one')
    rt.publish_deferred('home/b', 'two')
    assert client.published == []

    rt.start()

    assert client.published == [
        ('home/a', b'one', True, 0),
        ('home/b', b'two', True, 0),
    ]


def test_publish_deferred_replays_after_reconnect(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one')
    rt.start()
    rt.disconnect()
    rt.start()

    assert [entry[1] for entry in client.published] == [b'one', b'one']


def test_publish_deferred_publishes_immediately_when_connected(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()
    rt.publish_deferred('home/a', 'one')
    assert [entry[1] for entry in client.published] == [b'one']

    rt.disconnect()
    rt.start()
    assert [entry[1] for entry in client.published] == [b'one', b'one']


def test_publish_deferred_replaces_the_payload_for_the_same_key(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'old', key='job')
    rt.publish_deferred('home/a', 'new', key='job')
    rt.start()

    assert [entry[1] for entry in client.published] == [b'new']


def test_clear_deferred_prevents_the_replay(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one', key='job')
    rt.clear_deferred('job')
    rt.start()

    assert client.published == []


def test_publish_deferred_failure_is_logged_once(runtime, capsys):
    class FailingClient(FakeClient):
        def publish(self, topic, msg, retain=False, qos=0):
            raise OSError('boom')

    client = FailingClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one')
    rt.start()
    rt.disconnect()
    rt.start()

    out = capsys.readouterr().out
    assert out.count("publish failed (deferred) topic='home/a'") == 1
    assert rt.connected is True


def test_publish_deferred_stores_only_when_disabled(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': False}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one')
    rt.start()

    assert rt._deferred != {}
    assert client.published == []


def test_publish_deferred_if_changed_suppresses_immediate_publish_only(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()
    rt.publish_deferred('home/a', 'one', if_changed='memo')
    rt.publish_deferred('home/a', 'one', if_changed='memo')
    assert [entry[1] for entry in client.published] == [b'one']

    rt._mark_disconnected()
    rt.start()
    assert [entry[1] for entry in client.published] == [b'one', b'one']


def test_publish_deferred_replay_records_the_memo(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one', if_changed='memo')
    rt.start()
    rt.publish_deferred('home/a', 'one', if_changed='memo')

    assert [entry[1] for entry in client.published] == [b'one']


def test_start_logs_how_many_topics_it_reannounces(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.publish_deferred('home/a', 'one')
    rt.publish_deferred('home/b', 'two', key='b')
    capsys.readouterr()

    rt.start()

    out = capsys.readouterr().out
    assert 'connect: re-announcing 2 deferred topic(s)' in out
    assert [entry[0] for entry in client.published] == ['home/a', 'home/b']


def test_start_does_not_log_a_reannounce_without_deferred_topics(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.start()

    assert 're-announcing' not in capsys.readouterr().out


def test_publish_deferred_logs_the_offline_queue_once_per_key(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)

    rt.publish_deferred('home/a', 'one', key='a')
    rt.publish_deferred('home/a', 'two', key='a')
    rt.publish_deferred('home/b', 'three', key='b')

    out = capsys.readouterr().out
    assert out.count("publish: queued (not connected) topic='home/a'") == 1
    assert "publish: queued (not connected) topic='home/b' queued=2" in out

    rt.start()

    assert 'publish: queued' not in capsys.readouterr().out


def test_on_connect_hook_runs_once_per_connect(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    calls = []

    def hook():
        calls.append('hook')

    rt.on_connect(hook)
    rt.on_connect(hook)
    rt.start()
    assert calls == ['hook']

    rt.disconnect()
    rt.start()
    assert calls == ['hook', 'hook']


def test_failing_connect_hook_does_not_abort_start(runtime, capsys):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    calls = []

    def broken():
        raise RuntimeError('boom')

    rt.on_connect(broken)
    rt.on_connect(lambda: calls.append('second'))
    rt.start()

    out = capsys.readouterr().out
    assert rt.connected is True
    assert calls == ['second']
    assert out.count('connect hook failed') == 1


def test_on_connect_hook_after_start_is_not_retroactive(runtime):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    rt.start()

    calls = []
    rt.on_connect(lambda: calls.append('hook'))
    assert calls == []

    rt.disconnect()
    rt.start()
    assert calls == ['hook']


def test_json_payload_uses_the_documented_wire_format(runtime):
    assert runtime.json_payload({'t': 21.5, 'ok': True}) == b'{"t":21.5,"ok":true}'
    assert runtime.json_payload({'k': 1, 'b': True}) == b'{"k":1,"b":true}'


def test_json_payload_falls_back_to_str_with_one_error(runtime, capsys):
    payload = runtime.json_payload({1, 2})

    out = capsys.readouterr().out
    assert isinstance(payload, bytes)
    assert out.count('[error] mqtt: json: encode failed') == 1


def test_json_value_decodes_bytes_strings_and_none(runtime, capsys):
    assert runtime.json_value(b'{"a":1}') == {'a': 1}
    assert runtime.json_value('{"a":1}') == {'a': 1}
    assert runtime.json_value(None) is None
    assert '[error]' not in capsys.readouterr().out


def test_json_value_reports_decode_failure_once(runtime, capsys):
    assert runtime.json_value(b'not json') is None

    out = capsys.readouterr().out
    assert out.count('[error] mqtt: json: decode failed') == 1


def test_json_round_trip_keeps_builtin_types(runtime):
    original = {'i': 3, 'f': 2.5, 'b': True, 's': 'x'}
    assert runtime.json_value(runtime.json_payload(original)) == original


def test_module_wrappers_for_will_deferred_and_hooks(runtime, monkeypatch):
    client = FakeClient({})
    rt = runtime.MqttRuntime({'enabled': True}, client_factory=lambda settings: client)
    monkeypatch.setattr(runtime, '_RUNTIME', rt)

    runtime.configure_will('home/status', 'offline')
    runtime.publish_deferred('home/a', 'one')
    calls = []
    runtime.on_connect(lambda: calls.append('hook'))
    runtime.start()

    assert client.will == ('home/status', b'offline', True, 0)
    assert client.published == [('home/a', b'one', True, 0)]
    assert calls == ['hook']

    runtime.clear_will()
    runtime.clear_deferred()
    assert rt._will is None
    assert rt._deferred == {}



