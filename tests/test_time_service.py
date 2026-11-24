"""Behaviour of the `time` package clock service, tested on CPython.

The service is a MicroPython module, so the tests stub what it talks to: the socket
used for SNTP, the device clock (`machine.RTC`) and `asyncio.sleep`. Everything
else — the derived epoch, the sentinels, the retry schedule — is real code.
"""

import asyncio
import sys
import types
from pathlib import Path

import pytest

PKG_ROOT = Path('src/micro_otter/nodes/device/node_pkgs').resolve()

KNOWN_EPOCH = 1700000000


def _drop_modules():
    for name in list(sys.modules):
        if name == 'otter_time' or name.startswith('otter_time.'):
            del sys.modules[name]


@pytest.fixture()
def service():
    """A freshly imported `otter_time.service` for every test (state is global)."""
    _drop_modules()
    sys.path.insert(0, str(PKG_ROOT / 'time'))
    try:
        import otter_time.service as service_module

        yield service_module
    finally:
        sys.path.remove(str(PKG_ROOT / 'time'))
        _drop_modules()


class FakeSocket:
    """Records the sent packet and returns a crafted reply."""

    def __init__(self, reply, recorder, fail_on_recv=False):
        self.reply = reply
        self.recorder = recorder
        self.fail_on_recv = fail_on_recv
        self.closed = False
        self.timeout = None

    def settimeout(self, value):
        self.timeout = value

    def sendto(self, data, address):
        self.recorder.append(('sendto', data, address))

    def recv(self, size):
        if self.fail_on_recv:
            raise OSError('timed out')
        return self.reply[:size]

    def close(self):
        self.closed = True
        self.recorder.append(('close', None, None))


class FakeSocketModule:
    """Minimal stand-in for the `socket` module used by `query_ntp`."""

    AF_INET = 2
    SOCK_DGRAM = 2

    def __init__(self, reply, fail_on_recv=False):
        self.reply = reply
        self.fail_on_recv = fail_on_recv
        self.recorder = []
        self.sockets = []

    def getaddrinfo(self, host, port):
        self.recorder.append(('getaddrinfo', host, port))
        return [(self.AF_INET, self.SOCK_DGRAM, 17, '', ('203.0.113.9', port))]

    def socket(self, family, socktype):
        sock = FakeSocket(self.reply, self.recorder, self.fail_on_recv)
        self.sockets.append(sock)
        return sock


def ntp_reply(epoch):
    """A 48-byte SNTP reply whose transmit timestamp encodes *epoch*."""
    seconds = epoch + 2208988800
    packet = bytearray(48)
    packet[0] = 0x24
    packet[40] = (seconds >> 24) & 0xFF
    packet[41] = (seconds >> 16) & 0xFF
    packet[42] = (seconds >> 8) & 0xFF
    packet[43] = seconds & 0xFF
    return bytes(packet)


def test_query_ntp_returns_the_fetched_epoch(service, monkeypatch):
    fake = FakeSocketModule(ntp_reply(KNOWN_EPOCH))
    monkeypatch.setattr(service, '_socket', fake)

    assert service.query_ntp('pool.ntp.org') == KNOWN_EPOCH

    sent = [entry for entry in fake.recorder if entry[0] == 'sendto']
    assert len(sent) == 1
    packet = sent[0][1]
    assert len(packet) == 48
    assert packet[0] == 0x1B
    assert sent[0][2] == ('203.0.113.9', 123)
    assert fake.sockets[0].timeout == pytest.approx(1.5)


def test_query_ntp_closes_the_socket_on_success(service, monkeypatch):
    fake = FakeSocketModule(ntp_reply(KNOWN_EPOCH))
    monkeypatch.setattr(service, '_socket', fake)

    service.query_ntp('pool.ntp.org')

    assert fake.sockets[0].closed is True


