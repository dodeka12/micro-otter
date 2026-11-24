import asyncio
import importlib.util
import sys
import types
from pathlib import Path

REFRESH_HOOK_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "webview"
    / "otter_webview"
    / "refresh_hook.py"
)


def _load_refresh_hook_module():
    original_micropython = sys.modules.get("micropython")
    micropython_module = types.ModuleType("micropython")
    micropython_module.const = lambda value: value
    sys.modules["micropython"] = micropython_module
    try:
        spec = importlib.util.spec_from_file_location("refresh_hook_under_test", REFRESH_HOOK_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if original_micropython is None:
            del sys.modules["micropython"]
        else:
            sys.modules["micropython"] = original_micropython


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FakeWebInterface:
    def __init__(self, snapshot):
        self._snapshot = dict(snapshot)
        self.last_clear_after_read = None
        self.published_values = []
        self.sync_requests = 0

    def request_webview_sync(self):
        self.sync_requests += 1
        return self.sync_requests

    def consume_webview_values_snapshot(self, clear_after_read=True):
        self.last_clear_after_read = bool(clear_after_read)
        snapshot = dict(self._snapshot)
        if clear_after_read:
            self._snapshot.clear()
        return snapshot

    def remove_webview_value_keys(self, keys):
        removed = 0
        for key in keys:
            if key in self._snapshot:
                self._snapshot.pop(key, None)
                removed += 1
        return removed

    def publish_webview_values(self, values):
        if isinstance(values, dict):
            self.published_values.append(dict(values))
            self._snapshot.update(values)
        return None


def test_refresh_hook_filters_updates_by_active_page_id():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_root": {"value": "root"},
        "k_page_a": {"value": "a"},
        "k_page_b": {"value": "b"},
    }
    web_interface = _FakeWebInterface(snapshot)
    request = _FakeRequest({"activePageId": "wv_page_page_node_page_a", "clearAfterRead": False})
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_root": {
            "element_id": "el-root",
            "kind": "content",
            "page_id": "wv_page_root_node_root",
        },
        "k_page_a": {
            "element_id": "el-a",
            "kind": "content",
            "page_id": "wv_page_page_node_page_a",
        },
        "k_page_b": {
            "element_id": "el-b",
            "kind": "content",
            "page_id": "wv_page_page_node_page_b",
        },
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is True
    assert response["route"] == "/api/webview/refresh"
    assert response["updates"] == [
        {
            "elementId": "el-a",
            "kind": "content",
            "payloadKey": "k_page_a",
            "value": "a",
        }
    ]
    assert web_interface.last_clear_after_read is False


def test_refresh_hook_requests_sync_when_initial_sync_flag_set():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface({})
    request = _FakeRequest({"initialSync": True})
    context = {"web_interface": web_interface}

    asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings={},
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert web_interface.sync_requests == 1


def test_refresh_hook_does_not_request_sync_for_ordinary_request():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface({})
    request = _FakeRequest({})
    context = {"web_interface": web_interface}

    asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings={},
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert web_interface.sync_requests == 0


def test_refresh_hook_keeps_unscoped_bindings_for_legacy_collections():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_legacy": {"value": "legacy"},
        "k_page_b": {"value": "b"},
    }
    web_interface = _FakeWebInterface(snapshot)
    request = _FakeRequest({"activePageId": "wv_page_page_node_page_a"})
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_legacy": {
            "element_id": "el-legacy",
            "kind": "content",
        },
        "k_page_b": {
            "element_id": "el-b",
            "kind": "content",
            "page_id": "wv_page_page_node_page_b",
        },
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["updates"] == [
        {
            "elementId": "el-legacy",
            "kind": "content",
            "payloadKey": "k_legacy",
            "value": "legacy",
        }
    ]
    assert web_interface.last_clear_after_read is False


