"""A main loop that cannot start must announce itself as ``[error]``.

The generated ``app/main_loop.py`` once failed to compile on the device. The runtime
reported it only through ``tools.runtime_log.log_exception``, which prints the
machine-readable ``[otter] {...}`` event: that lands in the generic "otter" log filter,
so the boot looked clean while the app never ran. These tests pin the plain
``[error] controller: ...`` line and the JSON trace that accompanies it.
"""

import asyncio
import importlib.util
import json
import pathlib
import sys
import types

DEVICE_ROOT = (
    pathlib.Path(__file__).resolve().parents[1] / 'src' / 'micro_otter' / 'nodes' / 'device'
)
RUNTIME_GENERAL = DEVICE_ROOT / 'runtime' / 'general'
OTTER_MAIN_PATH = RUNTIME_GENERAL / 'otter_main.py'
RUNTIME_LOG_PATH = DEVICE_ROOT / 'tools' / 'runtime_log.py'


def _load_runtime_log():
    spec = importlib.util.spec_from_file_location('runtime_log_under_test', RUNTIME_LOG_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_otter_main(monkeypatch):
    """Import ``otter_main.py`` with the on-device modules stubbed out."""

    runtime_log = _load_runtime_log()

    uasyncio = types.ModuleType('uasyncio')
    uasyncio.CancelledError = type('CancelledError', (Exception,), {})

    async def sleep_ms(_ms):
        return None

    uasyncio.sleep_ms = sleep_ms
    uasyncio.create_task = lambda coro: None
    uasyncio.run = lambda coro: None

    otter_runtime = types.ModuleType('otter_runtime')
    otter_runtime.__path__ = [str(RUNTIME_GENERAL / 'otter_runtime')]

    service_controller = types.ModuleType('otter_runtime.service_controller')
    service_controller.ServiceController = object
    otter_runtime.service_controller = service_controller

    services = types.ModuleType('otter_runtime.services')
    otter_runtime.services = services

    wifi_boot = types.ModuleType('otter_runtime.wifi_boot')
    otter_runtime.wifi_boot = wifi_boot

    module_utils = types.ModuleType('otter_runtime.module_utils')
    module_utils.reload_module = lambda name: types.ModuleType(name)

    wifi_manager = types.ModuleType('tools.wifi_manager')
    wifi_manager.WIFI_SETTINGS_FILE = 'wifi_settings.json'
    wifi_manager.WifiSettingsError = type('WifiSettingsError', (Exception,), {})
    wifi_manager.load_wifi_profiles = lambda *args, **kwargs: {}
    wifi_manager.load_wifi_reconnect_interval = lambda *args, **kwargs: 30

    tools = types.ModuleType('tools')
    tools.runtime_log = runtime_log
    tools.wifi_manager = wifi_manager

    stubs = {
        'uasyncio': uasyncio,
        'otter_runtime': otter_runtime,
        'otter_runtime.service_controller': service_controller,
        'otter_runtime.services': services,
        'otter_runtime.wifi_boot': wifi_boot,
        'otter_runtime.module_utils': module_utils,
        'tools': tools,
        'tools.runtime_log': runtime_log,
        'tools.wifi_manager': wifi_manager,
    }
    for name, module in stubs.items():
        monkeypatch.setitem(sys.modules, name, module)

    spec = importlib.util.spec_from_file_location('otter_main_under_test', OTTER_MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _json_event(stdout):
    """Return the ``[otter] {json}`` payload from captured output."""

    marker = '[otter] '
    assert marker in stdout, stdout
    return json.loads(stdout.split(marker, 1)[1].strip())


def test_broken_app_is_announced_with_an_error_prefix(monkeypatch, capsys):
    module = _load_otter_main(monkeypatch)

    module._log_main_loop_failure(
        'controller-main-loop-load-failed',
        SyntaxError('invalid syntax'),
        'main loop load failed; the app did not start',
    )

    out = capsys.readouterr().out
    assert (
        '[error] controller: main loop load failed; the app did not start '
        '(SyntaxError: invalid syntax)' in out
    )


def test_error_line_keeps_the_json_trace_for_diagnostics(monkeypatch, capsys):
    module = _load_otter_main(monkeypatch)

    module._log_main_loop_failure(
        'controller-main-loop-load-failed',
        SyntaxError('invalid syntax'),
        'main loop load failed; the app did not start',
    )

    payload = _json_event(capsys.readouterr().out)
    assert payload['event'] == 'controller-main-loop-load-failed'
    assert payload['level'] == 'error'
    assert payload['module'] == 'app.main_loop'
    assert 'SyntaxError' in payload['exception']


def test_error_line_carries_extra_fields(monkeypatch, capsys):
    module = _load_otter_main(monkeypatch)

    module._log_main_loop_failure(
        'controller-main-loop-raised',
        RuntimeError('boom'),
        'main loop raised; reloading',
        restarts=2,
    )

    out = capsys.readouterr().out
    assert '[error] controller: main loop raised; reloading (RuntimeError: boom)' in out
    payload = _json_event(out)
    assert payload['event'] == 'controller-main-loop-raised'
    assert payload['restarts'] == 2


def test_error_line_stays_one_short_line_for_a_long_traceback(monkeypatch, capsys):
    module = _load_otter_main(monkeypatch)
    detail = 'line one\nline two\n' + ('x' * 400)

    module._log_main_loop_failure(
        'controller-main-loop-load-failed',
        ValueError(detail),
        'main loop load failed; the app did not start',
    )

    out = capsys.readouterr().out
    plain_lines = [line for line in out.splitlines() if line.startswith('[error] controller:')]
    assert len(plain_lines) == 1
    assert plain_lines[0].endswith('...)')
    assert 'line two' in _json_event(out)['exception']


def test_stubbed_runtime_exposes_the_helper_used_by_the_controller(monkeypatch):
    module = _load_otter_main(monkeypatch)

    assert callable(module._log_main_loop_failure)
    assert callable(module.main)
    assert callable(module.run)


def test_describe_exception_collapses_newlines_and_truncates():
    runtime_log = _load_runtime_log()

    assert runtime_log.describe_exception(RuntimeError('a\nb\rc'), limit=40) == (
        'RuntimeError: a b c'
    )
    assert runtime_log.describe_exception(RuntimeError('x' * 50), limit=10) == 'Runtime...'


def test_log_plain_never_breaks_the_runtime(monkeypatch):
    runtime_log = _load_runtime_log()

    def boom(*args, **kwargs):
        raise OSError('serial gone')

    monkeypatch.setattr('builtins.print', boom)

    runtime_log.log_plain('error', 'controller', 'main loop load failed')


def test_collect_task_failure_returns_what_a_finished_task_raised(monkeypatch):
    module = _load_otter_main(monkeypatch)
    error = AttributeError("'str' object has no attribute 'isalnum'")

    async def scenario():
        async def app():
            raise error

        task = asyncio.ensure_future(app())
        await asyncio.sleep(0)
        return await module._collect_task_failure(task)

    assert asyncio.run(scenario()) is error


def test_collect_task_failure_returns_none_for_a_task_that_returned(monkeypatch):
    module = _load_otter_main(monkeypatch)

    async def scenario():
        async def app():
            return 'finished'

        task = asyncio.ensure_future(app())
        await asyncio.sleep(0)
        return await module._collect_task_failure(task)

    assert asyncio.run(scenario()) is None


def test_collect_task_failure_stops_a_running_task(monkeypatch):
    module = _load_otter_main(monkeypatch)

    async def scenario():
        async def app():
            await asyncio.sleep(30)

        task = asyncio.ensure_future(app())
        await asyncio.sleep(0)
        assert task.done() is False
        return await module._collect_task_failure(task)

    assert isinstance(asyncio.run(scenario()), asyncio.CancelledError)


def test_collect_task_failure_accepts_a_missing_task(monkeypatch):
    module = _load_otter_main(monkeypatch)

    async def scenario():
        return await module._collect_task_failure(None)

    assert asyncio.run(scenario()) is None


def test_task_without_exception_still_reports_its_failure(monkeypatch):
    """MicroPython's ``Task`` has no ``exception()``: awaiting it is the supported path."""

    module = _load_otter_main(monkeypatch)
    error = RuntimeError('main loop exploded')

    class TaskWithoutException:
        """Stand-in for ``uasyncio.Task``: ``done``/``cancel``/``__await__``, nothing else."""

        def done(self):
            return True

        def cancel(self):
            raise AssertionError('a finished task must not be cancelled again')

        def __await__(self):
            if False:  # pragma: no cover - keeps this method a generator
                yield
            raise error

    assert asyncio.run(module._collect_task_failure(TaskWithoutException())) is error
