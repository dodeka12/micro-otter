class WebElementContext:
    def __init__(self, page_runtime, page_id, element_id):
        self._page_runtime = page_runtime
        self._page_id = page_id
        self._element_id = element_id

    def set_text(self, text):
        self._page_runtime.queue_element_update(
            self._page_id,
            self._element_id,
            "set_text",
            {"text": text},
        )

    def set_attr(self, attr_name, value):
        self._page_runtime.queue_element_update(
            self._page_id,
            self._element_id,
            "set_attr",
            {
                "name": attr_name,
                "value": value,
            },
        )

    def set_class(self, class_name, enabled=True):
        self._page_runtime.queue_element_update(
            self._page_id,
            self._element_id,
            "set_class",
            {
                "name": class_name,
                "enabled": enabled,
            },
        )
