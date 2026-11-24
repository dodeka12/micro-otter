"""CLI state persistence and serial-port discovery for interactive firmware tooling."""

from __future__ import annotations

import glob
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from micro_otter.config import state_path as config_state_path


@dataclass(frozen=True)
class CliState:
    """Persisted user selections for the interactive firmware menu."""

    last_port: str | None = None
    last_wipe_filesystem: bool = False
    last_monitor: bool = False
    last_board: str | None = None
    last_action: str | None = None


@dataclass(frozen=True)
class SerialPort:
    """A detected serial port with an optional human-friendly label."""

    device: str
    label: str | None = None

    @property
    def display(self) -> str:
        """The human-readable name shown in port choosers.

        Derived from :attr:`label` by :func:`format_serial_port_label`, so every
        chooser built from this list renders the same name. Never ``None`` — it
        falls back to the device path when there is no label.
        """

        return format_serial_port_label(self.device, self.label)


def _default_state_path() -> Path:
    """Return the platform-aware state file path from the configuration resolver.

    ``MICRO_OTTER_STATE_DIR`` wins, then the platform default
    (``XDG_STATE_HOME/micro-otter``, ``%LOCALAPPDATA%\\micro-otter``, or
    ``~/Library/Application Support/micro-otter``); see
    :func:`micro_otter.config.state_path`. The function name stays private and
    patchable because the interactive tests replace it.
    """

    return config_state_path()


def _legacy_state_path() -> Path:
    """Return the pre-resolver state file path, read only for migration.

    Older builds wrote ``$XDG_CONFIG_HOME/micro-otter/state.json`` (falling back to
    ``~/.config/micro-otter/state.json``). The legacy file is never written or
    deleted, so a one-release read-only migration loses no data.
    """

    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        return Path(config_home) / "micro-otter" / "state.json"
    return Path.home() / ".config" / "micro-otter" / "state.json"


def _serial_by_id_labels() -> dict[str, str]:
    """Map resolved serial device paths to their ``/dev/serial/by-id`` names."""
    labels: dict[str, str] = {}
    by_id_dir = Path("/dev/serial/by-id")
    if not by_id_dir.is_dir():
        return labels

    for entry in by_id_dir.iterdir():
        if not entry.is_symlink():
            continue
        try:
            resolved = entry.resolve()
        except OSError:
            continue
        labels.setdefault(str(resolved), entry.name)

    return labels


def _is_serial_token(token: str) -> bool:
    """Return whether *token* is a bare hex serial number at least eight chars long.

    ``/dev/serial/by-id`` names embed the board's serial number as one long hex
    token; it identifies a specific unit but reads poorly in a chooser, so
    :func:`format_serial_port_label` drops it from the display text.
    """

    return len(token) >= 8 and all(char in "0123456789abcdefABCDEF" for char in token)


def format_serial_port_label(device: str, label: str | None) -> str:
    """Return a human-readable name for one detected serial port.

    *label* is the OS-reported identity: the ``/dev/serial/by-id`` name when one
    exists, otherwise the pyserial description. It is split on ``-``/``_`` and
    re-joined with spaces, dropping the leading ``usb`` marker and any bare hex
    token of eight or more characters (the embedded serial number). A ``usb``
    by-id name annotates the device path as ``(usb, <device>)``; any other label
    as ``(<device>)`` — except that the annotation is omitted when the device
    path already appears in the readable text (for example a Windows
    ``USB Serial Port (COM3)`` label would otherwise repeat ``COM3``).
    """

    if not label:
        return device

    tokens = [token for token in re.split(r"[-_]", label) if token]
    has_usb = bool(tokens) and tokens[0] == "usb"
    readable = " ".join(
        token for token in tokens if token != "usb" and not _is_serial_token(token)
    )

    if not readable:
        return f"(usb, {device})" if has_usb else f"({device})"
    if device and device in readable:
        return readable
    bracket = f"(usb, {device})" if has_usb else f"({device})"
    return f"{readable} {bracket}"


_UNIDENTIFIED_PLACEHOLDERS = frozenset({"", "n/a"})
"""pyserial's placeholders for a port the kernel reported without details."""


def _has_device_identity(entry: object) -> bool:
    """Return whether pyserial identified one ``comports()`` entry as a real device.

    Linux exposes phantom 8250 UARTs (``/dev/ttyS0``…``/dev/ttyS31``) that
    ``comports()`` lists with ``vid``/``pid`` ``None``, ``hwid="n/a"`` and
    ``description="n/a"``; no board is attached behind them, so offering them
    buries the ports that really are plugged in. Only entries with *no* identity
    at all are dropped: a USB VID/PID, a hardware id such as ``PNP0501``, or any
    description keeps the port, so a genuine UART and an unfamiliar platform never
    lose an option.
    """

    if getattr(entry, "vid", None) is not None or getattr(entry, "pid", None) is not None:
        return True
    for attribute in ("hwid", "description"):
        value = getattr(entry, attribute, None)
        if value and str(value).strip().lower() not in _UNIDENTIFIED_PLACEHOLDERS:
            return True
    return False


