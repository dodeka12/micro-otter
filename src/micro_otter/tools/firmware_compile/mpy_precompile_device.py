"""Device-probe-driven .mpy precompile orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .mpy_precompile import (
    MpyManifestPrecompileRequest,
    MpyManifestPrecompileResult,
    run_manifest_mpy_precompile,
)
from .mpy_probe import MpyProbeRequest, MpyProbeResult, probe_device_mpy_compatibility


@dataclass(frozen=True)
class DeviceMpyPrecompileRequest:
    """Probe device and compile .mpy cache with derived compatibility defaults."""

    device_root: Path
    micropython_root: Path | None = None
    port: str = "u0"
    mpremote: str = "mpremote"
    mpy_cross: Path | None = None
    clean: bool = False
    emit: str | None = None
    march: str | None = None
    march_flags: str | None = None
    addons_root: Path | None = None
    """Add-ons folder to cover as well; forwarded from the manifest-driven request."""


@dataclass(frozen=True)
class DeviceMpyPrecompileResult:
    """Composite probe + precompile execution result."""

    probe: MpyProbeResult
    compile: MpyManifestPrecompileResult
    selected_emit: str
    selected_small_int_bits: int | None
    selected_march: str | None

    @property
    def probe_values(self) -> dict[str, Any]:
        return self.probe.values


def run_device_mpy_precompile(request: DeviceMpyPrecompileRequest) -> DeviceMpyPrecompileResult:
    """Execute probe, derive compile settings, and run manifest .mpy precompile."""

    probe = probe_device_mpy_compatibility(
        MpyProbeRequest(port=request.port, mpremote=request.mpremote)
    )
    probe_values = probe.values

    emit = request.emit or probe_values.get("recommended_emit") or "bytecode"
    small_int_bits = probe_values.get("recommended_small_int_bits")
    recommended_march = probe_values.get("recommended_march")
    selected_march = request.march if request.march is not None else recommended_march

    compile_result = run_manifest_mpy_precompile(
        MpyManifestPrecompileRequest(
            device_root=request.device_root,
            micropython_root=request.micropython_root,
            mpy_cross=request.mpy_cross,
            clean=request.clean,
            emit=emit,
            small_int_bits=small_int_bits,
            march=selected_march,
            march_flags=request.march_flags,
            addons_root=request.addons_root,
        )
    )

    return DeviceMpyPrecompileResult(
        probe=probe,
        compile=compile_result,
        selected_emit=emit,
        selected_small_int_bits=small_int_bits,
        selected_march=selected_march,
    )
