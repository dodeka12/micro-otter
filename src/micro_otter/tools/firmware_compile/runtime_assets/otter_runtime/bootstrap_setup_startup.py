"""Startup contract for one-time bootstrap setup trigger.

This module defines the per-target startup adapter boundary and shared
idempotent helper semantics for calling bootstrap setup logic.
"""

STARTUP_TRIGGER_SCHEMA_VERSION = 1

STARTUP_ADAPTER_BOOT_PY = "boot.py"
STARTUP_ADAPTER_TARGET_ENTRYPOINT = "target-entrypoint"

SUPPORTED_STARTUP_ADAPTERS = (
    STARTUP_ADAPTER_BOOT_PY,
    STARTUP_ADAPTER_TARGET_ENTRYPOINT,
)

_startup_setup_executed = False


def make_startup_context(adapter, reason=None):
    adapter_name = str(adapter)
    if adapter_name not in SUPPORTED_STARTUP_ADAPTERS:
        raise ValueError("Unsupported startup adapter")

    context = {
        "schemaVersion": STARTUP_TRIGGER_SCHEMA_VERSION,
        "adapter": adapter_name,
    }
    if reason is not None:
        context["reason"] = str(reason)
    return context


def ensure_bootstrap_setup_once(setup_runner, context=None):
    global _startup_setup_executed

    if not callable(setup_runner):
        raise TypeError("setup_runner must be callable")

    if _startup_setup_executed:
        return {
            "schemaVersion": STARTUP_TRIGGER_SCHEMA_VERSION,
            "executed": False,
            "reason": "already-executed",
        }

    resolved_context = context if isinstance(context, dict) else {}
    if resolved_context:
        adapter = resolved_context.get("adapter")
        if adapter not in SUPPORTED_STARTUP_ADAPTERS:
            raise ValueError("Unsupported startup adapter in context")

    result = setup_runner(resolved_context)
    _startup_setup_executed = True

    return {
        "schemaVersion": STARTUP_TRIGGER_SCHEMA_VERSION,
        "executed": True,
        "reason": "invoked",
        "result": result,
    }


def run_bootstrap_setup_from_startup(adapter=STARTUP_ADAPTER_TARGET_ENTRYPOINT):
    context = make_startup_context(adapter)

    def _setup_runner(_context):
        from otter_runtime import embedded_metadata_api

        return embedded_metadata_api.apply_bootstrap_setup()

    return ensure_bootstrap_setup_once(_setup_runner, context)


def reset_startup_setup_latch_for_tests():
    global _startup_setup_executed
    _startup_setup_executed = False


__all__ = [
    "STARTUP_TRIGGER_SCHEMA_VERSION",
    "STARTUP_ADAPTER_BOOT_PY",
    "STARTUP_ADAPTER_TARGET_ENTRYPOINT",
    "SUPPORTED_STARTUP_ADAPTERS",
    "make_startup_context",
    "ensure_bootstrap_setup_once",
    "run_bootstrap_setup_from_startup",
    "reset_startup_setup_latch_for_tests",
]