def test_refresh_hook_defers_inactive_page_updates_until_page_is_active():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_root": {"value": "root"},
        "k_page_a": {"value": "a"},
        "k_page_b": {"value": "b"},
    }
    web_interface = _FakeWebInterface(snapshot)
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_root": {
            "element_id": "el-root",
            "kind": "content",
        },
        "k_page_a": {
            "element_id": "el-a",
            "kind": "content",
            "page_id": "wv_page_page_node_page_a",
        },
        "k_page_b": {
            "element_id": "el-b",
            "kind": "content",
            "page_id": "wv_page_page_node_page_b",
        },
    }

    first_response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest({"activePageId": "wv_page_page_node_page_a"}),
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert first_response["updates"] == [
        {
            "elementId": "el-root",
            "kind": "content",
            "payloadKey": "k_root",
            "value": "root",
        },
        {
            "elementId": "el-a",
            "kind": "content",
            "payloadKey": "k_page_a",
            "value": "a",
        },
    ]

    second_response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest({"activePageId": "wv_page_page_node_page_a"}),
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert second_response["updates"] == []

    third_response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest({"activePageId": "wv_page_page_node_page_b"}),
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert third_response["updates"] == [
        {
            "elementId": "el-b",
            "kind": "content",
            "payloadKey": "k_page_b",
            "value": "b",
        }
    ]


def test_refresh_hook_preserves_value_table_rows_payload():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_table": {
            "kind": "value-table",
            "rows": [
                {"label": "Time", "value": 1.25},
                {"label": "Delta", "value": 0.5},
            ],
        }
    }
    web_interface = _FakeWebInterface(snapshot)
    request = _FakeRequest({"activePageId": "wv_page_root_node_root", "clearAfterRead": False})
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_table": {
            "element_id": "el-table",
            "kind": "value-table",
            "page_id": "wv_page_root_node_root",
        }
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["updates"] == [
        {
            "elementId": "el-table",
            "kind": "value-table",
            "payloadKey": "k_table",
            "rows": [
                {"label": "Time", "value": 1.25},
                {"label": "Delta", "value": 0.5},
            ],
        }
    ]
    assert web_interface.last_clear_after_read is False


def test_refresh_hook_preserves_radar_snapshot_payload():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_radar": {
            "kind": "radar-display",
            "maxRadiusPx": 48,
            "startAngleDeg": -90,
            "endAngleDeg": 90,
            "pieceCount": 4,
            "fillColor": "#66ddff",
            "pieceIndex": 3,
            "pieceRadiusNormalized": 0.65,
            "sliceRadiiNormalized": [0.1, 0.35, 0.5, 0.65],
        }
    }
    web_interface = _FakeWebInterface(snapshot)
    request = _FakeRequest({"activePageId": "wv_page_root_node_root", "clearAfterRead": False})
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_radar": {
            "element_id": "el-radar",
            "kind": "radar-display",
            "page_id": "wv_page_root_node_root",
        }
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["updates"] == [
        {
            "elementId": "el-radar",
            "kind": "radar-display",
            "payloadKey": "k_radar",
            "maxRadiusPx": 48,
            "startAngleDeg": -90,
            "endAngleDeg": 90,
            "pieceCount": 4,
            "fillColor": "#66ddff",
            "pieceIndex": 3,
            "pieceRadiusNormalized": 0.65,
            "sliceRadiiNormalized": [0.1, 0.35, 0.5, 0.65],
        }
    ]
    assert web_interface.last_clear_after_read is False


def test_refresh_hook_merges_payload_fields_and_skips_reserved_or_private_keys():
    module = _load_refresh_hook_module()

    snapshot = {
        "k_generic": {
            "value": 99,
            "kind": "payload-kind-should-not-override-binding",
            "elementId": "payload-element-id-should-not-override-binding",
            "payloadKey": "payload-key-should-not-override-binding",
            "_internal": "do-not-forward",
            "customField": "forward-me",
        }
    }
    web_interface = _FakeWebInterface(snapshot)
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_generic": {
            "element_id": "el-generic",
            "kind": "content",
            "page_id": "wv_page_root_node_root",
        }
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest(
                {"activePageId": "wv_page_root_node_root", "clearAfterRead": False}
            ),
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["updates"] == [
        {
            "elementId": "el-generic",
            "kind": "content",
            "payloadKey": "k_generic",
            "value": 99,
            "customField": "forward-me",
        }
    ]


