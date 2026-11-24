#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check serial access to /dev/ttyUSB0 (or another serial device)."
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Serial device path")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--timeout", type=float, default=1.0, help="Read timeout in seconds")
    parser.add_argument(
        "--read-bytes",
        type=int,
        default=0,
        help="Optionally read N bytes after opening (default: 0)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    print(f"Checking device: {args.port}")
    if not os.path.exists(args.port):
        print(f"FAIL: Device does not exist: {args.port}")
        return 2

    try:
        stat_result = os.stat(args.port)
        print(f"OK: Device exists (mode={oct(stat_result.st_mode)})")
    except OSError as exc:
        print(f"FAIL: Could not stat device: {exc}")
        return 3

    try:
        import serial
    except ImportError:
        print("FAIL: Missing dependency 'pyserial'.")
        print("Install with: uv pip install pyserial")
        return 4

    try:
        with serial.Serial(args.port, args.baud, timeout=args.timeout) as connection:
            print(
                f"OK: Opened {args.port} at {args.baud} baud "
                f"(is_open={connection.is_open})"
            )

            if args.read_bytes > 0:
                payload = connection.read(args.read_bytes)
                print(f"Read {len(payload)} bytes: {payload!r}")

    except Exception as exc:
        print(f"FAIL: Could not open serial device: {exc}")
        return 5

    print("SUCCESS: Serial device access is working.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
