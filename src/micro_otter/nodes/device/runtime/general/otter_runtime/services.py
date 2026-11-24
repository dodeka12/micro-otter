# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Concrete network-service registry for the general runtime."""

from otter_runtime.mqtt_service import MqttService
from otter_runtime.webserver_service import WebServerService


def build_runtime_services():
    """Return the ordered list of network services for this runtime.

    Order matters: the web server starts first so the device stays
    administrable even if a later service start is slow or fails.
    """
    return [
        WebServerService.from_settings(),
        MqttService(),
    ]


def load_mqtt_resync_interval_s():
    """Read the MQTT resync interval (seconds) used by the periodic service sync."""
    import otter_mqtt.runtime as mqtt_runtime
    return mqtt_runtime.ensure_runtime().resync_interval_s
