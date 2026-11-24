"""Tests for the vendored ``otter_mqtt.umqtt.simple`` client.

The module is MicroPython firmware, so the host tests stub ``usocket``/``ustruct``/
``ubinascii`` before importing it. Only the connect path is covered here: it is the one
place with unbounded blocking calls, which is exactly what stalls a device that starts
MQTT before the WiFi station link is up.
"""

import struct as _struct
import sys
import types
from pathlib import Path

import pytest

MQTT_PKG_ROOT = Path('src/micro_otter/nodes/device/node_pkgs/mqtt').resolve()

CONNACK_OK = b'\x20\x02\x00\x00'


class FakeSocket:
    """Records the socket calls ``MQTTClient.connect()`` makes."""

    def __init__(self):
        self.timeouts = []
        self.timeout = None
        self.blocking = None
        self.connected_to = None
        self.written = bytearray()
        self.addr = None
        self.closed = 0

    def settimeout(self, value):
        self.timeout = value
        self.timeouts.append(value)

    def setblocking(self, flag):
        self.blocking = flag

    def connect(self, addr):
        self.connected_to = addr

    def write(self, data, length=None):
        payload = data.encode('utf-8') if isinstance(data, str) else bytes(data)
        self.written.extend(payload[: length if length is not None else len(payload)])

    def read(self, count):
        return CONNACK_OK

    def close(self):
        self.closed += 1


@pytest.fixture()
def env(monkeypatch):
    """Import ``otter_mqtt.umqtt.simple`` with stubbed MicroPython modules."""
    sockets = []
    usocket = types.ModuleType('usocket')

    def socket_factory():
        sock = FakeSocket()
        sockets.append(sock)
        return sock

    usocket.socket = socket_factory
    usocket.getaddrinfo = lambda host, port: [(2, 1, 0, '', (host, port))]

    ubinascii = types.ModuleType('ubinascii')
    ubinascii.hexlify = lambda data: data

    monkeypatch.setitem(sys.modules, 'usocket', usocket)
    monkeypatch.setitem(sys.modules, 'ustruct', _struct)
    monkeypatch.setitem(sys.modules, 'ubinascii', ubinascii)

    # The device tree is not on sys.path, and a cached import would keep the stubs of a
    # previous test, so import a fresh copy under a private name.
    for name in [key for key in sys.modules if key.startswith('otter_mqtt')]:
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.syspath_prepend(str(MQTT_PKG_ROOT))

    import otter_mqtt.umqtt.simple as simple_mod

    return types.SimpleNamespace(module=simple_mod, sockets=sockets, usocket=usocket)


def test_connect_bounds_the_blocking_socket_calls(env):
    client = env.module.MQTTClient('otter-test', 'broker.local', keepalive=60)

    client.connect()

    sock = env.sockets[0]
    assert sock.timeouts == [env.module.CONNECT_TIMEOUT_S]
    assert sock.connected_to == ('broker.local', 1883)
    assert sock.written[:1] == b'\x10'


def test_connect_keeps_the_timeout_for_the_connack_read(env):
    client = env.module.MQTTClient('otter-test', 'broker.local')

    client.connect()

    # Never cleared before the CONNACK arrived: `read(4)` is bounded by the same timeout.
    assert env.sockets[0].timeout == env.module.CONNECT_TIMEOUT_S


def test_connect_tolerates_sockets_without_settimeout(env):
    class NoTimeoutSocket(FakeSocket):
        """Socket of a port that does not implement `settimeout()`."""

        def __getattribute__(self, name):
            if name == 'settimeout':
                raise AttributeError(name)
            return super().__getattribute__(name)

    def factory():
        sock = NoTimeoutSocket()
        env.sockets.append(sock)
        return sock

    env.usocket.socket = factory
    client = env.module.MQTTClient('otter-test', 'broker.local')

    client.connect()

    assert env.sockets[0].connected_to == ('broker.local', 1883)


def test_connect_raises_on_a_failed_connack(env, monkeypatch):
    def factory():
        sock = FakeSocket()
        sock.read = lambda count: b'\x20\x02\x00\x05'
        env.sockets.append(sock)
        return sock

    env.usocket.socket = factory
    client = env.module.MQTTClient('otter-test', 'broker.local')

    with pytest.raises(env.module.MQTTException) as excinfo:
        client.connect()

    assert excinfo.value.args == (5,)