def test_query_ntp_closes_the_socket_on_error(service, monkeypatch):
    fake = FakeSocketModule(ntp_reply(KNOWN_EPOCH), fail_on_recv=True)
    monkeypatch.setattr(service, '_socket', fake)

    with pytest.raises(OSError):
        service.query_ntp('pool.ntp.org')

    assert fake.sockets[0].closed is True


@pytest.mark.parametrize('reply', [b'', b'\x00' * 10, b'\x00' * 47])
def test_query_ntp_rejects_short_responses(service, monkeypatch, reply):
    fake = FakeSocketModule(reply)
    monkeypatch.setattr(service, '_socket', fake)

    with pytest.raises(OSError):
        service.query_ntp('pool.ntp.org')


def test_query_ntp_rejects_an_empty_timestamp(service, monkeypatch):
    fake = FakeSocketModule(bytes(48))
    monkeypatch.setattr(service, '_socket', fake)

    with pytest.raises(OSError):
        service.query_ntp('pool.ntp.org')


@pytest.mark.parametrize('host', ['', '   ', None])
def test_query_ntp_falls_back_to_the_default_server(service, monkeypatch, host):
    fake = FakeSocketModule(ntp_reply(KNOWN_EPOCH))
    monkeypatch.setattr(service, '_socket', fake)

    assert service.query_ntp(host) == KNOWN_EPOCH

    prompts = [entry for entry in fake.recorder if entry[0] == 'getaddrinfo']
    assert prompts[0][1] == service.DEFAULT_SERVER
    assert prompts[0][2] == 123


def test_query_ntp_uses_the_configured_host(service, monkeypatch):
    fake = FakeSocketModule(ntp_reply(KNOWN_EPOCH))
    monkeypatch.setattr(service, '_socket', fake)

    service.query_ntp('  time.example.org  ')

    prompts = [entry for entry in fake.recorder if entry[0] == 'getaddrinfo']
    assert prompts[0][1] == 'time.example.org'


def test_query_ntp_without_a_socket_module_raises_oserror(service, monkeypatch):
    monkeypatch.setattr(service, '_socket', None)

    with pytest.raises(OSError):
        service.query_ntp('pool.ntp.org')

def test_configuration_defaults(service):
    assert service.server() == 'pool.ntp.org'
    assert service.interval_minutes() == 60
    assert service.interval_seconds() == 3600
    assert service.timezone() == 0
    assert service.enabled() is True
    assert service.synced() is False
    assert service.age() == -1


def test_configure_stores_the_values(service):
    service.configure(
        server=' time.example.org ', interval_minutes=15, timezone_hours=2, enabled=False
    )

    assert service.server() == 'time.example.org'
    assert service.interval_minutes() == 15
    assert service.interval_seconds() == 900
    assert service.timezone() == 2
    assert service.enabled() is False


def test_configure_leaves_omitted_values_untouched(service):
    service.configure(interval_minutes=15)

    assert service.server() == 'pool.ntp.org'
    assert service.interval_minutes() == 15
    assert service.timezone() == 0


@pytest.mark.parametrize(
    ('requested', 'expected'),
    [(0, 1), (-5, 1), (1, 1), (1440, 1440), (5000, 1440), ('15', 15), (None, 60)],
)
def test_configure_clamps_the_interval(service, requested, expected):
    if requested is not None:
        service.configure(interval_minutes=requested)
    assert service.interval_minutes() == expected


def test_configure_treats_a_timezone_below_minus_twelve_as_inherit(service):
    service.configure(timezone_hours=2)
    service.configure(timezone_hours=-99)

    assert service.timezone() == 2


def test_configure_clamps_the_timezone_upper_bound(service):
    service.configure(timezone_hours=99)

    assert service.timezone() == 14


@pytest.mark.parametrize(
    ('argument', 'expected'),
    [(-100, 3), (-100.0, 3), (3, 3), (0, 0), (-5, -5), (14, 14), (-12, -12), (5.5, 5.5)],
)
def test_timezone_from_argument_resolves_the_sentinel(service, argument, expected):
    service.configure(timezone_hours=3)

    assert service.timezone_from_argument(argument) == expected


