# -*- mode: python ; coding: utf-8 -*-
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""PyInstaller spec for the Windows ``micro-otter.exe`` (onefile).

The exe bundles the Micro-Otter server, the built web app
(``micro_otter/dist/webapp``), the toolchain assets
(``micro_otter/toolchain/assets``), and the node-package source tree the
collection-deploy path reads. It does NOT bundle ESP-IDF: firmware compile stays
on Docker/WSL.

Build it with ``deploy/packaging/build-exe.ps1`` on Windows (PyInstaller does not
cross-compile). The script installs the wheel first, so ``collect_data_files``
sees the packaged data trees rather than an editable source checkout.
"""

import os

from PyInstaller.utils.hooks import collect_data_files

# The data trees must be present in the *installed* package (not an editable
# checkout), so the exe embeds the same contents the wheel ships. Fail with a
# clear message when the wheel has not been installed yet.
import micro_otter as _pkg

_pkg_dir = os.path.dirname(_pkg.__file__)
for _rel in ("dist/webapp/index.html", "toolchain/assets/versions.env"):
    if not os.path.exists(os.path.join(_pkg_dir, _rel)):
        raise SystemExit(
            f"missing {_rel} in the installed micro_otter package; "
            "run deploy/packaging/build-exe.ps1 (which installs the wheel) first"
        )

datas = collect_data_files("micro_otter")

a = Analysis(
    ["deploy/packaging/pyinstaller/micro-otter-entry.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="micro-otter",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
