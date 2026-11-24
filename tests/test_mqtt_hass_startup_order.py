"""End-to-end check of the MQTT/Home Assistant registration order.

The reported failure was that Home Assistant never saw the device: `init_mqtt()` ran before
the WiFi station link existed, the deferred payloads were therefore never sent, and the app
itself did not load at all (see `tests/proc/hass-example-collection.test.js` for the
generated-code side). These tests drive the real `otter_hass.runtime`, the real
`otter_mqtt.runtime` and the real `MqttService` through a `ServiceController` and assert
that nothing goes out while the transport is down and everything is announced - discovery
plus availability - once the station link comes up.
"""

import asyncio
import importlib.util
import pathlib
import sys
import types

import pytest

PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs').resolve()
RUNTIME_ROOT = pathlib.Path('src/micro_otter/nodes/device/runtime/general').resolve()
OTTER_RUNTIME_ROOT = RUNTIME_ROOT / 'otter_runtime'


def _load_runtime_module(name, path):
    """Load one `otter_runtime` adapter from the device tree by file path."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeClient:
    """umqtt.simple stand-in that records the wire traffic."""

    def __init__(self):
        self.cb = None
        self.connected = False
        self.subscribed = []
        self.published = []
        self.pings = 0
        self.will = None

    def set_callback(self, cb):
        self.cb = cb

    def set_last_will(self, topic, msg, retain=False, qos=0):
        self.will = (topic, msg, retain, qos)

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.connected = False

    def subscribe(self, topic, qos):
        self.subscribed.append((topic, qos))

    def publish(self, topic, msg, retain=False, qos=0):
        self.published.append((topic, msg, retain, qos))

    def check_msg(self):
        return None

    def ping(self):
        self.pings += 1

    def topics(self):
        return [entry[0] for entry in self.published]


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.syspath_prepend(str(PKG_ROOT / 'mqtt'))
    monkeypatch.syspath_prepend(str(PKG_ROOT / 'hass'))

    import otter_hass.runtime as hass_runtime
    import otter_mqtt.runtime as mqtt_runtime

    # Load the adapters the way the device runtime does, but keep the path-based
    # `otter_runtime` package out of sys.modules: other tests build their own generated
    # runtime root and import `otter_runtime.*` from there.
    stub = types.ModuleType('otter_runtime')
    stub.__path__ = [str(OTTER_RUNTIME_ROOT)]
    monkeypatch.setitem(sys.modules, 'otter_runtime', stub)
    service_controller = _load_runtime_module(
        'otter_runtime.service_controller', OTTER_RUNTIME_ROOT / 'service_controller.py'
    )
    monkeypatch.setitem(sys.modules, 'otter_runtime.service_controller', service_controller)
    mqtt_service = _load_runtime_module(
        'otter_runtime.mqtt_service', OTTER_RUNTIME_ROOT / 'mqtt_service.py'
    )

    client = FakeClient()
    mqtt_rt = mqtt_runtime.MqttRuntime(
        {'enabled': True, 'host': 'broker.local', 'port': 1883},
        client_factory=lambda settings: client,
    )
    # MqttService and the `hass` runtime both go through ensure_runtime(), so the
    # singleton is what they must share with this test.
    monkeypatch.setattr(mqtt_runtime, '_RUNTIME', mqtt_rt)

    hass_rt = hass_runtime.HassRuntime(mqtt=mqtt_runtime)
    hass_rt.configure(
        device_id='otter-test',
        device_name='otter-1',
        discovery_prefix='homeassistant',
        topic_prefix='otter',
        will=True,
    )
    hass_rt.register_entity('sensor', 'temperature', name='Temperature')

    controller = service_controller.ServiceController([mqtt_service.MqttService()])
    return types.SimpleNamespace(
        controller=controller,
        client=client,
        mqtt=mqtt_rt,
        hass=hass_rt,
        mqtt_runtime=mqtt_runtime,
    )


def test_nothing_is_announced_while_the_transport_is_down(env, capsys):
    asyncio.run(env.controller.sync({'sta_connected': False, 'ap_active': True}))

    out = capsys.readouterr().out
    assert 'service-controller: skip mqtt: transport not ready' in out
    assert env.client.published == []
    assert env.mqtt.connected is False
    # The bridge and the entity were registered while the link was still down: their
    # payloads wait in the deferred queue that the first connect replays.
    queued_topics = {entry[0] for entry in env.mqtt._deferred.values()}
    assert env.hass.config_topic('sensor', 'temperature') in queued_topics


def test_everything_is_announced_once_the_station_link_comes_up(env, capsys):
    asyncio.run(env.controller.sync({'sta_connected': False, 'ap_active': True}))
    capsys.readouterr()

    # The late-connect sync `otter_main` triggers from the WiFi supervisor.
    asyncio.run(env.controller.sync({'sta_connected': True, 'ap_active': True}))

    out = capsys.readouterr().out
    assert 'service-controller: starting mqtt' in out
    assert 'mqtt: connect: ok' in out
    assert 'connect: re-announcing 2 deferred topic(s)' in out
    assert 'hass: connected: entities=1' in out

    config_topic = env.hass.config_topic('sensor', 'temperature')
    availability_topic = env.hass.availability_topic()
    topics = env.client.topics()
    assert config_topic in topics
    assert availability_topic in topics
    # The will travels inside CONNECT, before any publish can happen.
    assert env.client.will[0] == availability_topic
    assert env.mqtt.connected is True


def test_home_assistant_birth_reannounces_the_discovery_config(env, capsys):
    asyncio.run(env.controller.sync({'sta_connected': True, 'ap_active': True}))
    config_topic = env.hass.config_topic('sensor', 'temperature')
    assert env.client.topics().count(config_topic) == 1
    capsys.readouterr()

    # The pump delivers `homeassistant/status` -> `online` to the message hooks.
    env.mqtt._on_message(b'homeassistant/status', b'online')

    assert env.client.topics().count(config_topic) == 2
    assert 'hass: birth: re-announcing 1 entities' in capsys.readouterr().out


def test_the_queue_grows_before_the_connection_and_is_replayed_after(env):
    # `init_mqtt()` runs while the station is still associating: the bridge and every
    # entity queue their retained payloads, and nothing is lost.
    queued_topics = {entry[0] for entry in env.mqtt._deferred.values()}
    assert env.hass.config_topic('sensor', 'temperature') in queued_topics
    assert env.hass.availability_topic() in queued_topics
    assert env.client.published == []

    asyncio.run(env.controller.sync({'sta_connected': True, 'ap_active': True}))

    assert set(env.client.topics()) == queued_topics


def test_the_runtime_defers_when_its_own_link_check_says_no(env, monkeypatch, capsys):
    # The controller's facts and the port's own view can disagree; the runtime gate wins.
    class WLAN:
        STA_IF = 0

        def __init__(self, iface):
            self.iface = iface

        def isconnected(self):
            return False

    machine = types.SimpleNamespace(WLAN=WLAN)
    monkeypatch.setattr(env.mqtt_runtime, '_machine', machine)

    asyncio.run(env.controller.sync({'sta_connected': True, 'ap_active': True}))

    out = capsys.readouterr().out
    assert 'start: deferred, wifi station link is down' in out
    assert env.client.published == []
    assert env.mqtt.connected is False
