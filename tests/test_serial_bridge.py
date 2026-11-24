import asyncio
import contextlib
import json
import os
import pty
import socket
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from websockets.asyncio.client import connect as ws_connect

import micro_otter
from micro_otter.cli.state import SerialPort
from micro_otter.config import load_config
from micro_otter.tools import serial_bridge
from micro_otter.tools.server_capabilities import CAPABILITY_KEYS, FEATURE_SERIAL_BRIDGE


class _FakeRequest:
    def __init__(self, path, headers=None):
        self.path = path
        self.headers = headers or {}


def test_serial_ports_payload_shape(monkeypatch):
    monkeypatch.setattr(
        serial_bridge,
        "detect_serial_ports",
        lambda: [SerialPort("/dev/ttyACM0", "usb-Espressif_...")],
    )

    ports = serial_bridge.detect_serial_ports()
    assert serial_bridge.serial_ports_payload(ports) == [
        {
            "device": "/dev/ttyACM0",
            "label": "usb-Espressif_...",
            "display": "Espressif ... (usb, /dev/ttyACM0)",
        },
    ]


def test_serial_ports_payload_omits_none_label(monkeypatch):
    monkeypatch.setattr(
        serial_bridge,
        "detect_serial_ports",
        lambda: [SerialPort("/dev/ttyUSB0", None)],
    )

    assert serial_bridge.serial_ports_payload(serial_bridge.detect_serial_ports()) == [
        {"device": "/dev/ttyUSB0", "label": None, "display": "/dev/ttyUSB0"},
    ]


def test_process_request_serial_ports_returns_json(monkeypatch):
    monkeypatch.setattr(
        serial_bridge,
        "detect_serial_ports",
        lambda: [SerialPort("/dev/ttyACM0", "usb-Espressif_...")],
    )
    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(bridge._process_request(None, _FakeRequest("/api/serial-ports")))

    assert response.status_code == 200
    assert json.loads(response.body) == [
        {
            "device": "/dev/ttyACM0",
            "label": "usb-Espressif_...",
            "display": "Espressif ... (usb, /dev/ttyACM0)",
        }
    ]
    assert response.headers.get("Access-Control-Allow-Origin") == "*"


def test_process_request_serial_path_allows_upgrade():
    bridge = serial_bridge._SerialBridge()

    assert asyncio.run(bridge._process_request(None, _FakeRequest("/serial"))) is None


def test_server_capabilities_endpoint_returns_contract_payload():
    config = replace(load_config(env={}), enable_compile=False, enable_deploy=False)
    bridge = serial_bridge._SerialBridge(config=config)

    response = asyncio.run(bridge._process_request(None, _FakeRequest("/api/server-capabilities")))

    body = json.loads(response.body)
    assert response.status_code == 200
    assert tuple(body) == CAPABILITY_KEYS
    assert isinstance(body["version"], str) and body["version"]
    assert FEATURE_SERIAL_BRIDGE in body["features"]
    assert "firmware-compile" not in body["features"]
    assert "firmware-deploy" not in body["features"]
    assert isinstance(body["buildBackends"], list)
    assert isinstance(body["flashBackends"], list)


def test_server_capabilities_rejects_foreign_host():
    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/api/server-capabilities", {"Host": "evil.example"})
        )
    )

    body = json.loads(response.body)
    assert response.status_code == 403
    assert body["error"]["code"] == "host-not-allowed"
    assert body["error"]["hint"]
    assert response.headers.get("Access-Control-Allow-Origin") is None


def test_api_version_reports_the_package_version():
    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/api/version", {"Host": "localhost:8000"})
        )
    )

    assert response.status_code == 200
    assert json.loads(response.body)["version"] == micro_otter.__version__


def test_request_with_foreign_origin_is_rejected():
    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(
        bridge._process_request(
            None,
            _FakeRequest(
                "/api/version", {"Host": "localhost:8000", "Origin": "http://evil.example"}
            ),
        )
    )

    body = json.loads(response.body)
    assert response.status_code == 403
    assert body["error"]["code"] == "origin-not-allowed"
    assert response.headers.get("Access-Control-Allow-Origin") is None


def test_capabilities_echoes_allowed_origin_only():
    bridge = serial_bridge._SerialBridge()

    allowed = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/api/server-capabilities", {"Origin": "http://localhost:5173"})
        )
    )
    same_origin = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/api/server-capabilities", {"Origin": "http://127.0.0.1:8000"})
        )
    )
    headerless = asyncio.run(
        bridge._process_request(None, _FakeRequest("/api/server-capabilities"))
    )

    assert allowed.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    assert same_origin.headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:8000"
    assert headerless.headers.get("Access-Control-Allow-Origin") is None


