"""Core system helper functions for core node package runtime logic."""

import gc


def memory_info_kb(run_gc_before_read=True):
    """Return free heap memory in integer KB.

    If ``run_gc_before_read`` is truthy, this helper runs ``gc.collect()`` before
    reading free memory.

    The conversion policy is deterministic: ``free_kb = free_bytes // 1024``.
    If ``gc.mem_free`` is not available, the helper returns ``0``.
    """
    if run_gc_before_read and hasattr(gc, 'collect'):
        gc.collect()

    mem_free = getattr(gc, 'mem_free', None)
    if mem_free is None:
        return 0

    free_bytes = mem_free()
    if not isinstance(free_bytes, int):
        try:
            free_bytes = int(free_bytes)
        except (TypeError, ValueError):
            return 0

    if free_bytes < 0:
        return 0

    return free_bytes // 1024