def test_refresh_hook_filters_non_json_safe_payload_values():
    module = _load_refresh_hook_module()

    class _NotJsonSafe:
        pass

    snapshot = {
        "k_safe": {
            "value": "ok",
            "nanValue": float("nan"),
            "infValue": float("inf"),
            "objValue": _NotJsonSafe(),
            "badList": [1, _NotJsonSafe()],
            "goodList": [1, 2, {"nested": True}],
            "badDict": {"nested": _NotJsonSafe()},
            "_private": "skip-me",
        }
    }
    web_interface = _FakeWebInterface(snapshot)
    context = {"web_interface": web_interface}
    refresh_bindings = {
        "k_safe": {
            "element_id": "el-safe",
            "kind": "content",
            "page_id": "wv_page_root_node_root",
        }
    }

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest(
                {"activePageId": "wv_page_root_node_root", "clearAfterRead": False}
            ),
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["updates"] == [
        {
            "elementId": "el-safe",
            "kind": "content",
            "payloadKey": "k_safe",
            "value": "ok",
            "goodList": [1, 2, {"nested": True}],
        }
    ]


def test_refresh_hook_applies_request_value_normalizers_and_publishes_updates():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface(snapshot={})
    context = {"web_interface": web_interface}
    request = _FakeRequest(
        {
            "activePageId": "wv_page_root_node_root",
            "dialUpdates": {"node-a": {"turns": 3}},
        }
    )

    def _normalize_dial_updates(payload):
        if not isinstance(payload, dict):
            return {}
        raw_updates = payload.get("dialUpdates")
        if not isinstance(raw_updates, dict):
            return {}

        normalized = {}
        for key, value in raw_updates.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            normalized[f"frontend:dial:{key}"] = {"turns": value.get("turns", 0)}
        return normalized

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings={},
            transient_key_prefixes=["frontend:dial:"],
            request_value_normalizers=[_normalize_dial_updates],
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is True
    assert response["updates"] == []
    assert web_interface.published_values == [
        {"frontend:dial:node-a": {"turns": 3}}
    ]
    assert "frontend:dial:node-a" in web_interface._snapshot


def test_refresh_hook_reports_request_normalizer_exceptions():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface(snapshot={})
    context = {"web_interface": web_interface}
    request = _FakeRequest({"value": 1})

    def _raises(_payload):
        raise RuntimeError("boom")

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings={},
            request_value_normalizers=[_raises],
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is False
    assert response["updates"] == []
    assert isinstance(response["error"], str)
    assert "boom" in response["error"]
    assert web_interface.published_values == []
    assert web_interface._snapshot == {}


def test_refresh_hook_defers_clear_when_normalizer_has_no_active_page_id():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface(snapshot={"stale:key": {"value": 1}})
    context = {"web_interface": web_interface}
    request = _FakeRequest({"clearAfterRead": True})

    def _publish_once(_payload):
        return {"frontend:dial:node-a": {"turns": 2}}

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings={},
            request_value_normalizers=[_publish_once],
            transient_key_prefixes=["frontend:dial:"],
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is True
    assert response["updates"] == []
    # Request-published transient updates must remain available for consumer code.
    assert web_interface.last_clear_after_read is False
    assert "frontend:dial:node-a" in web_interface._snapshot
    # Non-transient unmatched values are still cleaned up in deferred mode.
    assert "stale:key" not in web_interface._snapshot


def test_refresh_hook_preserves_registered_transient_prefixes_from_cleanup():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface(
        snapshot={
            "frontend:dial:node-a": {"turns": 2},
            "unbound:node-a": {"value": 1},
        }
    )
    context = {"web_interface": web_interface}

    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest({"activePageId": "wv_page_root_node_root"}),
            context=context,
            refresh_bindings={},
            transient_key_prefixes=["frontend:dial:"],
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is True
    assert response["updates"] == []
    assert "frontend:dial:node-a" in web_interface._snapshot
    assert "unbound:node-a" not in web_interface._snapshot


def test_refresh_hook_preserves_transient_prefixes_on_plain_poll():
    module = _load_refresh_hook_module()

    web_interface = _FakeWebInterface(
        snapshot={
            "frontend:dial:node-a": {"turns": 2},
            "unbound:node-a": {"value": 1},
        }
    )
    context = {"web_interface": web_interface}

    # A plain poll has no activePageId and publishes no transient update, but it
    # must still keep pending frontend values in the store so node loop code can
    # consume them before the next tick instead of clearing them away.
    response = asyncio.run(
        module.handle_post_webview_refresh(
            request=_FakeRequest({}),
            context=context,
            refresh_bindings={},
            transient_key_prefixes=["frontend:dial:"],
            post_refresh_route="/api/webview/refresh",
        )
    )

    assert response["success"] is True
    assert response["updates"] == []
    assert "frontend:dial:node-a" in web_interface._snapshot
    assert "unbound:node-a" not in web_interface._snapshot