def test_run_bridge_passes_config_to_capabilities(monkeypatch):
    config = replace(load_config(env={}), enable_compile=False, enable_deploy=False)
    captured = {}

    class _RecordingBridge:
        def __init__(self, disable_protection=False, *, config=None):
            captured["disable_protection"] = disable_protection
            captured["config"] = config

        async def run(self, host, port):
            captured["host"] = host
            captured["port"] = port

    monkeypatch.setattr(serial_bridge, "_SerialBridge", _RecordingBridge)

    serial_bridge.run_bridge("127.0.0.1", 8321, config=config)

    assert captured["config"] is config
    assert captured["disable_protection"] is False
    assert (captured["host"], captured["port"]) == ("127.0.0.1", 8321)


def test_capabilities_uses_injected_config_without_rereading(monkeypatch):
    config = replace(load_config(env={}), enable_compile=False, enable_deploy=False)
    seen = {}
    real_build = serial_bridge.build_server_capabilities

    def spy(*, config):
        seen["config"] = config
        return real_build(config=config)

    monkeypatch.setattr(serial_bridge, "build_server_capabilities", spy)
    monkeypatch.setattr(serial_bridge, "load_config", _raise_unexpected_load_config)
    bridge = serial_bridge._SerialBridge(config=config)

    payload = bridge._capabilities()

    assert seen["config"] is config
    assert tuple(payload) == CAPABILITY_KEYS
    assert FEATURE_SERIAL_BRIDGE in payload["features"]


def _raise_unexpected_load_config():
    raise AssertionError("run_bridge must pass its config instead of re-reading it")


def test_process_request_unknown_path_returns_not_found():
    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(bridge._process_request(None, _FakeRequest("/nope")))

    assert response.status_code == 404


def test_process_request_firmware_package_route_is_gone():
    """The deleted download route answers 404, guarding the removal."""

    bridge = serial_bridge._SerialBridge()

    response = asyncio.run(
        bridge._process_request(None, _FakeRequest("/api/firmware/package?path=/tmp/a.bin"))
    )

    assert response.status_code == 404


def _write_addon(addons_root: Path, package_id: str = "sample_addon") -> Path:
    """Create one installed add-on package and return its directory."""

    package_dir = addons_root / package_id
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": package_id,
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
            }
        ),
        encoding="utf-8",
    )
    module_dir = package_dir / f"moa_{package_id}"
    module_dir.mkdir(parents=True, exist_ok=True)
    (module_dir / "__init__.py").write_text("# addon\n", encoding="utf-8")
    return package_dir


def _bridge_with_addons(tmp_path: Path) -> tuple[serial_bridge._SerialBridge, Path]:
    """Return a bridge whose injected config points at a temporary add-ons folder."""

    addons_root = tmp_path / "addons"
    package_dir = _write_addon(addons_root)
    config = replace(load_config(env={}), addons_dir=addons_root)
    return serial_bridge._SerialBridge(config=config), package_dir


def test_node_package_index_includes_installed_addons(tmp_path):
    bridge, _package_dir = _bridge_with_addons(tmp_path)

    response = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/node_pkgs/index.json"))
    )

    body = json.loads(response.body)
    ids = [entry["id"] for entry in body["packages"]]
    assert response.status_code == 200
    assert ids[0] == "core"
    assert ids[-1] == "sample_addon"
    assert body["packages"][-1]["root"] == "addons"


def test_runtime_manifest_lists_addons_and_keeps_global(tmp_path):
    bridge, _package_dir = _bridge_with_addons(tmp_path)

    response = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/runtime/general/manifest.json"))
    )

    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["nodePackages"]["addons"] == ["sample_addon"]
    assert body["nodePackages"]["global"]
    assert "local" in body["nodePackages"]


def test_addon_asset_is_served_from_the_addons_folder(tmp_path):
    bridge, package_dir = _bridge_with_addons(tmp_path)

    manifest = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/node_pkgs/sample_addon/manifest.json"))
    )
    module = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/device/node_pkgs/sample_addon/moa_sample_addon/__init__.py")
        )
    )

    assert manifest.status_code == 200
    assert json.loads(manifest.body)["id"] == "sample_addon"
    assert manifest.headers.get("Content-Type") == "application/json"
    assert module.status_code == 200
    assert module.body == (package_dir / "moa_sample_addon" / "__init__.py").read_bytes()


