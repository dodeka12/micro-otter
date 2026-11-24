"""Ad-hoc WiFi diagnostics script for on-device troubleshooting.

Copy this file onto the MicroPython board (e.g. using `mpremote fs cp`),
then run it via raw REPL or `mpremote run wifi_diag.py` to inspect the
current WiFi configuration and attempt a fresh connection.
"""

import sys
import uasyncio as asyncio

try:
    from tools import wifi_manager
except ImportError:
    print("[diag] Unable to import tools.wifi_manager; aborting.")
    raise


async def _diagnose_wifi():
    print("\n=== Micro Otter WiFi Diagnostics ===\n")
    try:
        settings = wifi_manager.load_wifi_settings(require_station_credentials=False)
    except wifi_manager.WifiSettingsError as exc:  # type: ignore[attr-defined]
        print("[diag] Failed to load wifi_settings.json:")
        sys.print_exception(exc)
        return

    enabled = settings.get("enabled", True)
    mode = settings.get("mode", "sta")
    ssid = settings.get("ssid", "")
    print("[diag] Settings:", settings)

    if not enabled:
        print("[diag] WiFi disabled in settings; nothing to test.")
        snapshot = wifi_manager.wifi_status_snapshot()
        print("[diag] Snapshot:", snapshot)
        return

    iface = wifi_manager.maybe_create_interface(mode)
    if iface is None:
        print(f"[diag] Unable to create interface for mode '{mode}'.")
    else:
        try:
            iface_config = wifi_manager._interface_ipconfig(iface)  # type: ignore[attr-defined]
        except AttributeError:
            iface_config = None
        print("[diag] Interface:", iface)
        print("[diag] Current IP config:", iface_config)

    if iface is None:
        return

    try:
        if mode == "sta":
            if not ssid:
                print("[diag] No SSID configured; skipping station connect.")
            else:
                print(f"[diag] Connecting to station SSID '{ssid}'...")
                ipconfig = await wifi_manager.connect_station(
                    iface, ssid, settings.get("password", "")
                )
                print("[diag] Station connect complete. IP config:", ipconfig)
        else:
            print(
                f"[diag] Starting access point '{ssid or wifi_manager.DEFAULT_AP_SSID}'..."
            )
            ipconfig = await wifi_manager.start_access_point(
                iface, ssid, settings.get("password", "")
            )
            print("[diag] Access point configuration:", ipconfig)
    except Exception as exc:  # pylint: disable=broad-except
        print("[diag] WiFi activation failed:")
        sys.print_exception(exc)

    print("\n[diag] wifi_status_snapshot():")
    snapshot = wifi_manager.wifi_status_snapshot()
    print(snapshot)
    print("\n[diag] Raw write_wifi_status_json():")
    wifi_manager.write_wifi_status_json()
    print("\n=== Diagnostics complete ===\n")


def main():
    try:
        asyncio.run(_diagnose_wifi())
    except Exception as exc:  # pylint: disable=broad-except
        print("[diag] Unhandled diagnostic error:")
        sys.print_exception(exc)


if __name__ == "__main__":
    main()
