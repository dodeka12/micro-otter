# Package name: otter_webview (renamed from libs/webview in Phase 15).
# Web view node package modules; frozen into MicroPython firmware.
from .data_registry import WebDataRegistry
from .element_context import WebElementContext
from .web_data_store import WebDataStore

__all__ = [
    "WebDataRegistry",
    "WebElementContext",
    "WebDataStore",
]
