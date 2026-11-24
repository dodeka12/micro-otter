import math

from micropython import const

try:
    import utime as _time_source
except Exception:
    _time_source = None

_REFRESH_DEBUG_COUNTER = 0
_TRACE = const(0)
_JSON_SAFE_MAX_DEPTH = const(6)
_REQUEST_SAMPLE_INTERVAL = const(20)
_SLOW_REQUEST_THRESHOLD_MS = const(300)


def _ticks_ms():
    if _time_source is not None and hasattr(_time_source, "ticks_ms"):
        return _time_source.ticks_ms()
    return None


def _ticks_diff(current, previous):
    if current is None or previous is None:
        return None
    if _time_source is not None and hasattr(_time_source, "ticks_diff"):
        return _time_source.ticks_diff(current, previous)
    return current - previous


def _is_json_safe_value(value, max_depth=_JSON_SAFE_MAX_DEPTH):
    if max_depth < 0:
        return False

    if value is None or isinstance(value, (bool, int, str)):
        return True

    if isinstance(value, float):
        return math.isfinite(value)

    if isinstance(value, list):
        return all(_is_json_safe_value(item, max_depth=max_depth - 1) for item in value)

    if isinstance(value, dict):
        return all(
            isinstance(key, str)
            and not key.startswith("_")
            and _is_json_safe_value(item, max_depth=max_depth - 1)
            for key, item in value.items()
        )

    return False


def _merge_payload_update_fields(update, payload):
    if not isinstance(update, dict) or not isinstance(payload, dict):
        return None

    reserved_keys = {"elementId", "kind", "payloadKey"}
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        if key in reserved_keys or key.startswith("_"):
            continue
        if not _is_json_safe_value(value):
            continue
        update[key] = value

    return None


def _debug_log(debug_enabled, message, **fields):
    if not debug_enabled:
        return None

    if not isinstance(fields, dict) or not fields:
        print("[data] webview-hook:", message)
        return None

    print("[data] webview-hook:", message, fields)
    return None


def _normalize_request_value_normalizers(request_value_normalizers):
    if not isinstance(request_value_normalizers, (list, tuple)):
        return ()

    normalized = []
    for candidate in request_value_normalizers:
        if callable(candidate):
            normalized.append(candidate)

    if not normalized:
        return ()

    return tuple(normalized)


def _normalize_transient_key_prefixes(transient_key_prefixes):
    if not isinstance(transient_key_prefixes, (list, tuple)):
        return ()

    normalized = []
    for prefix in transient_key_prefixes:
        if not isinstance(prefix, str):
            continue
        trimmed = prefix.strip()
        if not trimmed:
            continue
        normalized.append(trimmed)

    if not normalized:
        return ()

    # Preserve declaration order while removing duplicates.
    deduped = list(dict.fromkeys(normalized))
    return tuple(deduped)


def register_extra_routes(*, server, context, static_routes, debug_enabled=False):
    del server

    web_interface = None
    if isinstance(context, dict):
        web_interface = context.get("web_interface")

    if web_interface is None:
        _debug_log(debug_enabled, "register-extra-routes:no-web-interface")
        return None

    register_route = getattr(web_interface, "register_static_asset_route", None)
    if not callable(register_route):
        _debug_log(debug_enabled, "register-extra-routes:no-register-function")
        return None

    for route in static_routes:
        register_route(
            route["route"],
            content_type=route["content_type"],
            fallback_path=route["fallback_path"],
            compressed_path=route.get("compressed_path"),
            force_compressed_only=bool(route.get("force_compressed_only", False)),
            is_binary_fallback=bool(route.get("is_binary_fallback", False)),
        )

    _debug_log(
        debug_enabled,
        "register-extra-routes:completed",
        route_count=len(static_routes),
    )
    return None


