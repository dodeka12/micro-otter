"""Tests for cross-platform serial discovery (``micro_otter.cli.state``).

``serial.tools.list_ports.comports()`` is the primary source so Windows ``COM*`` and
macOS ``/dev/cu.*`` devices are found; the POSIX glob scan remains the fallback when
pyserial cannot be imported. Ports the kernel reports without any identity (the phantom
Linux ``/dev/ttyS*`` UARTs) are skipped so every chooser lists attached devices only.
The ``/api/serial-ports`` payload shape (``[{"device": ..., "label": ..., "display": ...}]``)
keeps ``device``/``label`` as the raw identity and adds a server-formatted ``display`` name.
"""

from __future__ import annotations

from types import SimpleNamespace

from serial.tools import list_ports

from micro_otter.cli import state as state_module
from micro_otter.cli.state import SerialPort, detect_serial_ports, format_serial_port_label


def _entry(
    device: str,
    description: str = "n/a",
    *,
    vid: int | None = 0x303A,
    pid: int | None = 0x1001,
    hwid: str = "USB VID:PID=303A:1001",
) -> SimpleNamespace:
    """Return a stand-in for one ``ListPortInfo`` entry, USB-attached by default."""

    return SimpleNamespace(device=device, description=description, vid=vid, pid=pid, hwid=hwid)


def _phantom_entry(device: str) -> SimpleNamespace:
    """Return the ``ListPortInfo`` shape Linux reports for an unattached 8250 UART."""

    return _entry(device, "n/a", vid=None, pid=None, hwid="n/a")


def test_comports_entries_are_returned(monkeypatch) -> None:
    monkeypatch.setattr(
        list_ports,
        "comports",
        lambda: [
            _entry("COM3", "USB Serial Port (COM3)"),
            _entry("/dev/cu.usbserial-1420"),
        ],
    )
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    ports = detect_serial_ports()

    assert [port.device for port in ports] == ["/dev/cu.usbserial-1420", "COM3"]
    assert ports[0].label is None
    assert ports[1].label == "USB Serial Port (COM3)"


def test_phantom_kernel_uarts_are_skipped(monkeypatch) -> None:
    monkeypatch.setattr(
        list_ports,
        "comports",
        lambda: [
            _phantom_entry("/dev/ttyS0"),
            _phantom_entry("/dev/ttyS1"),
            _entry("/dev/ttyACM0", "USB JTAG/serial debug unit"),
            _phantom_entry("/dev/ttyS31"),
        ],
    )
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == [
        SerialPort(device="/dev/ttyACM0", label="USB JTAG/serial debug unit")
    ]


def test_hardware_uart_is_kept(monkeypatch) -> None:
    monkeypatch.setattr(
        list_ports,
        "comports",
        lambda: [_entry("/dev/ttyS0", "ttyS0", vid=None, pid=None, hwid="PNP0501")],
    )
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == [SerialPort(device="/dev/ttyS0", label="ttyS0")]


def test_by_id_label_wins_over_description(monkeypatch) -> None:
    monkeypatch.setattr(list_ports, "comports", lambda: [_entry("/dev/ttyACM0", "USB JTAG")])
    monkeypatch.setattr(
        state_module,
        "_serial_by_id_labels",
        lambda: {"/dev/ttyACM0": "usb-Espressif_USB_JTAG_SERIAL_ABC-if00"},
    )

    ports = detect_serial_ports()

    assert ports == [
        SerialPort(
            device="/dev/ttyACM0", label="usb-Espressif_USB_JTAG_SERIAL_ABC-if00"
        )
    ]


def test_description_used_when_no_by_id_label(monkeypatch) -> None:
    monkeypatch.setattr(list_ports, "comports", lambda: [_entry("COM7", "CP2102 USB to UART")])
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == [
        SerialPort(device="COM7", label="CP2102 USB to UART")
    ]


def test_n_a_description_is_dropped(monkeypatch) -> None:
    monkeypatch.setattr(list_ports, "comports", lambda: [_entry("COM4", "n/a")])
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == [SerialPort(device="COM4")]


def test_glob_fallback_when_pyserial_unavailable(monkeypatch) -> None:
    def _raise() -> list[SerialPort]:
        raise ImportError("no pyserial")

    monkeypatch.setattr(state_module, "_list_ports_via_pyserial", _raise)
    monkeypatch.setattr(
        state_module.glob,
        "glob",
        lambda pattern: ["/dev/ttyUSB0"] if pattern == "/dev/ttyUSB*" else [],
    )
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == [SerialPort(device="/dev/ttyUSB0")]


def test_duplicate_devices_collapse(monkeypatch) -> None:
    monkeypatch.setattr(
        list_ports,
        "comports",
        lambda: [_entry("/dev/ttyACM0", "first"), _entry("/dev/ttyACM0", "second")],
    )
    monkeypatch.setattr(state_module, "_serial_by_id_labels", lambda: {})

    ports = detect_serial_ports()

    assert len(ports) == 1
    assert ports[0].device == "/dev/ttyACM0"
    assert ports[0].label == "first"


def test_format_serial_port_label_usb_by_id() -> None:
    assert format_serial_port_label(
        "/dev/ttyACM2", "usb-1a86_USB_Serial-0123456789ABCDEF-if00"
    ) == "1a86 USB Serial if00 (usb, /dev/ttyACM2)"
    assert format_serial_port_label(
        "/dev/ttyUSB0", "usb-Espressif_USB_JTAG-if00"
    ) == "Espressif USB JTAG if00 (usb, /dev/ttyUSB0)"


def test_format_serial_port_label_returns_device_when_no_label() -> None:
    assert format_serial_port_label("/dev/ttyUSB0", None) == "/dev/ttyUSB0"


def test_format_serial_port_label_keeps_long_non_hex_token() -> None:
    assert format_serial_port_label(
        "/dev/ttyUSB0", "usb-1234_FTDI_FT232R_USB_UART"
    ) == "1234 FTDI FT232R USB UART (usb, /dev/ttyUSB0)"


def test_format_serial_port_label_omits_repeated_device() -> None:
    # A Windows description already names the port; appending the device again
    # would read "USB Serial Port (COM3) (COM3)".
    assert format_serial_port_label("COM3", "USB Serial Port (COM3)") == "USB Serial Port (COM3)"


def test_serial_port_display_property() -> None:
    port = SerialPort(device="/dev/ttyUSB0", label="usb-Espressif_USB_JTAG-if00")

    assert port.display == "Espressif USB JTAG if00 (usb, /dev/ttyUSB0)"
    assert SerialPort(device="/dev/ttyUSB0").display == "/dev/ttyUSB0"
