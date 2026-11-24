# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Generic JSON settings read/write for the general runtime."""

import json

WEBSERVER_SETTINGS_FILE = "/webserver_settings.json"
MQTT_SETTINGS_FILE = "/mqtt_settings.json"
WEBSERVER_SETTINGS_DEFAULTS = {"enable": True, "port": 80}


def read_settings(path, defaults):
    """Read a JSON settings dict, falling back to ``defaults`` on any problem.

    Fail-open on purpose: a missing/unreadable/invalid/non-dict document yields a
    copy of ``defaults``, matching ``otter_mqtt.runtime._load_settings``. The view
    (``custom_settings``) keeps its own stricter ``success``/``error`` semantics.
    """
    values = dict(defaults)
    try:
        with open(path, "r") as fh:
            data = json.load(fh)
    except Exception:
        return values
    if isinstance(data, dict):
        for key in defaults:
            if key in data:
                values[key] = data[key]
    return values


def write_settings(path, values):
    """Write a settings dict as JSON, overwriting the file."""
    with open(path, "w") as fh:
        json.dump(values, fh)
