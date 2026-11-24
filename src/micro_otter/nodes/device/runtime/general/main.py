# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

try:
	import otter_runtime.bootstrap_setup_startup as _bootstrap_setup_startup
	import otter_main as _micro_otter_main
except Exception as _boot_import_error:
	print(
		"[error] boot: runtime import failed ({})".format(
			str(_boot_import_error).replace("\n", " ")
		)
	)
else:
	try:
		_bootstrap_setup_startup.run_bootstrap_setup_from_startup(
			_bootstrap_setup_startup.STARTUP_ADAPTER_TARGET_ENTRYPOINT
		)
	except Exception as _bootstrap_setup_error:
		print(
			"[error] boot: bootstrap setup trigger failed ({})".format(
				str(_bootstrap_setup_error).replace("\n", " ")
			)
		)

	_micro_otter_main.run()
