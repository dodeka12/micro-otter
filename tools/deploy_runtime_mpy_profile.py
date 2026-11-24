#!/usr/bin/env python3
"""Deploy a compiled runtime .mpy profile to a MicroPython device via mpremote."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from tqdm import tqdm
except Exception:  # pragma: no cover - optional dependency
    tqdm = None

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUNTIME_DIR = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device" / "runtime" / "general"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Upload compiled .mpy files from runtime/general/_mpy/<profile> to the device. "
            "Optionally remove matching .py files after upload."
        )
    )
    parser.add_argument("--port", default="u0", help="mpremote port selector (default: u0).")
    parser.add_argument(
        "--mpremote",
        default="mpremote",
        help="Path to mpremote executable (default: mpremote from PATH/.venv).",
    )
    parser.add_argument(
        "--runtime-dir",
        default=str(DEFAULT_RUNTIME_DIR),
        help="Path to runtime/general folder containing _mpy profiles.",
    )
    parser.add_argument(
        "--profile",
        default=None,
        help="Profile folder name under _mpy. If omitted, newest profile is used.",
    )
    parser.add_argument(
        "--remove-py",
        action="store_true",
        help="Remove matching .py files on the device after uploading .mpy files.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned actions without uploading/removing files.",
    )
    return parser.parse_args()


def resolve_mpremote(explicit_value: str) -> str:
    if explicit_value != "mpremote":
        return explicit_value

    from_path = shutil.which("mpremote")
    if from_path:
        return from_path

    local_venv = REPO_ROOT / ".venv" / "bin" / "mpremote"
    if local_venv.is_file():
        return str(local_venv)

    return explicit_value


def find_profile_dir(runtime_dir: Path, profile_name: str | None) -> Path:
    root = runtime_dir / "_mpy"
    if not root.is_dir():
        raise FileNotFoundError(f"_mpy folder not found: {root}")

    if profile_name:
        profile_dir = root / profile_name
        if not profile_dir.is_dir():
            raise FileNotFoundError(f"Profile not found: {profile_dir}")
        return profile_dir

    profiles = [path for path in root.iterdir() if path.is_dir()]
    if not profiles:
        raise FileNotFoundError(f"No profile folders found in: {root}")

    profiles.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return profiles[0]


def list_mpy_files(profile_dir: Path) -> list[Path]:
    return sorted(path for path in profile_dir.rglob("*.mpy") if path.is_file())


def run_command(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=check, capture_output=True, text=True)


def soft_reset_device(mpremote_exe: str, port: str, dry_run: bool) -> None:
    command = [mpremote_exe, port, "soft-reset"]

    if dry_run:
        print("[dry-run] soft-reset device")
        return

    print("Soft-resetting device before deploy...")
    result = run_command(command, check=False)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise RuntimeError("Device soft-reset failed")


def ensure_remote_dirs(mpremote_exe: str, port: str, dirs: list[str], dry_run: bool) -> None:
    if not dirs:
        return

    snippet_lines = [
        "try:",
        " import os",
        "except Exception:",
        " import uos as os",
        "def ensure(path):",
        " cur = ''",
        " for part in path.split('/'):",
        "  if not part:",
        "   continue",
        "  cur = cur + '/' + part",
        "  try:",
        "   os.mkdir(cur)",
        "  except OSError:",
        "   pass",
    ]

    for path in dirs:
        snippet_lines.append(f"ensure('/{path}')")

    snippet = "\n".join(snippet_lines)
    command = [mpremote_exe, port, "exec", snippet]

    if dry_run:
        print("[dry-run] ensure dirs:", ", ".join(dirs))
        return

    result = run_command(command, check=False)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise RuntimeError("Failed creating remote directories")


def upload_mpy_files(
    mpremote_exe: str,
    port: str,
    profile_dir: Path,
    runtime_dir: Path,
    mpy_files: list[Path],
    dry_run: bool,
) -> None:
    iterator = mpy_files
    if tqdm is not None:
        iterator = tqdm(mpy_files, desc="Uploading .mpy", unit="file")

    for index, local_mpy in enumerate(iterator, start=1):
        rel_path = local_mpy.relative_to(profile_dir)
        remote_path = str(rel_path).replace("\\", "/")
        command = [mpremote_exe, port, "fs", "cp", str(local_mpy), f":{remote_path}"]

        if dry_run:
            print(f"[dry-run] upload [{index}/{len(mpy_files)}] {local_mpy} -> :{remote_path}")
            continue

        if tqdm is None:
            print(f"Uploading [{index}/{len(mpy_files)}]: :{remote_path}")

        result = run_command(command, check=False)
        if result.returncode != 0:
            if result.stdout:
                print(result.stdout, file=sys.stderr, end="")
            if result.stderr:
                print(result.stderr, file=sys.stderr, end="")
            raise RuntimeError(f"Upload failed for {local_mpy}")


def remove_matching_py_files(
    mpremote_exe: str,
    port: str,
    profile_dir: Path,
    mpy_files: list[Path],
    dry_run: bool,
) -> None:
    iterator = mpy_files
    if tqdm is not None:
        iterator = tqdm(mpy_files, desc="Removing .py", unit="file")

    for index, local_mpy in enumerate(iterator, start=1):
        rel_path = local_mpy.relative_to(profile_dir)
        py_rel_path = rel_path.with_suffix(".py")
        remote_py_path = str(py_rel_path).replace("\\", "/")
        command = [mpremote_exe, port, "fs", "rm", f":{remote_py_path}"]

        if dry_run:
            print(f"[dry-run] remove [{index}/{len(mpy_files)}] :{remote_py_path}")
            continue

        if tqdm is None:
            print(f"Removing [{index}/{len(mpy_files)}]: :{remote_py_path}")

        result = run_command(command, check=False)
        if result.returncode != 0:
            # Don't fail hard when a .py file is already absent.
            stderr_text = (result.stderr or "").lower()
            stdout_text = (result.stdout or "").lower()
            missing_indicators = ("enoent", "no such file", "not found")
            if not any(ind in stderr_text for ind in missing_indicators) and not any(
                ind in stdout_text for ind in missing_indicators
            ):
                if result.stdout:
                    print(result.stdout, file=sys.stderr, end="")
                if result.stderr:
                    print(result.stderr, file=sys.stderr, end="")
                raise RuntimeError(f"Failed removing :{remote_py_path}")


def main() -> int:
    args = parse_args()
    runtime_dir = Path(args.runtime_dir).expanduser().resolve()
    mpremote_exe = resolve_mpremote(args.mpremote)

    if not runtime_dir.is_dir():
        print(f"Runtime directory not found: {runtime_dir}", file=sys.stderr)
        return 1

    profile_dir = find_profile_dir(runtime_dir, args.profile)
    mpy_files = list_mpy_files(profile_dir)
    if not mpy_files:
        print(f"No .mpy files found in profile: {profile_dir}", file=sys.stderr)
        return 2

    remote_dirs = sorted(
        {
            str(path.relative_to(profile_dir).parent).replace("\\", "/")
            for path in mpy_files
            if str(path.relative_to(profile_dir).parent) not in ("", ".")
        },
        key=lambda p: (p.count("/"), p),
    )

    print(f"Using profile: {profile_dir.name}")
    print(f"Total .mpy files: {len(mpy_files)}")
    print(f"mpremote: {mpremote_exe}")
    print(f"port: {args.port}")

    try:
        soft_reset_device(mpremote_exe, args.port, args.dry_run)
        ensure_remote_dirs(mpremote_exe, args.port, remote_dirs, args.dry_run)
        upload_mpy_files(mpremote_exe, args.port, profile_dir, runtime_dir, mpy_files, args.dry_run)
        if args.remove_py:
            remove_matching_py_files(mpremote_exe, args.port, profile_dir, mpy_files, args.dry_run)
    except (FileNotFoundError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 3

    if args.dry_run:
        print("Dry run completed. No device files changed.")
    else:
        print("Deployment completed.")
        if args.remove_py:
            print("Matching .py files removed from device.")
        else:
            print("Matching .py files kept on device (use --remove-py to delete).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