def test_timezone_from_argument_clamps_above_the_valid_range(service):
    service.configure(timezone_hours=3)

    assert service.timezone_from_argument(99) == 14
    assert service.timezone_from_argument(-99) == 3
    assert service.timezone_from_argument(None) == 3


@pytest.mark.parametrize('argument', [-1, -1.0, None, -42])
def test_epoch_or_now_resolves_the_sentinel(service, monkeypatch, argument):
    monkeypatch.setattr(service, 'now', lambda: 424242, raising=False)

    assert service.epoch_or_now(argument) == 424242


@pytest.mark.parametrize('argument', [0, 1, KNOWN_EPOCH, 1700000000.7])
def test_epoch_or_now_passes_literals_through(service, monkeypatch, argument):
    monkeypatch.setattr(service, 'now', lambda: 424242, raising=False)

    assert service.epoch_or_now(argument) == int(argument)


def test_configure_neither_fetches_nor_sleeps(service, monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError('configure must not fetch or sleep')

    monkeypatch.setattr(service, 'query_ntp', forbidden)
    monkeypatch.setattr(service._asyncio, 'sleep', forbidden)

    service.configure(
        server='pool.ntp.org', interval_minutes=60, timezone_hours=0, enabled=True
    )


class MonotonicCounter:
    """Stand-in for `_monotonic_ms` that the test advances by hand."""

    def __init__(self, start=1000):
        self.ms = start

    def __call__(self):
        return self.ms


def test_now_derives_from_the_epoch_base_and_the_monotonic_delta(service, monkeypatch):
    counter = MonotonicCounter()
    monkeypatch.setattr(service, '_monotonic_ms', counter)

    service.apply_epoch(KNOWN_EPOCH)
    assert service.now() == KNOWN_EPOCH

    counter.ms += 999
    assert service.now() == KNOWN_EPOCH

    counter.ms += 1
    assert service.now() == KNOWN_EPOCH + 1

    counter.ms += 5000
    assert service.now() == KNOWN_EPOCH + 6


def test_apply_epoch_marks_the_service_as_synced(service, monkeypatch):
    monkeypatch.setattr(service, '_monotonic_ms', MonotonicCounter())

    assert service.synced() is False
    service.apply_epoch(KNOWN_EPOCH)
    assert service.synced() is True
    assert service.epoch() == KNOWN_EPOCH


def test_age_grows_from_the_last_sync(service, monkeypatch):
    counter = MonotonicCounter()
    monkeypatch.setattr(service, '_monotonic_ms', counter)

    assert service.age() == -1

    service.apply_epoch(KNOWN_EPOCH)
    assert service.age() == 0

    counter.ms += 5000
    assert service.age() == 5


def test_a_second_sync_resets_the_age(service, monkeypatch):
    counter = MonotonicCounter()
    monkeypatch.setattr(service, '_monotonic_ms', counter)

    service.apply_epoch(KNOWN_EPOCH)
    counter.ms += 9000
    assert service.age() == 9

    service.apply_epoch(KNOWN_EPOCH + 9)
    assert service.age() == 0


def test_now_survives_a_ticks_ms_wrap(service, monkeypatch):
    mask = 0x3FFFFFFF
    counter = MonotonicCounter(mask - 5000)
    fake_time = types.SimpleNamespace(
        ticks_diff=lambda newer, older: (newer - older) & mask,
        ticks_ms=lambda: counter.ms,
    )
    monkeypatch.setattr(service, '_time', fake_time)
    monkeypatch.setattr(service, '_monotonic_ms', counter)

    service.apply_epoch(KNOWN_EPOCH)
    counter.ms = (mask - 5000 + 5500) & mask

    assert counter.ms < 1000, 'the test must actually cross the wrap'
    assert service.now() == KNOWN_EPOCH + 5


def test_now_without_a_sync_uses_the_port_clock(service, monkeypatch):
    monkeypatch.setattr(service, '_port_clock', lambda: 1234567)

    assert service.synced() is False
    assert service.now() == 1234567


def test_monotonic_prefers_ticks_ms(service, monkeypatch):
    monkeypatch.setattr(service, '_time', types.SimpleNamespace(ticks_ms=lambda: 4242))

    assert service._monotonic_ms() == 4242


def test_monotonic_falls_back_to_monotonic_seconds(service, monkeypatch):
    monkeypatch.setattr(service, '_time', types.SimpleNamespace(monotonic=lambda: 12.5))

    assert service._monotonic_ms() == 12500


def test_monotonic_without_a_time_module_is_zero(service, monkeypatch):
    monkeypatch.setattr(service, '_time', None)

    assert service._monotonic_ms() == 0


def test_port_clock_reads_the_platform_time(service, monkeypatch):
    monkeypatch.setattr(service, '_time', types.SimpleNamespace(time=lambda: KNOWN_EPOCH))

    assert service._port_clock() == KNOWN_EPOCH


def test_port_clock_without_a_time_module_is_zero(service, monkeypatch):
    monkeypatch.setattr(service, '_time', None)

    assert service._port_clock() == 0


class StopRun(Exception):
    """Raised by a fake sleep to end `_run()` at a known point."""


class SleepRecorder:
    """Fake `asyncio.sleep` recording every delay and bounding the loop."""

    def __init__(self, limit=None, on_sleep=None):
        self.calls = []
        self.limit = limit
        self.on_sleep = on_sleep

    async def __call__(self, seconds):
        self.calls.append(seconds)
        if self.on_sleep is not None:
            self.on_sleep(len(self.calls))
        if self.limit is not None and len(self.calls) >= self.limit:
            raise StopRun


def install_fake_machine(monkeypatch):
    """Install a `machine` stub whose RTC records every datetime() argument."""
    records = []
    machine = types.ModuleType('machine')

    class _RTC:
        def datetime(self, value=None):
            records.append(value)

    machine.RTC = _RTC
    monkeypatch.setitem(sys.modules, 'machine', machine)
    return records


def run_until_stopped(service, monkeypatch, recorder):
    """Drive `_run()` with a recording sleep that ends the loop."""
    monkeypatch.setattr(service._asyncio, 'sleep', recorder)
    with pytest.raises(StopRun):
        asyncio.run(service._run())


def test_run_applies_the_first_success_and_sets_the_device_clock(service, monkeypatch):
    clock_writes = install_fake_machine(monkeypatch)
    monkeypatch.setattr(service, 'query_ntp', lambda *args, **kwargs: KNOWN_EPOCH)
    monkeypatch.setattr(service, '_network_ready', lambda: True)
    recorder = SleepRecorder(limit=1)

    run_until_stopped(service, monkeypatch, recorder)

    assert service.synced() is True
    assert service.epoch() == KNOWN_EPOCH
    assert clock_writes == [(2023, 11, 14, 2, 22, 13, 20, 0)]


def test_run_retries_on_the_backoff_schedule_until_the_first_success(service, monkeypatch):
    responses = [OSError('boom'), OSError('boom'), OSError('boom'), KNOWN_EPOCH]

    def fake_query(*args, **kwargs):
        result = responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(service, 'query_ntp', fake_query)
    monkeypatch.setattr(service, '_network_ready', lambda: True)
    recorder = SleepRecorder(limit=4)

    run_until_stopped(service, monkeypatch, recorder)

    assert recorder.calls[:3] == [2, 4, 8]
    assert service.synced() is True


def test_failed_sync_keeps_the_previous_epoch(service, monkeypatch):
    monkeypatch.setattr(service, '_monotonic_ms', MonotonicCounter())
    service.apply_epoch(KNOWN_EPOCH)

    def boom(*args, **kwargs):
        raise OSError('boom')

    monkeypatch.setattr(service, 'query_ntp', boom)

    assert service._sync_once() is False
    assert service.epoch() == KNOWN_EPOCH


def test_failed_sync_logs_one_physical_line(service, monkeypatch, capsys):
    def boom(*args, **kwargs):
        raise OSError('timed out\non a wrapped line')

    monkeypatch.setattr(service, 'query_ntp', boom)

    assert service._sync_once() is False

    out = capsys.readouterr().out
    assert out.startswith('time: ')
    assert 'sync failed' in out
    assert out.count('\n') == 1


def test_disabled_service_never_fetches(service, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('a disabled service must not fetch')

    service.configure(enabled=False)
    monkeypatch.setattr(service, 'query_ntp', forbidden)
    monkeypatch.setattr(service, '_network_ready', lambda: True)
    recorder = SleepRecorder(limit=3)

    run_until_stopped(service, monkeypatch, recorder)

    assert recorder.calls == [1, 1, 1]
    assert service.synced() is False


def test_a_not_ready_network_never_fetches_and_keeps_backing_off(service, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('no fetch without a network')

    monkeypatch.setattr(service, 'query_ntp', forbidden)
    monkeypatch.setattr(service, '_network_ready', lambda: False)
    recorder = SleepRecorder(limit=4)

    run_until_stopped(service, monkeypatch, recorder)

    assert recorder.calls == [2, 4, 8, 16]
    assert service.synced() is False


def test_after_the_first_sync_the_next_fetch_waits_the_interval(service, monkeypatch):
    service.configure(interval_minutes=5)
    monkeypatch.setattr(service, 'query_ntp', lambda *args, **kwargs: KNOWN_EPOCH)
    monkeypatch.setattr(service, '_network_ready', lambda: True)
    recorder = SleepRecorder(limit=300)

    run_until_stopped(service, monkeypatch, recorder)

    assert len(recorder.calls) == 300
    assert set(recorder.calls) == {1}


def test_a_config_change_breaks_the_long_sleep_early(service, monkeypatch):
    monkeypatch.setattr(service, '_task', object())
    monkeypatch.setattr(service, '_network_ready', lambda: True)
    fetches = []

    def fake_query(*args, **kwargs):
        fetches.append(1)
        return KNOWN_EPOCH

    def on_sleep(count):
        if count == 2:
            service.configure(interval_minutes=1)
        if count >= 3:
            raise StopRun

    monkeypatch.setattr(service, 'query_ntp', fake_query)
    recorder = SleepRecorder(on_sleep=on_sleep)

    run_until_stopped(service, monkeypatch, recorder)

    assert len(fetches) == 2
    assert recorder.calls == [1, 1, 1]


def test_next_backoff_doubles_and_caps(service):
    assert service._next_backoff(2) == 4
    assert service._next_backoff(40) == 60
    assert service._next_backoff(60) == 60


def test_network_ready_without_a_network_module(service, monkeypatch):
    monkeypatch.setitem(sys.modules, 'network', None)

    assert service._network_ready() is True


def test_network_ready_reports_a_connected_station(service, monkeypatch):
    fake = types.ModuleType('network')
    fake.STA_IF = 0

    class _Station:
        def isconnected(self):
            return True

    fake.WLAN = lambda kind: _Station()
    monkeypatch.setitem(sys.modules, 'network', fake)

    assert service._network_ready() is True


def test_network_ready_reports_a_disconnected_station(service, monkeypatch):
    fake = types.ModuleType('network')
    fake.STA_IF = 0

    class _Station:
        def isconnected(self):
            return False

    fake.WLAN = lambda kind: _Station()
    monkeypatch.setitem(sys.modules, 'network', fake)

    assert service._network_ready() is False


def test_network_ready_reports_a_connected_lan(service, monkeypatch):
    fake = types.ModuleType('network')
    fake.STA_IF = 0
    fake.WLAN = lambda kind: None
    fake.LAN = lambda: types.SimpleNamespace(
        ifconfig=lambda: ('192.168.1.7', '255.255.255.0')
    )
    monkeypatch.setitem(sys.modules, 'network', fake)

    assert service._network_ready() is True


def test_start_creates_exactly_one_task(service, monkeypatch):
    started = []

    async def fake_run():
        started.append(1)
        await asyncio.Event().wait()

    monkeypatch.setattr(service, '_run', fake_run)

    async def scenario():
        first = service.start()
        second = service.start()
        third = service.start()

        assert first is not None
        assert first is second and second is third

        await asyncio.sleep(0)
        assert len(started) == 1

        service.stop()
        assert service._task is None

    asyncio.run(scenario())


def test_start_without_a_running_loop_returns_none(service):
    assert service.start() is None
    assert service._task is None


def test_configure_starts_the_task_from_inside_the_loop(service, monkeypatch):
    async def fake_run():
        await asyncio.Event().wait()

    monkeypatch.setattr(service, '_run', fake_run)

    async def scenario():
        service.configure(interval_minutes=30, timezone_hours=1)
        assert service._task is not None
        service.stop()

    asyncio.run(scenario())


def test_device_clock_is_set_to_local_time(service, monkeypatch):
    writes = install_fake_machine(monkeypatch)
    monkeypatch.setattr(service, '_monotonic_ms', lambda: 1000)
    service.configure(timezone_hours=2)
    service.apply_epoch(KNOWN_EPOCH)

    assert service._set_device_clock(service.now()) is True

    # 2023-11-15 00:13:20 local at +2; MicroPython weekday 3 is Wednesday.
    assert writes == [(2023, 11, 15, 3, 0, 13, 20, 0)]


def test_device_clock_uses_the_iso_weekday_plus_one(service, monkeypatch):
    writes = install_fake_machine(monkeypatch)

    # 2024-03-04 is a Monday, so the RTC field must be 1.
    monday = service._parts.days_from_civil(2024, 3, 4) * 86400 + 6 * 3600
    service._set_device_clock(monday)

    assert writes[0][:4] == (2024, 3, 4, 1)


def test_device_clock_without_a_machine_module_is_a_no_op(service, monkeypatch):
    monkeypatch.setitem(sys.modules, 'machine', None)

    assert service._set_device_clock(KNOWN_EPOCH) is False


def test_device_clock_swallows_an_oserror_from_the_rtc(service, monkeypatch):
    machine = types.ModuleType('machine')

    class _RTC:
        def datetime(self, value=None):
            raise OSError('no rtc')

    machine.RTC = _RTC
    monkeypatch.setitem(sys.modules, 'machine', machine)

    assert service._set_device_clock(KNOWN_EPOCH) is False


def test_device_clock_swallows_a_missing_rtc_attribute(service, monkeypatch):
    monkeypatch.setitem(sys.modules, 'machine', types.ModuleType('machine'))

    assert service._set_device_clock(KNOWN_EPOCH) is False


def test_package_reexports_parts_and_service():
    _drop_modules()
    sys.path.insert(0, str(PKG_ROOT / 'time'))
    try:
        import otter_time

        assert otter_time.__all__ == ['parts', 'service']
        assert otter_time.parts.__name__ == 'otter_time.parts'
        assert otter_time.service.__name__ == 'otter_time.service'
    finally:
        sys.path.remove(str(PKG_ROOT / 'time'))
        _drop_modules()


def test_service_imports_without_device_only_modules(service):
    # `machine`, `network` and `uasyncio` do not exist on CPython; the module must
    # still import and fall back to the host equivalents.
    assert service._socket is not None
    assert service._asyncio is not None
    assert not hasattr(service, 'machine')

