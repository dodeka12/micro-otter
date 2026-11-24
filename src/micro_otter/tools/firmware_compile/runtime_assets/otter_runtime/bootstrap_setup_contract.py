"""Bootstrap setup API contract constants and payload builders.

This module freezes schema boundaries shared by firmware setup status and
setup execution APIs. Keep it MicroPython-friendly and JSON-serializable.
"""

SCHEMA_VERSION = 1

REQUIRED_WRITABLE_PATHS = (
    "/manifest.json",
    "/device.json",
    "/app/main_loop.py",
)

FILE_ACTION_RESULTS = (
    "created",
    "updated",
    "unchanged",
    "error",
)

ERROR_CATEGORIES = (
    "validation",
    "filesystem",
    "runtime",
    "unsupported",
    "internal",
)


def _clone_rows(rows):
    cloned = []
    for row in rows or ():
        if isinstance(row, dict):
            cloned.append(dict(row))
    return cloned


def make_status_file_row(path, exists, valid, reason=None):
    row = {
        "path": str(path),
        "exists": bool(exists),
        "valid": bool(valid),
    }
    if reason is not None:
        row["reason"] = str(reason)
    return row


def make_setup_result_row(path, action, reason=None):
    if action not in FILE_ACTION_RESULTS:
        raise ValueError("Unsupported setup action result")

    row = {
        "path": str(path),
        "action": action,
    }
    if reason is not None:
        row["reason"] = str(reason)
    return row


def make_error_row(category, message, path=None):
    if category not in ERROR_CATEGORIES:
        raise ValueError("Unsupported setup error category")

    row = {
        "category": category,
        "message": str(message),
    }
    if path is not None:
        row["path"] = str(path)
    return row


def make_status_response(files, errors=None):
    file_rows = _clone_rows(files)
    error_rows = _clone_rows(errors)

    missing_or_invalid = []
    for row in file_rows:
        exists = bool(row.get("exists"))
        valid = bool(row.get("valid"))
        if not exists or not valid:
            reason = row.get("reason")
            missing_or_invalid.append(
                {
                    "path": row.get("path"),
                    "reason": str(reason) if reason is not None else "missing-or-invalid",
                }
            )

    ready = len(missing_or_invalid) == 0 and len(error_rows) == 0

    return {
        "schemaVersion": SCHEMA_VERSION,
        "ready": ready,
        "files": file_rows,
        "missingOrInvalid": missing_or_invalid,
        "errors": error_rows,
    }


def make_setup_response(results, errors=None):
    result_rows = _clone_rows(results)
    error_rows = _clone_rows(errors)

    has_result_error = False
    for row in result_rows:
        if row.get("action") == "error":
            has_result_error = True
            break

    ok = not has_result_error and len(error_rows) == 0

    return {
        "schemaVersion": SCHEMA_VERSION,
        "ok": ok,
        "results": result_rows,
        "errors": error_rows,
    }


def validate_status_response_shape(payload):
    if not isinstance(payload, dict):
        return False

    required_keys = ("schemaVersion", "ready", "files", "missingOrInvalid", "errors")
    for key in required_keys:
        if key not in payload:
            return False

    if payload.get("schemaVersion") != SCHEMA_VERSION:
        return False

    return (
        isinstance(payload.get("ready"), bool)
        and isinstance(payload.get("files"), list)
        and isinstance(payload.get("missingOrInvalid"), list)
        and isinstance(payload.get("errors"), list)
    )


def validate_setup_response_shape(payload):
    if not isinstance(payload, dict):
        return False

    required_keys = ("schemaVersion", "ok", "results", "errors")
    for key in required_keys:
        if key not in payload:
            return False

    if payload.get("schemaVersion") != SCHEMA_VERSION:
        return False

    return (
        isinstance(payload.get("ok"), bool)
        and isinstance(payload.get("results"), list)
        and isinstance(payload.get("errors"), list)
    )


__all__ = [
    "SCHEMA_VERSION",
    "REQUIRED_WRITABLE_PATHS",
    "FILE_ACTION_RESULTS",
    "ERROR_CATEGORIES",
    "make_status_file_row",
    "make_setup_result_row",
    "make_error_row",
    "make_status_response",
    "make_setup_response",
    "validate_status_response_shape",
    "validate_setup_response_shape",
]
