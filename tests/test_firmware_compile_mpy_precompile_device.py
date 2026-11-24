import shutil
import subprocess
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile.mpy_precompile_device import (
    DeviceMpyPrecompileRequest,
    run_device_mpy_precompile,
)
from micro_otter.tools.firmware_compile.mpy_probe import infer_march


def test_run_device_mpy_precompile_uses_probe_recommendations(tmp_path: Path):
    probe_result = mock.Mock(
        values={
            "recommended_emit": "bytecode",
            "recommended_small_int_bits": 31,
            "recommended_march": "xtensawin",
        }
    )
    compile_result = mock.Mock()

    with mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile_device.probe_device_mpy_compatibility",
        return_value=probe_result,
    ) as probe_mock, mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile_device.run_manifest_mpy_precompile",
        return_value=compile_result,
    ) as compile_mock:
        result = run_device_mpy_precompile(
            DeviceMpyPrecompileRequest(
                device_root=tmp_path,
                micropython_root=tmp_path / "micropython",
            )
        )

    probe_mock.assert_called_once()
    compile_mock.assert_called_once()
    compile_request = compile_mock.call_args.args[0]
    assert compile_request.emit == "bytecode"
    assert compile_request.small_int_bits == 31
    assert compile_request.march == "xtensawin"
    assert compile_request.device_root == tmp_path
    assert result.selected_small_int_bits == 31
    assert result.selected_march == "xtensawin"


def test_run_device_mpy_precompile_honors_overrides(tmp_path: Path):
    probe_result = mock.Mock(
        values={
            "recommended_emit": "bytecode",
            "recommended_small_int_bits": 31,
            "recommended_march": "xtensawin",
        }
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile_device.probe_device_mpy_compatibility",
        return_value=probe_result,
    ), mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile_device.run_manifest_mpy_precompile",
        return_value=mock.Mock(),
    ) as compile_mock:
        run_device_mpy_precompile(
            DeviceMpyPrecompileRequest(
                device_root=tmp_path,
                emit="native",
                march="rv32imc",
            )
        )

    compile_request = compile_mock.call_args.args[0]
    assert compile_request.emit == "native"
    assert compile_request.march == "rv32imc"


def test_infer_march_maps_esp32_to_xtensawin():
    assert infer_march("esp32", "ESP32") == "xtensawin"
    assert infer_march("esp32", "ESP32S3") == "xtensawin"
    assert infer_march("esp32", "ESP32C3") == "rv32imc"
    assert infer_march("esp32", "ESP32C6") == "rv32imc"
    assert infer_march("esp32", "ESP32H2") == "rv32imc"
    assert infer_march("rp2", "Raspberry Pi Pico") == "armv6m"
    assert infer_march("unknown", "unknown") is None


def test_mpy_cross_smoke_compiles_native_with_march(tmp_path: Path):
    mpy_cross = shutil.which("mpy-cross") or "/opt/micropython/mpy-cross/build/mpy-cross"
    if not Path(mpy_cross).is_file():
        pytest.skip("mpy-cross not available")

    source = tmp_path / "mod.py"
    source.write_text("@micropython.native\ndef f():\n    pass\n", encoding="utf-8")
    result = subprocess.run(
        [
            mpy_cross,
            "-X",
            "emit=bytecode",
            "-march=xtensawin",
            "-o",
            str(tmp_path / "mod.mpy"),
            str(source),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "invalid arch" not in result.stderr


AUDIO_PKG = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "audio"
    / "otter_audio_viper"
)


def test_audio_package_compiles_with_march(tmp_path: Path):
    mpy_cross = shutil.which("mpy-cross") or "/opt/micropython/mpy-cross/build/mpy-cross"
    if not Path(mpy_cross).is_file():
        pytest.skip("mpy-cross not available")

    sources = sorted(AUDIO_PKG.glob("*.py"))
    assert sources, "no audio package sources found"
    for source in sources:
        result = subprocess.run(
            [
                mpy_cross,
                "-X",
                "emit=bytecode",
                "-march=xtensawin",
                "-o",
                str(tmp_path / f"{source.stem}.mpy"),
                str(source),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, f"{source.name}: {result.stderr}"
        assert "invalid arch" not in result.stderr