async def handle_post_webview_refresh(
    *,
    request,
    context,
    refresh_bindings,
    transient_key_prefixes=None,
    request_value_normalizers=None,
    post_refresh_route,
    debug_enabled=False,
):
    global _REFRESH_DEBUG_COUNTER
    _REFRESH_DEBUG_COUNTER += 1
    request_counter = _REFRESH_DEBUG_COUNTER
    started_at_ms = _ticks_ms()

    request_payload = {}
    request_json = getattr(request, "json", None)
    if callable(request_json):
        try:
            parsed_payload = request_json()
            if isinstance(parsed_payload, dict):
                request_payload = parsed_payload
        except Exception as exc:
            request_payload = {}
            _debug_log(debug_enabled, "refresh:request-json-parse-failed", error=str(exc))

    if _TRACE:
        print("[data] wv-refresh:", request_counter, "request-keys", list(request_payload.keys()))

    clear_after_read = True
    if isinstance(request_payload, dict) and "clearAfterRead" in request_payload:
        clear_after_read = bool(request_payload.get("clearAfterRead"))
    active_page_id = ""
    if isinstance(request_payload, dict) and "activePageId" in request_payload:
        raw_active_page_id = request_payload.get("activePageId")
        if isinstance(raw_active_page_id, str):
            active_page_id = raw_active_page_id.strip()

    initial_sync = False
    if isinstance(request_payload, dict):
        initial_sync = bool(request_payload.get("initialSync"))

    if _TRACE and initial_sync:
        print("[data] wv-refresh:", request_counter, "INITIAL-SYNC-DETECTED")

    web_interface = None
    if isinstance(context, dict):
        web_interface = context.get("web_interface")

    consume_snapshot = None
    remove_keys = None
    publish_values = None
    if web_interface is not None:
        consume_snapshot = getattr(web_interface, "consume_webview_values_snapshot", None)
        remove_keys = getattr(web_interface, "remove_webview_value_keys", None)
        publish_values = getattr(web_interface, "publish_webview_values", None)

    if initial_sync and web_interface is not None:
        request_sync = getattr(web_interface, "request_webview_sync", None)
        if callable(request_sync):
            try:
                new_epoch = request_sync()
                if _TRACE:
                    print("[data] wv-refresh:", request_counter, "sync-epoch-bumped", new_epoch)
            except Exception as exc:
                _debug_log(
                    debug_enabled, "refresh:request-sync-failed", error=str(exc)
                )
        elif _TRACE:
            print("[data] wv-refresh:", request_counter, "no-request-sync-method")

    request_transient_update_count = 0
    request_normalizer_error = None
    normalizers = _normalize_request_value_normalizers(request_value_normalizers)
    for normalizer in normalizers:
        try:
            normalized_candidate = normalizer(request_payload)
        except Exception as exc:
            request_normalizer_error = (
                "Request value normalizer failed: %s (%s)"
                % (repr(normalizer), str(exc))
            )
            _debug_log(
                debug_enabled,
                "refresh:request-normalizer-failed",
                normalizer=repr(normalizer),
                error=str(exc),
            )
            break

        if not isinstance(normalized_candidate, dict) or not normalized_candidate:
            continue

        request_transient_update_count += len(normalized_candidate)
        if callable(publish_values):
            try:
                publish_values(normalized_candidate)
            except Exception as exc:
                _debug_log(
                    debug_enabled,
                    "refresh:publish-request-normalized-values-failed",
                    normalizer=repr(normalizer),
                    error=str(exc),
                )

    if _TRACE:
        print(
            "[data] wv-refresh:",
            request_counter,
            "transient-updates",
            request_transient_update_count,
            "normalizer-error",
            request_normalizer_error,
        )

    preserve_prefixes = _normalize_transient_key_prefixes(transient_key_prefixes)

    snapshot = {}
    use_deferred_page_scope = bool(
        clear_after_read
        and (active_page_id or request_transient_update_count > 0 or preserve_prefixes)
    )
    if callable(consume_snapshot):
        consumed = consume_snapshot(
            clear_after_read=bool(clear_after_read and not use_deferred_page_scope)
        )
        if isinstance(consumed, dict):
            snapshot = consumed

    _debug_log(
        debug_enabled,
        "refresh:snapshot-received",
        clear_after_read=clear_after_read,
        snapshot_keys=len(snapshot),
        binding_keys=len(refresh_bindings),
    )

    if _TRACE:
        print("[data] wv-refresh:", request_counter, "snapshot-keys", list(snapshot.keys()))

    updates = []
    unmatched_keys = 0
    filtered_keys = 0
    unmatched_frontend_keys = 0
    delivered_payload_keys = [] if use_deferred_page_scope else None
    unmatched_payload_keys = [] if use_deferred_page_scope else None
    for payload_key in snapshot:
        if isinstance(payload_key, str) and any(
            payload_key.startswith(prefix) for prefix in preserve_prefixes
        ):
            # Keep transient frontend updates in the store so node loop code can
            # consume them via consume_webview_values_keys.
            unmatched_frontend_keys += 1
            continue

        binding = refresh_bindings.get(payload_key)
        if not isinstance(binding, dict):
            unmatched_keys += 1
            if unmatched_payload_keys is not None:
                unmatched_payload_keys.append(payload_key)
            continue

        binding_page_id = binding.get("page_id")
        if not isinstance(binding_page_id, str):
            binding_page_id = ""
        else:
            binding_page_id = binding_page_id.strip()

        if active_page_id and binding_page_id and binding_page_id != active_page_id:
            filtered_keys += 1
            continue

        payload = snapshot.get(payload_key)
        update = {
            "elementId": binding.get("element_id"),
            "kind": binding.get("kind"),
            "payloadKey": payload_key,
        }

        if isinstance(payload, dict):
            _merge_payload_update_fields(update, payload)
        else:
            update["value"] = payload

        updates.append(update)
        if delivered_payload_keys is not None:
            delivered_payload_keys.append(payload_key)

    deferred_retained_count = 0
    if use_deferred_page_scope and callable(remove_keys):
        has_delivered = bool(delivered_payload_keys)
        has_unmatched = bool(unmatched_payload_keys)
        if has_delivered or has_unmatched:
            removal_keys = []
            if has_delivered:
                removal_keys.extend(delivered_payload_keys)
            if has_unmatched:
                removal_keys.extend(unmatched_payload_keys)
            try:
                remove_keys(removal_keys)
            except Exception as exc:
                _debug_log(debug_enabled, "refresh:remove-keys-failed", error=str(exc))

    if use_deferred_page_scope:
        deferred_retained_count = filtered_keys

    _debug_log(
        debug_enabled,
        "refresh:response-ready",
        update_count=len(updates),
        unmatched_keys=unmatched_keys,
        unmatched_frontend_keys=unmatched_frontend_keys,
        filtered_keys=filtered_keys,
        deferred_retained_count=deferred_retained_count,
        active_page_id=active_page_id,
    )

    if _TRACE:
        print(
            "[data] wv-refresh:",
            request_counter,
            "response-updates",
            len(updates),
            [entry.get("payloadKey") for entry in updates],
        )

    elapsed_ms = _ticks_diff(_ticks_ms(), started_at_ms)
    should_sample = (request_counter % _REQUEST_SAMPLE_INTERVAL) == 0
    is_slow = elapsed_ms is not None and elapsed_ms >= _SLOW_REQUEST_THRESHOLD_MS
    if should_sample or is_slow:
        _debug_log(
            debug_enabled,
            "refresh:timing",
            request_counter=request_counter,
            elapsed_ms=elapsed_ms,
            active_page_id=active_page_id,
            snapshot_keys=len(snapshot),
            update_count=len(updates),
            filtered_keys=filtered_keys,
            unmatched_keys=unmatched_keys,
        )

    return {
        "success": request_normalizer_error is None,
        "updates": updates,
        "route": post_refresh_route,
        "error": request_normalizer_error,
    }
