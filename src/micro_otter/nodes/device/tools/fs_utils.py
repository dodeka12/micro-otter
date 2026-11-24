# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Filesystem helpers used by the WebSerial bridge."""

import uos
import ubinascii
import sys


def _normalize(path: str) -> str:
    if not path:
        return ""
    normalized = path.replace("\\", "/")
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    return normalized.lstrip("/")


def ensure_dirs(path: str) -> None:
    normalized = _normalize(path)
    if not normalized:
        return
    segments = [segment for segment in normalized.split("/") if segment]
    current = ""
    for segment in segments:
        current = segment if not current else current + "/" + segment
        try:
            uos.mkdir(current)
        except OSError:
            pass


def path_exists(path: str) -> bool:
    normalized = _normalize(path)
    if not normalized:
        return False
    try:
        uos.stat(normalized)
        return True
    except OSError:
        return False


def read_file(path: str) -> str:
    normalized = _normalize(path)
    if not normalized:
        raise ValueError("Path cannot be empty")
    with open(normalized, "r") as handle:
        return handle.read()


def print_file(path: str) -> None:
    sys.stdout.write(read_file(path))


def reset_file(path: str) -> None:
    normalized = _normalize(path)
    if not normalized:
        raise ValueError("Path cannot be empty")
    ensure_dirs(normalized)
    open(normalized, "wb").close()


def append_base64_chunk(path: str, chunk_b64: str) -> None:
    normalized = _normalize(path)
    if not normalized:
        raise ValueError("Path cannot be empty")
    data = ubinascii.a2b_base64(chunk_b64)
    with open(normalized, "ab") as handle:
        handle.write(data)


def wipe_filesystem(excludes=None) -> None:
    normalized_excludes = set()
    for entry in excludes or []:
        normalized = _normalize(entry)
        if normalized:
            normalized_excludes.add(normalized)

    def _remove(target: str) -> None:
        normalized = _normalize(target)
        if normalized in normalized_excludes:
            return
        try:
            info = uos.stat(normalized)
        except OSError:
            return
        is_dir = (info[0] & 0x4000) != 0
        if is_dir:
            try:
                children = uos.listdir(normalized or ".")
            except OSError:
                return
            for name in children:
                if name in (".", ".."):
                    continue
                child = normalized + "/" + name if normalized else name
                _remove(child)
            if normalized and normalized not in normalized_excludes:
                try:
                    uos.rmdir(normalized)
                except OSError:
                    pass
        else:
            try:
                uos.remove(normalized)
            except OSError:
                pass

    try:
        entries = uos.listdir()
    except OSError:
        entries = []
    for entry in entries:
        if entry in (".", ".."):
            continue
        _remove(entry)


__all__ = [
    "append_base64_chunk",
    "ensure_dirs",
    "path_exists",
    "print_file",
    "read_file",
    "reset_file",
    "wipe_filesystem",
]
