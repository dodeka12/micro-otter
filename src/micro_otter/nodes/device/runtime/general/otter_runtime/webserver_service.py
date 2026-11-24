# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Web-server adapter for the network-service controller."""

import otter_runtime.web_interface as web_interface_module
from otter_runtime.service_controller import NetworkService
from otter_runtime.settings_store import (
    WEBSERVER_SETTINGS_DEFAULTS,
    WEBSERVER_SETTINGS_FILE,
    read_settings,
)


class WebServerService(NetworkService):
    name = "webserver"
    # The web server binds 0.0.0.0 and serves whatever interface is up, so it
    # must be allowed to start before any transport exists. This also ensures
    # ``web_interface_module.WEB_INTERFACE`` is set before the audio main loop
    # starts (which consumes webview values) in STA-only mode, where the station
    # only connects after boot.
    requires_network = False

    def __init__(self, settings):
        self._enabled = bool(settings.get("enable", True))
        self._port = int(settings.get("port", 80))
        self._interface = None

    @classmethod
    def from_settings(cls, settings=None):
        if settings is None:
            settings = read_settings(WEBSERVER_SETTINGS_FILE, WEBSERVER_SETTINGS_DEFAULTS)
        return cls(settings)

    def enabled(self):
        return self._enabled

    def running(self):
        return self._interface is not None and self._interface.web_server is not None

    async def start(self, network):
        host_ip = network.get("host_ip", "0.0.0.0")
        print("[info] webserver-service: start host_ip={} port={}".format(host_ip, self._port))
        if self._interface is None:
            self._interface = web_interface_module.WebInterface(
                host_ip=host_ip,
                enable_server=False,   # the controller owns the start decision
                port=self._port,
            )
            web_interface_module.WEB_INTERFACE = self._interface
        else:
            self._interface.set_host_ip(host_ip)
        if self._interface.start_server():
            ready = await self._interface.wait_until_server_ready(timeout_ms=10000)
            get_start_error = getattr(self._interface, "get_server_start_error", None)
            start_error = get_start_error() if callable(get_start_error) else None
            if ready and start_error is None:
                print("[success] webserver-service: ready on port {}".format(self._port))
            else:
                print(
                    "[error] webserver-service: not ready ready={} error={}".format(
                        ready, start_error
                    )
                )

    async def stop(self):
        if self._interface is not None:
            await self._interface.shutdown()
            if web_interface_module.WEB_INTERFACE is self._interface:
                web_interface_module.WEB_INTERFACE = None
            self._interface = None
