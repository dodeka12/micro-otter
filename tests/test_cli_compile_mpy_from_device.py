import json
from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def _fake_result(tmp_path: Path):
    return mock.Mock(
        probe_values={"platform": "esp32", "recommended_small_int_bits": 31},
        selected_emit="bytecode",
        selected_small_int_bits=31,
        selected_march="xtensa",
        compile=mock.Mock(
            compiled_count=42,
            profile_hash="abcd1234ef56",
            compiler_path=tmp_path / "mpy-cross",
            compiler_args=("-X", "emit=bytecode"),
            runtime_manifests_updated=2,
            node_package_manifests_updated=3,
            tools_manifests_updated=1,
            addon_manifests_updated=1,
            addons_skipped=False,
            warnings=("demo warning",),
        ),
    )


def _fake_manifest_result(tmp_path: Path):
    return mock.Mock(
        compiled_count=7,
        profile_hash="feedface1234",
        compiler_path=tmp_path / "mpy-cross",
        compiler_args=("-X", "emit=native"),
        runtime_manifests_updated=1,
        node_package_manifests_updated=1,
        tools_manifests_updated=1,
        addon_manifests_updated=0,
        addons_skipped=False,
        warnings=(),
    )


def test_compile_mpy_from_device_delegates_to_package_runner(tmp_path: Path):
    with mock.patch(
        "micro_otter.cli.app.run_device_mpy_precompile",
        return_value=_fake_result(tmp_path),
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-mpy",
                "--from-device",
                "--port",
                "u1",
                "--device-root",
                str(tmp_path / "device"),
                "--micropython-root",
                str(tmp_path / "micropython"),
                "--clean",
            ],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    request = run_mock.call_args.args[0]
    assert request.port == "u1"
    assert request.device_root == (tmp_path / "device").resolve()
    assert request.micropython_root == (tmp_path / "micropython").resolve()
    assert request.clean is True
    assert "MPY precompile completed" in result.stdout


def test_compile_mpy_from_device_json_output(tmp_path: Path):
    with mock.patch(
        "micro_otter.cli.app.run_device_mpy_precompile",
        return_value=_fake_result(tmp_path),
    ):
        result = runner.invoke(
            app,
            [
                "compile-mpy",
                "--from-device",
                "--json-output",
            ],
        )

    assert result.exit_code == 0
    assert '"status":"success"' in result.stdout
    assert '"compiledCount":42' in result.stdout


def test_compile_mpy_from_device_uses_default_micropython_root(tmp_path: Path):
    resolved_default = tmp_path / "opt" / "micropython"
    resolved_default.mkdir(parents=True, exist_ok=True)

    with mock.patch(
        "micro_otter.cli.app._resolve_default_micropython_root",
        return_value=resolved_default,
    ), mock.patch(
        "micro_otter.cli.app.run_device_mpy_precompile",
        return_value=_fake_result(tmp_path),
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-mpy",
                "--from-device",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.micropython_root == resolved_default.resolve()


def test_cmpy_alias_invokes_same_command(tmp_path: Path):
    with mock.patch(
        "micro_otter.cli.app.run_device_mpy_precompile",
        return_value=_fake_result(tmp_path),
    ):
        result = runner.invoke(
            app,
            [
                "cmpy",
                "--from-device",
            ],
        )

    assert result.exit_code == 0
    assert "Compilation Summary" in result.stdout


def test_compile_mpy_accepts_cli_spec_args(tmp_path: Path):
    with mock.patch(
        "micro_otter.cli.app.run_manifest_mpy_precompile",
        return_value=_fake_manifest_result(tmp_path),
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-mpy",
                "--emit",
                "native",
                "--small-int-bits",
                "31",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.emit == "native"
    assert request.small_int_bits == 31
    assert "Source" in result.stdout


def test_compile_mpy_accepts_spec_file(tmp_path: Path):
    spec_path = tmp_path / "spec.json"
    spec_path.write_text(
        json.dumps({"emit": "native", "smallIntBits": 30, "march": "xtensa"}),
        encoding="utf-8",
    )

    with mock.patch(
        "micro_otter.cli.app.run_manifest_mpy_precompile",
        return_value=_fake_manifest_result(tmp_path),
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-mpy",
                "--spec-file",
                str(spec_path),
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.emit == "native"
    assert request.small_int_bits == 30
    assert request.march == "xtensa"


def test_compile_mpy_requires_exactly_one_parameter_source():
    result = runner.invoke(app, ["compile-mpy"])
    assert result.exit_code == 2
