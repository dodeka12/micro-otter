# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
import sys
try:
    import utime as _time
except ImportError:  # pragma: no cover - fallback for host tooling
    import time as _time  # type: ignore

try:
    from io import StringIO
except ImportError:  # pragma: no cover - MicroPython alias
    from uio import StringIO  # type: ignore

try:
    import ujson as json
except ImportError:  # pragma: no cover - fallback for host tooling
    import json  # type: ignore


_TRACE_FALLBACK_TOKEN = "<<NL>>"

_MAIN_LOOP_MAX_RESTARTS = 3
_MAIN_LOOP_RESTART_WINDOW_MS = 30000
_MAIN_LOOP_MODULE = "app.main_loop"

# MicroPython drops a task nobody references, so background tasks must be kept
# in a module-level list rather than in a local variable of main().
_RUNTIME_BACKGROUND_TASKS = []
_RUNTIME_SERVICE_CONTROLLER = None


def _collapse_trace_text(trace: str, line_token: str) -> str:
    normalized = trace.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    while lines and lines[-1] == "":
        lines.pop()
    if not lines:
        return ""
    return line_token.join(lines)


def _print_prefixed_traceback(
    exc: BaseException,
    line_token: str,
    *,
    fallback_message: str = "Runtime startup failed before logger initialization",
) -> None:
    buffer = None
    try:
        buffer = StringIO()
        sys.print_exception(exc, buffer)
        trace = buffer.getvalue()
    except Exception:
        trace = repr(exc)
    finally:
        if buffer is not None:
            try:
                buffer.close()
            except Exception:
                pass
    collapsed = _collapse_trace_text(trace, line_token)
    if not collapsed:
        _emit_fallback_error("(no traceback available)", message=fallback_message)
        return
    _emit_fallback_error(collapsed, message=fallback_message)


def _print_serial_traceback(exc: BaseException) -> None:
    try:
        sys.print_exception(exc)
    except Exception:
        try:
            print("[error] otter-main:", repr(exc))
        except Exception:
            pass


def _ticks_ms() -> int:
    if hasattr(_time, "ticks_ms"):
        return _time.ticks_ms()  # type: ignore[attr-defined]
    if hasattr(_time, "time"):
        return int(_time.time() * 1000)  # type: ignore[attr-defined]
    return 0


def _ticks_diff(current: int, previous: int) -> int:
    if hasattr(_time, "ticks_diff"):
        return _time.ticks_diff(current, previous)  # type: ignore[attr-defined]
    return current - previous


def _emit_fallback_error(
    exception_text: str,
    *,
    message: str = "Runtime startup failed before logger initialization",
    **fields,
) -> None:
    payload = {
        "event": "fatal",
        "level": "error",
        "message": message,
        "exception": exception_text,
    }
    payload.update(fields)
    try:
        print("[otter]", json.dumps(payload))
    except Exception:
        # Plain fallback: the JSON encoder failed, so collapse the trace into one
        # line to keep the [error] tag on the whole entry.
        text = str(exception_text).replace("\r", " ").replace("\n", " ")
        print("[error] otter-main: {}".format(text))


def _dump_io_queue() -> None:
    """Best-effort dump of the asyncio I/O queue.

    Used to identify which stream (socket or I2S) was still registered when the
    scheduler's poller raised (e.g. ``OSError: EPERM``), so a dead file
    descriptor can be attributed to a specific subsystem.
    """
    try:
        _asyncio = globals().get("asyncio")
        if _asyncio is None:
            import uasyncio as _asyncio
        core = getattr(_asyncio, "core", None)
        if core is None:
            import uasyncio.core as core
        ioq = getattr(core, "_io_queue", None)
        if ioq is None:
            print("[data] io-queue: _io_queue not available")
            return
        mp = getattr(ioq, "map", None)
        if mp is None:
            print("[data] io-queue: no map attribute")
            return
        print("[data] io-queue: {} registered stream(s)".format(len(mp)))
        for key in mp:
            try:
                entry = mp[key]
                stream = entry[2] if len(entry) > 2 else None
                sock = getattr(stream, "s", None)
                print("[data] io-queue:   stream={} sock={}".format(stream, sock))
            except Exception as exc:
                print("[data] io-queue:   <unprintable stream>: {}".format(exc))
    except Exception as exc:
        print("[warning] io-queue: dump failed ({})".format(exc))


