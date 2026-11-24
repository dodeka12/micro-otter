import asyncio
import importlib.util
from pathlib import Path

SERVICE_CONTROLLER_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "service_controller.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "service_controller_under_test", SERVICE_CONTROLLER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


MODULE = _load_module()


class FakeService(MODULE.NetworkService):
    def __init__(
        self,
        name="svc",
        *,
        enabled=True,
        running=False,
        ready=None,
        start_error=None,
        stop_error=None,
        enabled_error=None,
        running_error=None,
        ready_error=None,
    ):
        self.name = name
        self.calls = []
        self._enabled = enabled
        self._running = running
        self._ready = ready
        self._start_error = start_error
        self._stop_error = stop_error
        self._enabled_error = enabled_error
        self._running_error = running_error
        self._ready_error = ready_error

    def enabled(self):
        if self._enabled_error is not None:
            raise self._enabled_error
        return self._enabled

    def running(self):
        if self._running_error is not None:
            raise self._running_error
        return self._running

    def transport_ready(self, network):
        if self._ready_error is not None:
            raise self._ready_error
        if self._ready is not None:
            return self._ready
        return super().transport_ready(network)

    async def start(self, network):
        self.calls.append(("start", dict(network)))
        if self._start_error is not None:
            raise self._start_error
        self._running = True

    async def stop(self):
        self.calls.append(("stop",))
        if self._stop_error is not None:
            raise self._stop_error
        self._running = False


def _run(coro):
    return asyncio.run(coro)


def test_enabled_service_starts_once_when_station_ready():
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.calls == [("start", {"sta_connected": True, "ap_active": False})]
    assert service.running() is True