def test_builtin_file_wins_over_an_addon_with_the_same_path(tmp_path):
    addons_root = tmp_path / "addons"
    shadow = _write_addon(addons_root, "led")
    (shadow / "manifest.json").write_text('{"id": "led", "version": "9.9.9"}', encoding="utf-8")
    config = replace(load_config(env={}), addons_dir=addons_root)
    bridge = serial_bridge._SerialBridge(config=config)

    response = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/node_pkgs/led/manifest.json"))
    )

    assert response.status_code == 200
    assert json.loads(response.body)["version"] != "9.9.9"


def test_unknown_addon_asset_returns_not_found(tmp_path):
    bridge, _package_dir = _bridge_with_addons(tmp_path)

    response = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/node_pkgs/ghost_pkg/manifest.json"))
    )

    assert response.status_code == 404


def test_addon_routes_still_reject_a_foreign_host(tmp_path):
    bridge, _package_dir = _bridge_with_addons(tmp_path)
    headers = {"Host": "evil.example"}

    index = asyncio.run(
        bridge._process_request(None, _FakeRequest("/device/node_pkgs/index.json", dict(headers)))
    )
    manifest = asyncio.run(
        bridge._process_request(
            None, _FakeRequest("/device/runtime/general/manifest.json", dict(headers))
        )
    )

    assert index.status_code == 403
    assert manifest.status_code == 403
    assert json.loads(index.body)["error"]["code"] == "host-not-allowed"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_serial_byte_pipe_roundtrip():
    async def main():
        master_fd, slave_fd = pty.openpty()
        os.set_blocking(master_fd, False)
        slave_name = os.ttyname(slave_fd)

        bridge = serial_bridge._SerialBridge()
        port = _free_port()
        async with serial_bridge.serve(
            bridge._handler, "127.0.0.1", port, process_request=bridge._process_request
        ):
            async with ws_connect(
                f"ws://127.0.0.1:{port}/serial?port={slave_name}&baud=115200"
            ) as ws:
                status = await asyncio.wait_for(ws.recv(), timeout=2)
                assert json.loads(status)["type"] == "status"
                ready = await asyncio.wait_for(ws.recv(), timeout=2)
                assert json.loads(ready) == {"type": "ready"}

                await ws.send(b"hello")
                await asyncio.sleep(0.2)
                assert os.read(master_fd, 1024) == b"hello"

                os.write(master_fd, b"world")
                data = await asyncio.wait_for(ws.recv(), timeout=2)
                assert data == b"world"

        os.close(master_fd)
        os.close(slave_fd)

    asyncio.run(main())


def test_single_client_and_release():
    async def main():
        master_fd, slave_fd = pty.openpty()
        os.set_blocking(master_fd, False)
        slave_name = os.ttyname(slave_fd)

        bridge = serial_bridge._SerialBridge()
        port = _free_port()
        async with serial_bridge.serve(
            bridge._handler, "127.0.0.1", port, process_request=bridge._process_request
        ):
            ws1 = await ws_connect(f"ws://127.0.0.1:{port}/serial?port={slave_name}&baud=115200")
            assert json.loads(await asyncio.wait_for(ws1.recv(), timeout=2))["type"] == "status"
            assert json.loads(await asyncio.wait_for(ws1.recv(), timeout=2)) == {"type": "ready"}

            ws2 = await ws_connect(f"ws://127.0.0.1:{port}/serial?port={slave_name}&baud=115200")
            assert json.loads(await asyncio.wait_for(ws2.recv(), timeout=2)) == {
                "type": "error",
                "message": "serial port already in use",
            }
            await ws2.close()

            await ws1.close()
            await asyncio.sleep(0.2)

            ws3 = await ws_connect(f"ws://127.0.0.1:{port}/serial?port={slave_name}&baud=115200")
            assert json.loads(await asyncio.wait_for(ws3.recv(), timeout=2))["type"] == "status"
            assert json.loads(await asyncio.wait_for(ws3.recv(), timeout=2)) == {"type": "ready"}
            await ws3.close()

        os.close(master_fd)
        os.close(slave_fd)

    asyncio.run(main())


def test_run_does_not_pass_a_message_cap_to_serve(monkeypatch):
    """The shared socket uses the library default: no ``max_size`` is passed."""

    recorded: dict[str, object] = {}

    @contextlib.asynccontextmanager
    async def fake_serve(handler, host, port, **kwargs):
        """Record the call, then hand back a server that stops the loop immediately."""

        recorded["handler"] = handler
        recorded["host"] = host
        recorded["port"] = port
        recorded["kwargs"] = kwargs

        class _Server:
            async def serve_forever(self) -> None:
                """End the loop so ``run`` returns instead of serving forever."""

                raise asyncio.CancelledError

        yield _Server()

    monkeypatch.setattr(serial_bridge, "serve", fake_serve)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(serial_bridge._SerialBridge().run("127.0.0.1", 0))

    assert "max_size" not in recorded["kwargs"]