try:
    try:
        import machine as _machine  # type: ignore
    except ImportError:
        _machine = None

    import otter_runtime.service_controller as service_controller
    import otter_runtime.services as runtime_services
    import otter_runtime.wifi_boot as wifi_boot
    import uasyncio as asyncio
    from otter_runtime.module_utils import reload_module
    from tools.runtime_log import (
        TRACE_LINE_BREAK_TOKEN,
        describe_exception,
        log_error,
        log_event,
        log_exception,
        log_plain,
        log_startup,
        log_wifi_state,
    )
    from tools.wifi_manager import (
        WIFI_SETTINGS_FILE,
        WifiSettingsError,
        load_wifi_profiles,
        load_wifi_reconnect_interval,
    )

    def _read_reset_cause_info():
        if _machine is None or not hasattr(_machine, "reset_cause"):
            return None

        try:
            cause_code = _machine.reset_cause()
        except Exception:
            return None

        cause_label = "unknown"
        known_causes = [
            ("PWRON_RESET", "power-on"),
            ("HARD_RESET", "hard-reset"),
            ("WDT_RESET", "watchdog"),
            ("DEEPSLEEP_RESET", "deepsleep"),
            ("SOFT_RESET", "soft-reset"),
            ("BROWN_OUT_RESET", "brownout"),
        ]

        for attr_name, label in known_causes:
            attr_value = getattr(_machine, attr_name, None)
            if attr_value is not None and cause_code == attr_value:
                cause_label = label
                break

        return {
            "code": cause_code,
            "label": cause_label,
        }

    class UserError(Exception):
        """Custom exception for user-related errors."""

        pass

    _main_loop_reload_requested = False

    def request_main_loop_reload() -> None:
        """Signal the running app.main_loop task to reload."""
        global _main_loop_reload_requested
        _main_loop_reload_requested = True
        log_event("controller", message="Main loop reload scheduled")

    def _wifi_callback(state: str, **fields) -> None:
        log_wifi_state(state, **fields)

    def _service_callback(state: str, **fields) -> None:
        log_event("service", state=state, **fields)

    def _network_from(boot):
        return {
            "host_ip": boot["host_ip"],
            "sta_connected": bool(boot["sta_connected"]),
            "ap_active": bool(boot["ap_active"]),
            "ap_ip": boot.get("ap_ip", ""),
        }

    def _log_main_loop_failure(
        event: str,
        exc: BaseException,
        message: str,
        **fields,
    ) -> None:
        """Report a main-loop failure as one short ``[error]`` line plus the JSON trace.

        Without the plain line a failed ``app.main_loop`` import only produced the
        machine-readable ``[otter]`` event, which reads like a normal log entry, so a
        device that never started its app looked like it booted cleanly.
        """

        log_plain("error", "controller", "{} ({})".format(message, describe_exception(exc)))
        log_exception(event, exc, module=_MAIN_LOOP_MODULE, **fields)

    async def _collect_task_failure(task):
        """Stop *task* and return the exception it ended with, or ``None``.

        MicroPython's ``uasyncio.Task`` has no ``exception()`` method (CPython's has),
        so awaiting the finished task is the only supported way to learn why it
        stopped: the scheduler returns the result or re-raises what the task raised.
        ``CancelledError`` is returned rather than raised so the caller can tell a stop
        request apart from a crash, and a completed task is not cancelled again.
        """

        if task is None:
            return None
        if not task.done():
            task.cancel()
        try:
            await task
        except BaseException as exc:
            return exc
        return None

    async def main() -> None:
        log_startup("main-enter", message="main() coroutine starting")
        try:
            log_startup("wifi-settings", message="Loading WiFi settings")
            profiles = load_wifi_profiles()
            log_wifi_state(
                "settings-loaded",
                settings_file=WIFI_SETTINGS_FILE,
                sta_enabled=bool(profiles["sta"]["enabled"]),
                ap_enabled=bool(profiles["ap"]["enabled"]),
                sta_ssid=profiles["sta"]["ssid"],
                ap_ssid=profiles["ap"]["ssid"],
                message="WiFi settings loaded",
            )
        except WifiSettingsError as exc:
            # Missing settings should not prevent runtime startup; continue without WiFi.
            log_error(
                "WiFi not configured",
                reason="missing-or-invalid-wifi-settings",
                detail=str(exc),
                hint="Set the WiFi SSID and password in the device view, then hard reset.",
            )
            log_wifi_state(
                "not-configured",
                reason="missing-or-invalid-wifi-settings",
                detail=str(exc),
            )
            log_plain(
                "warning",
                "wifi",
                "disabled; continuing without WiFi ({})".format(describe_exception(exc)),
            )
            profiles = {
                "sta": {"enabled": False, "ssid": "", "password": ""},
                "ap": {"enabled": False, "ssid": "", "password": ""},
            }

        log_wifi_state(
            "config",
            settings_file=WIFI_SETTINGS_FILE,
            sta_enabled=bool(profiles["sta"]["enabled"]),
            ap_enabled=bool(profiles["ap"]["enabled"]),
            sta_ssid=profiles["sta"]["ssid"],
            ap_ssid=profiles["ap"]["ssid"],
        )

        reconnect_interval_s = load_wifi_reconnect_interval()

        boot = await wifi_boot.bring_up_wifi(profiles, status_callback=_wifi_callback)
        boot_errors = boot.get("errors") or {}
        for mode in ("sta", "ap"):
            if boot_errors.get(mode):
                log_wifi_state(
                    "unavailable",
                    mode=mode,
                    enabled=True,
                    message=boot_errors[mode],
                )
        if not boot["sta_enabled"] and not boot["ap_enabled"]:
            log_wifi_state(
                "disabled",
                enabled=False,
                message="WiFi disabled via settings",
            )

        host_ip = boot["host_ip"]
        wifi_enabled = bool(boot["sta_enabled"] or boot["ap_enabled"])
        wifi_supported = bool(boot["sta_interface"] or boot["ap_interface"])

        controller = service_controller.ServiceController(
            runtime_services.build_runtime_services(),
            status_callback=_service_callback,
        )
        global _RUNTIME_SERVICE_CONTROLLER
        _RUNTIME_SERVICE_CONTROLLER = controller

        log_startup(
            "net-ready",
            host_ip=host_ip,
            sta_enabled=boot["sta_enabled"],
            ap_enabled=boot["ap_enabled"],
            sta_connected=bool(boot["sta_connected"]),
            ap_active=bool(boot["ap_active"]),
        )
        await controller.sync(_network_from(boot))
        log_startup("services-synced", message="Network services synchronized")

        async def _handle_late_station_connect(ip: str) -> None:
            log_wifi_state(
                "station-late-connect",
                ip=ip,
                message="Station connected after boot",
            )
            await controller.sync(_network_from(boot))

        async def _handle_transport_down() -> None:
            log_wifi_state("station-link-down", message="Station link dropped")
            await controller.sync(_network_from(boot))

        if boot["sta_enabled"]:
            _RUNTIME_BACKGROUND_TASKS.append(
                asyncio.create_task(
                    wifi_boot.station_supervisor(
                        boot,
                        on_late_connect=_handle_late_station_connect,
                        on_transport_down=_handle_transport_down,
                        retry_interval_ms=reconnect_interval_s * 1000,
                        status_callback=_wifi_callback,
                    )
                )
            )

        resync_interval_s = runtime_services.load_mqtt_resync_interval_s()

        async def _service_sync_loop():
            while True:
                await asyncio.sleep_ms(resync_interval_s * 1000)
                await controller.sync(_network_from(boot))

        _RUNTIME_BACKGROUND_TASKS.append(asyncio.create_task(_service_sync_loop()))

        main_loop_module_name = _MAIN_LOOP_MODULE
        main_loop_task = None
        main_loop_restart_ticks = []

        async def _start_main_loop_task() -> bool:
            nonlocal main_loop_task
            try:
                module = reload_module(main_loop_module_name)
            except BaseException as exc:
                _log_main_loop_failure(
                    "controller-main-loop-load-failed",
                    exc,
                    "main loop load failed; the app did not start - check that "
                    "app/main_loop.py is valid",
                )
                main_loop_task = None
                return False

            log_event(
                "controller",
                message="Main loop start delayed for startup stabilization",
                delay_ms=2000,
            )
            await asyncio.sleep_ms(2000)
            log_event("controller", message="Starting main loop task", module=main_loop_module_name)
            try:
                main_loop_task = asyncio.create_task(module.run())
            except BaseException as exc:
                _log_main_loop_failure(
                    "controller-main-loop-task-create-failed",
                    exc,
                    "main loop task create failed; the app did not start",
                )
                main_loop_task = None
                return False

            return True

        async def _stop_main_loop_task():
            """Cancel the main loop task and return the exception it ended with.

            ``None`` means it returned normally; a ``CancelledError`` instance means it
            was stopped. MicroPython offers no ``Task.exception``, hence the await.
            """

            nonlocal main_loop_task
            task = main_loop_task
            if not task:
                return None
            main_loop_task = None
            failure = await _collect_task_failure(task)
            if failure is not None and not isinstance(failure, asyncio.CancelledError):
                log_event(
                    "controller",
                    message="Main loop task stopped with exception",
                    error=str(failure),
                )
            return failure

        await _start_main_loop_task()

        log_startup(
            "ready",
            message="Runtime startup finished",
            host_ip=host_ip,
            wifi_enabled=wifi_enabled,
            wifi_supported=wifi_supported,
        )

        try:
            while True:
                global _main_loop_reload_requested
                if _main_loop_reload_requested:
                    _main_loop_reload_requested = False
                    log_event("controller", message="Performing scheduled reload")
                    await _stop_main_loop_task()
                    restart_started = await _start_main_loop_task()
                    if not restart_started:
                        log_error(
                            "Main loop reload failed; web server remains active",
                            module=main_loop_module_name,
                        )
                elif main_loop_task and main_loop_task.done():
                    # MicroPython's Task has no exception(): awaiting the finished task
                    # is what surfaces why it stopped.
                    failure = await _stop_main_loop_task()

                    if isinstance(failure, asyncio.CancelledError):
                        log_event("controller", message="Main loop cancelled; execution remains stopped")
                        continue
                    if isinstance(failure, KeyboardInterrupt):
                        log_event("controller", message="Main loop interrupted; execution remains stopped")
                        continue

                    now_ticks = _ticks_ms()
                    main_loop_restart_ticks = [
                        tick
                        for tick in main_loop_restart_ticks
                        if _ticks_diff(now_ticks, tick) <= _MAIN_LOOP_RESTART_WINDOW_MS
                    ]
                    main_loop_restart_ticks.append(now_ticks)

                    if failure is not None:
                        _log_main_loop_failure(
                            "controller-main-loop-raised",
                            failure,
                            "main loop raised; reloading",
                            restarts=len(main_loop_restart_ticks),
                        )

                    if len(main_loop_restart_ticks) > _MAIN_LOOP_MAX_RESTARTS:
                        log_plain(
                            "error",
                            "controller",
                            "main loop restart limit reached; the runtime stays stopped",
                        )
                        log_error(
                            "Main loop restart limit reached; keeping runtime stopped",
                            restarts=len(main_loop_restart_ticks),
                            window_ms=_MAIN_LOOP_RESTART_WINDOW_MS,
                        )
                        continue

                    backoff_ms = min(1000 * len(main_loop_restart_ticks), 5000)
                    log_event(
                        "controller",
                        message="Main loop ended unexpectedly; reloading",
                        restarts=len(main_loop_restart_ticks),
                        backoff_ms=backoff_ms,
                    )
                    await asyncio.sleep_ms(backoff_ms)
                    restart_started = await _start_main_loop_task()
                    if not restart_started:
                        log_error(
                            "Main loop restart failed; web server remains active",
                            module=main_loop_module_name,
                        )

                await asyncio.sleep_ms(200)
        finally:
            await _stop_main_loop_task()
            await controller.shutdown()

    def run() -> None:
        """Start the runtime controller explicitly.

        Importing this module is side-effect free; startup begins only when
        this function is called.
        """

        global _TRACE_FALLBACK_TOKEN

        log_startup("import", message="Main module imported; initializing controller")

        reset_info = _read_reset_cause_info()
        if isinstance(reset_info, dict):
            log_startup(
                "reset-cause",
                message="Device reset cause detected",
                reset_cause_code=reset_info.get("code"),
                reset_cause_label=reset_info.get("label"),
            )

        try:
            log_startup("loop", message="Launching asyncio loop")
            asyncio.run(main())
            log_startup("main-exit", message="main() coroutine exited")
        except UserError as ue:
            try:
                log_exception("fatal-user", ue)
            finally:
                _print_serial_traceback(ue)
        except BaseException as exc:
            _dump_io_queue()
            try:
                log_exception("fatal", exc)
            finally:
                _print_serial_traceback(exc)

        _TRACE_FALLBACK_TOKEN = TRACE_LINE_BREAK_TOKEN
except BaseException as fatal_exc:
    if "log_exception" in globals():
        try:
            log_exception("import-error", fatal_exc, module="micro_otter_main")
        except BaseException:
            _print_prefixed_traceback(fatal_exc, _TRACE_FALLBACK_TOKEN)
    else:
        _print_prefixed_traceback(
            fatal_exc,
            _TRACE_FALLBACK_TOKEN,
        )
    raise

# Following a normal Exception or main() exiting, reset the board.
# Following a non-Exception error such as KeyboardInterrupt (Ctrl-C),
# this code will drop to a REPL. Place machine.reset() in a finally
# block to always reset, instead.
# Uncomment the next line to always reset after main() or an Exception.
# machine.reset()