def test_disabled_service_never_starts():
    service = FakeService(enabled=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.calls == []


def test_disabled_but_running_service_is_stopped():
    service = FakeService(enabled=False, running=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.calls == [("stop",)]


def test_skip_line_reports_the_service_disabled_reason(capsys):
    class DetailedService(FakeService):
        def disabled_reason(self):
            return "enabled=false in /mqtt_settings.json"

    service = DetailedService(enabled=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    # "skip mqtt: disabled" alone cannot be told apart from a broken adapter.
    assert (
        "[info] service-controller: skip svc: disabled (enabled=false in /mqtt_settings.json)"
        in out
    )


def test_skip_line_without_a_disabled_reason_stays_plain(capsys):
    service = FakeService(enabled=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert "[info] service-controller: skip svc: disabled\n" in capsys.readouterr().out


def test_unchanged_disabled_reason_is_reported_once(capsys):
    class DetailedService(FakeService):
        def disabled_reason(self):
            return "runtime import failed"

    controller = MODULE.ServiceController([DetailedService(enabled=False)])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    assert out.count("skip svc: disabled (runtime import failed)") == 1


def test_raising_disabled_reason_falls_back_to_plain_disabled(capsys):
    class BrokenService(FakeService):
        def disabled_reason(self):
            raise RuntimeError("boom")

    controller = MODULE.ServiceController([BrokenService(enabled=False)])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert "[info] service-controller: skip svc: disabled\n" in capsys.readouterr().out


def test_enabled_service_with_no_transport_does_not_start():
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": False, "ap_active": False}))

    assert service.calls == []


def test_transport_ready_override_allows_start_when_network_down():
    service = FakeService(enabled=True, ready=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": False, "ap_active": False}))

    assert service.calls == [("start", {"sta_connected": False, "ap_active": False})]


def test_sync_is_idempotent_for_running_service():
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.calls == [("start", {"sta_connected": True, "ap_active": False})]


def test_start_failure_does_not_block_next_service():
    failing = FakeService("first", enabled=True, start_error=RuntimeError("boom"))
    healthy = FakeService("second", enabled=True)
    controller = MODULE.ServiceController([failing, healthy])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert ("start",) in {call[:1] for call in healthy.calls}
    assert healthy.running() is True
    assert failing.running() is False


def test_transport_down_stops_running_service_and_restarts_on_up():
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.sync({"sta_connected": False, "ap_active": False}))
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.calls == [
        ("start", {"sta_connected": True, "ap_active": False}),
        ("stop",),
        ("start", {"sta_connected": True, "ap_active": False}),
    ]


def test_shutdown_stops_running_services_and_swallows_stop_error():
    service = FakeService(enabled=True)
    broken = FakeService("broken", enabled=True, running=True, stop_error=RuntimeError("boom"))
    controller = MODULE.ServiceController([service, broken])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.shutdown())

    assert service.running() is False


def test_status_callback_receives_events():
    events = []
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController(
        [service], status_callback=lambda state, **fields: events.append((state, fields))
    )

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert ("service-started", {"service": "svc"}) in events


def test_raising_status_callback_does_not_abort_sync():
    service = FakeService(enabled=True)

    def callback(state, **fields):
        raise RuntimeError("callback boom")

    controller = MODULE.ServiceController([service], status_callback=callback)

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert service.running() is True


def test_skip_reason_logged_once_per_change(capsys):
    service = FakeService(enabled=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    assert out.count("[info] service-controller: skip svc: disabled") == 1


def test_skip_reason_relogged_after_transition(capsys):
    service = FakeService(enabled=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    service._enabled = True
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    # The service dropped on its own, then was disabled again.
    service._running = False
    service._enabled = False
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    assert out.count("[info] service-controller: skip svc: disabled") == 2


def test_transport_skip_reason_names_network_state(capsys):
    service = FakeService(enabled=True, ready=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": False, "ap_active": True}))

    out = capsys.readouterr().out
    assert (
        "[info] service-controller: skip svc: "
        "transport not ready (sta_connected=False ap_active=True)" in out
    )


def test_transport_change_relogs_skip_reason(capsys):
    service = FakeService(enabled=True, ready=False)
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": False, "ap_active": True}))
    _run(controller.sync({"sta_connected": False, "ap_active": False}))

    out = capsys.readouterr().out
    assert "sta_connected=False ap_active=True" in out
    assert "sta_connected=False ap_active=False" in out


def test_stopping_service_is_logged_with_reason(capsys):
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    capsys.readouterr()

    _run(controller.sync({"sta_connected": False, "ap_active": False}))

    out = capsys.readouterr().out
    assert (
        "[info] service-controller: stopping svc "
        "(transport not ready (sta_connected=False ap_active=False))" in out
    )


def test_shutdown_logs_stopping(capsys):
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    capsys.readouterr()

    _run(controller.shutdown())

    out = capsys.readouterr().out
    assert "[info] service-controller: stopping svc" in out


def test_enabled_error_does_not_escape_sync(capsys):
    broken = FakeService("first", enabled_error=RuntimeError("enabled boom"))
    healthy = FakeService("second", enabled=True)
    controller = MODULE.ServiceController([broken, healthy])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert healthy.running() is True
    out = capsys.readouterr().out
    assert "[error] service-controller: first state check failed (enabled boom)" in out


def test_running_error_does_not_escape_sync():
    broken = FakeService("first", running_error=RuntimeError("running boom"))
    healthy = FakeService("second", enabled=True)
    controller = MODULE.ServiceController([broken, healthy])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert healthy.running() is True


def test_transport_ready_error_does_not_escape_sync():
    broken = FakeService("first", ready_error=RuntimeError("ready boom"))
    healthy = FakeService("second", enabled=True)
    controller = MODULE.ServiceController([broken, healthy])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    assert healthy.running() is True


def test_state_check_failure_logged_once(capsys):
    service = FakeService(enabled_error=RuntimeError("boom"))
    controller = MODULE.ServiceController([service])

    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    assert out.count("[error] service-controller: svc state check failed (boom)") == 1


def test_state_check_failure_relogged_after_recovery(capsys):
    service = FakeService(enabled=True)
    controller = MODULE.ServiceController([service])
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    capsys.readouterr()

    service._running_error = RuntimeError("boom")
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    service._running_error = None
    _run(controller.sync({"sta_connected": True, "ap_active": False}))
    service._running_error = RuntimeError("boom")
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    out = capsys.readouterr().out
    assert out.count("[error] service-controller: svc state check failed (boom)") == 2


def test_shutdown_survives_running_error():
    broken = FakeService("first", running_error=RuntimeError("running boom"))
    healthy = FakeService("second", enabled=True)
    controller = MODULE.ServiceController([broken, healthy])
    _run(controller.sync({"sta_connected": True, "ap_active": False}))

    _run(controller.shutdown())

    assert healthy.running() is False
    assert ("stop",) in healthy.calls
