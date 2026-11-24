# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""CLI helper that persists WiFi credentials on the target device."""

import sys

from tools.wifi_manager import WifiSettingsError, save_wifi_settings


def _print_usage() -> None:
    print("Usage: set_wifi.py <ssid> <password> [mode] [enabled]")
    print("  mode: 'sta' (default) or 'ap'")
    print("  enabled: 'on' (default) or 'off'")


def _parse_enabled(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"on", "enable", "enabled", "true", "1", "yes"}:
        return True
    if normalized in {"off", "disable", "disabled", "false", "0", "no"}:
        return False
    raise WifiSettingsError("Enabled flag must be 'on' or 'off'.")


def set_wifi(
    ssid: str, password: str, mode: str = "sta", *, enabled: bool = True
) -> None:
    save_wifi_settings(ssid, password, mode, enabled=enabled)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        _print_usage()
        raise SystemExit(1)
    ssid_arg, password_arg = args[:2]
    mode_arg = args[2] if len(args) > 2 else "sta"
    enabled_arg = args[3] if len(args) > 3 else "on"
    try:
        enabled_value = _parse_enabled(enabled_arg)
        set_wifi(ssid_arg, password_arg, mode_arg, enabled=enabled_value)
        print("WiFi settings saved.")
    except WifiSettingsError as exc:
        print(f"Error: {exc!s}")
        raise SystemExit(1)