def _list_ports_via_pyserial() -> list[SerialPort]:
    """Return serial ports reported by pyserial, labelled from their description.

    pyserial is imported lazily so importing this module stays cheap and the CLI
    keeps working when the dependency is missing (the glob fallback takes over).
    Entries without a usable device name (empty or ``"n/a"``) are skipped, and so
    are entries the kernel reports without any identity (see
    :func:`_has_device_identity`).
    """

    from serial.tools import list_ports  # noqa: PLC0415 - lazy by design

    ports: list[SerialPort] = []
    for entry in list_ports.comports():
        device = (entry.device or "").strip()
        if not device or device.lower() == "n/a":
            continue
        if not _has_device_identity(entry):
            continue
        description = (entry.description or "").strip()
        label = None if description.lower() in {"", "n/a"} else description
        ports.append(SerialPort(device=device, label=label))
    return ports


def _list_ports_via_glob() -> list[SerialPort]:
    """Return POSIX serial ports found by glob (fallback only).

    This is the original discovery strategy, kept for environments where pyserial
    cannot be imported. It cannot see Windows ``COM*`` ports and knows nothing
    about device descriptions, so pyserial is always preferred.
    """

    patterns = ("/dev/ttyUSB*", "/dev/ttyACM*", "/dev/cu.*")
    devices: set[str] = set()
    for pattern in patterns:
        devices.update(glob.glob(pattern))
    return [SerialPort(device=device) for device in sorted(devices)]


def detect_serial_ports() -> list[SerialPort]:
    """Return sorted, de-duplicated candidate serial ports with friendly labels.

    ``serial.tools.list_ports.comports()`` is the primary source, so Windows
    ``COM*`` and macOS ``/dev/cu.*`` devices are discovered too; the glob scan is
    the POSIX fallback used when pyserial cannot be imported. Labels prefer the
    ``/dev/serial/by-id`` name (it identifies the board) and fall back to the
    pyserial description. Ports the kernel reports without any identity (the
    phantom Linux ``/dev/ttyS*`` UARTs) are skipped, so every chooser built from
    this list offers attached devices only; see :func:`_has_device_identity`.
    """

    try:
        discovered = _list_ports_via_pyserial()
    except (ImportError, OSError):
        discovered = _list_ports_via_glob()

    by_device: dict[str, SerialPort] = {}
    for port in discovered:
        by_device.setdefault(port.device, port)

    labels = _serial_by_id_labels()
    return [
        SerialPort(device=device, label=labels.get(device) or port.label)
        for device, port in sorted(by_device.items())
    ]


def load_state(path: Path | None = None) -> CliState:
    """Load persisted CLI state, falling back to defaults on any error.

    When *path* is omitted the resolved state file is used. If that file does not
    exist yet, the legacy ``~/.config/micro-otter/state.json`` location is read
    once so an upgrade keeps the remembered board, port, and action.
    """

    state_file = path
    if state_file is None:
        state_file = _default_state_path()
        if not state_file.exists():
            legacy = _legacy_state_path()
            if legacy.is_file():
                state_file = legacy

    try:
        payload = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return CliState()

    if not isinstance(payload, dict):
        return CliState()

    last_port_value = payload.get("lastPort")
    last_port = (
        last_port_value if isinstance(last_port_value, str) and last_port_value.strip() else None
    )

    wipe_value = payload.get("lastWipeFilesystem", False)
    monitor_value = payload.get("lastMonitor", False)

    board_value = payload.get("lastBoard")
    last_board = (
        board_value if isinstance(board_value, str) and board_value.strip() else None
    )

    action_value = payload.get("lastAction")
    last_action = (
        action_value
        if isinstance(action_value, str) and action_value in {"build", "deploy", "build-deploy"}
        else None
    )

    return CliState(
        last_port=last_port,
        last_wipe_filesystem=wipe_value if isinstance(wipe_value, bool) else False,
        last_monitor=monitor_value if isinstance(monitor_value, bool) else False,
        last_board=last_board,
        last_action=last_action,
    )


def save_state(state: CliState, path: Path | None = None) -> None:
    """Persist CLI state to the resolved state file, creating parent directories.

    The legacy configuration-directory file is never written or removed, so a
    migration is read-only and reversible.
    """

    state_file = path or _default_state_path()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "lastPort": state.last_port,
        "lastWipeFilesystem": state.last_wipe_filesystem,
        "lastMonitor": state.last_monitor,
        "lastBoard": state.last_board,
        "lastAction": state.last_action,
    }
    state_file.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


__all__ = [
    "CliState",
    "SerialPort",
    "detect_serial_ports",
    "format_serial_port_label",
    "load_state",
    "save_state",
]
