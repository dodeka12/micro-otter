# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""MQTT adapter for the network-service controller."""

from otter_runtime.service_controller import NetworkService


class MqttService(NetworkService):
    name = "mqtt"

    def __init__(self):
        self._runtime = None
        self._module = None
        self._import_failed = False

    def _ensure_runtime(self):
        if self._runtime is not None:
            return self._runtime
        if self._import_failed:
            return None
        print("[info] mqtt-service: importing otter_mqtt.runtime")
        try:
            import otter_mqtt.runtime as mqtt_runtime
            self._module = mqtt_runtime
            self._runtime = mqtt_runtime.ensure_runtime()
        except Exception as exc:
            # Reported once: a resync every resync_interval_s must not spam this.
            self._import_failed = True
            print("[error] mqtt-service: runtime import failed ({})".format(exc))
            return None
        print(
            "[info] mqtt-service: runtime ready enabled={}".format(bool(self._runtime.enabled))
        )
        return self._runtime

    def _settings_file(self):
        path = None
        if self._module is not None:
            path = getattr(self._module, "MQTT_SETTINGS_FILE", None)
        return path or "/mqtt_settings.json"

    def disabled_reason(self):
        """Detail for the controller's skip line, so `skip mqtt` names a cause.

        ``None`` means "no detail available"; the controller then reports a bare
        `disabled`, exactly as it does for services without this hook.
        """
        runtime = self._ensure_runtime()
        if self._import_failed:
            return "runtime import failed"
        if runtime is not None and not runtime.enabled:
            return "enabled=false in {}".format(self._settings_file())
        return None

    def enabled(self):
        runtime = self._ensure_runtime()
        return runtime is not None and runtime.enabled

    def running(self):
        return self._runtime is not None and self._runtime.connected

    def transport_ready(self, network):
        # MQTT is an outbound connection: it needs a station link, not just any
        # interface (an AP-only device has no route to a broker).
        return bool(network.get("sta_connected"))

    async def start(self, network):
        # Idempotent: start() returns early when disabled or already connected,
        # and swallows connect failures (see otter_mqtt/runtime.py).
        runtime = self._ensure_runtime()
        print(
            "[info] mqtt-service: start sta_connected={} enabled={} running={}".format(
                bool(network.get("sta_connected")),
                runtime is not None and bool(runtime.enabled),
                self.running(),
            )
        )
        if runtime is None:
            print("[warning] mqtt-service: start done connected=False (runtime unavailable)")
            return
        runtime.start()
        if runtime.connected:
            print("[success] mqtt-service: start done connected=True")
        else:
            print(
                "[warning] mqtt-service: start done connected=False"
                " (see the mqtt runtime lines above)"
            )

    async def stop(self):
        print("[info] mqtt-service: stop connected={}".format(self.running()))
        if self._runtime is not None:
            self._runtime.disconnect()
            self._runtime = None
            print("[info] mqtt-service: stopped")