class _FakeServerConnection:
    """Minimal ``ServerConnection`` double for handler-level tests."""

    def __init__(self, path, *, state_name="OPEN", close_code=None):
        self.request = SimpleNamespace(path=path)
        self.sent = []
        self.closed = False
        self.state = SimpleNamespace(name=state_name)
        self.close_code = close_code

    async def send(self, payload):
        """Record one frame written to the client."""

        self.sent.append(payload)

    async def close(self, *args, **kwargs):
        """Record that the bridge closed the client."""

        self.closed = True

    def __aiter__(self):
        """Iterate no client messages, so the handler reaches its teardown."""

        return self

    async def __anext__(self):
        """End the client message stream immediately."""

        raise StopAsyncIteration


def test_is_stale_connection_detects_departed_clients():
    assert serial_bridge._is_stale_connection(None) is False
    assert serial_bridge._is_stale_connection(_FakeServerConnection("/serial")) is False
    assert (
        serial_bridge._is_stale_connection(_FakeServerConnection("/serial", state_name="CLOSED"))
        is True
    )
    assert (
        serial_bridge._is_stale_connection(_FakeServerConnection("/serial", state_name="CLOSING"))
        is True
    )


def test_handler_takes_over_a_stale_connection_slot():
    """A reconnect must not be answered with "already in use" after a dead client."""

    async def main():
        master_fd, slave_fd = pty.openpty()
        slave_name = os.ttyname(slave_fd)

        bridge = serial_bridge._SerialBridge()
        bridge._active_connection = _FakeServerConnection("/serial", state_name="CLOSED")
        connection = _FakeServerConnection(f"/serial?port={slave_name}&baud=115200")

        await asyncio.wait_for(bridge._handler(connection), timeout=5)

        frames = [json.loads(frame) for frame in connection.sent]
        assert {"type": "ready"} in frames

        os.close(master_fd)
        os.close(slave_fd)

    asyncio.run(main())


def test_handler_rejects_a_live_connection_slot():
    """A client that is still open keeps sole ownership of the port."""

    async def main():
        bridge = serial_bridge._SerialBridge()
        bridge._active_connection = _FakeServerConnection("/serial")
        connection = _FakeServerConnection("/serial?port=/dev/null&baud=115200")

        await asyncio.wait_for(bridge._handler(connection), timeout=5)

        assert [json.loads(frame) for frame in connection.sent] == [
            {"type": "error", "message": "serial port already in use"}
        ]
        assert connection.closed is True

    asyncio.run(main())


def test_open_serial_is_exclusive_and_retries_re_enumeration(monkeypatch):
    calls = []

    async def fake_open(**kwargs):
        """Fail twice, then hand back a reader/writer pair."""

        calls.append(kwargs)
        if len(calls) < 3:
            raise OSError("device re-enumerating")
        return ("reader", "writer")

    monkeypatch.setattr(serial_bridge.serial_asyncio, "open_serial_connection", fake_open)
    monkeypatch.setattr(serial_bridge, "SERIAL_OPEN_RETRY_DELAY", 0)

    assert asyncio.run(serial_bridge._open_serial("/dev/ttyACM0", 115200)) == (
        "reader",
        "writer",
    )
    assert len(calls) == 3
    assert calls[0]["url"] == "/dev/ttyACM0"
    assert calls[0]["baudrate"] == 115200
    assert calls[0]["exclusive"] is True
    assert calls[0]["rtscts"] is False
    assert calls[0]["dsrdtr"] is False


def test_open_serial_reports_the_last_open_error(monkeypatch):
    errors = []

    async def fake_open(**kwargs):
        """Record the error of every attempt and keep failing."""

        error = OSError(f"attempt {len(errors) + 1} failed")
        errors.append(error)
        raise error

    monkeypatch.setattr(serial_bridge.serial_asyncio, "open_serial_connection", fake_open)
    monkeypatch.setattr(serial_bridge, "SERIAL_OPEN_RETRY_DELAY", 0)

    with pytest.raises(OSError, match="attempt 5 failed"):
        asyncio.run(serial_bridge._open_serial("/dev/ttyACM0", 115200))

    assert len(errors) == serial_bridge.SERIAL_OPEN_ATTEMPTS
