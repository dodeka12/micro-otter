"""Host-side tests for the ``irq`` package interrupt runtime.

``otter_irq.interrupts`` never imports ``machine``; the generated init block
passes a ``Pin`` object in, so every test here drives a fake pin and a fake
clock instead of hardware.
"""

import asyncio
import sys
import types
from pathlib import Path

import pytest

IRQ_PKG = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "irq"
)
sys.path.insert(0, str(IRQ_PKG))

import otter_irq.interrupts as interrupts  # noqa: E402

# ``tests/test_audio_i2s_output.py`` installs a host ``uasyncio`` stub in
# ``sys.modules`` at collection time and keeps it there so later device modules
# that import ``uasyncio`` themselves keep working. ``otter_irq.interrupts``
# binds whatever ``uasyncio`` resolves to when it is imported, so rebind it to
# the real ``asyncio`` when the ambient module is only that partial stub (it has
# no ``Event`` and no ``ThreadSafeFlag``).
if not hasattr(interrupts._asyncio, 'Event'):
    interrupts._asyncio = asyncio


class FakePin:
    """Minimal ``machine.Pin`` stand-in that records every ``irq`` call."""

    def __init__(self, level=0):
        """Start with ``level`` and an empty call log."""
        self.level = level
        self.calls = []
        self.handler = None
        self.trigger = None

    def irq(self, handler=None, trigger=None):
        """Record the arming call exactly as the runtime made it."""
        self.calls.append((handler, trigger))
        self.handler = handler
        self.trigger = trigger

    def value(self):
        """Return the current fake level."""
        return self.level


@pytest.fixture(autouse=True)
def _clean_registry():
    """Empty the module registry around every test."""
    interrupts.begin_generation()
    yield
    interrupts.begin_generation()


def _wait_times_out(channel, timeout=0.01):
    """Return ``True`` when an unset channel keeps ``wait()`` blocked."""

    async def scenario():
        try:
            await asyncio.wait_for(channel.wait(), timeout)
        except TimeoutError:
            return True
        return False

    return asyncio.run(scenario())


def _wait_returns(channel, timeout=0.5):
    """Return ``True`` when ``wait()`` completes within ``timeout``."""

    async def scenario():
        await asyncio.wait_for(channel.wait(), timeout)
        return True

    return asyncio.run(scenario())


def test_new_flag_uses_threadsafe_flag_when_the_runtime_has_one(monkeypatch):
    class _FakeFlag:
        """Stand-in for ``asyncio.ThreadSafeFlag``."""

        def set(self):
            """Accept the ISR wake-up."""

        async def wait(self):
            """Never block in this stub."""

    stub = types.SimpleNamespace(ThreadSafeFlag=_FakeFlag, Event=asyncio.Event)
    monkeypatch.setattr(interrupts, '_asyncio', stub)

    assert isinstance(interrupts._new_flag(), _FakeFlag)


def test_new_flag_falls_back_to_the_host_flag_on_cpython():
    if hasattr(asyncio, 'ThreadSafeFlag'):
        pytest.skip('this CPython ships ThreadSafeFlag')

    assert isinstance(interrupts._new_flag(), interrupts._HostFlag)


def test_host_flag_wait_returns_after_set_and_consumes_the_set():
    flag = interrupts._new_flag()

    async def scenario():
        flag.set()
        await asyncio.wait_for(flag.wait(), 0.5)
        try:
            await asyncio.wait_for(flag.wait(), 0.01)
        except TimeoutError:
            return True
        return False

    assert asyncio.run(scenario()) is True


def test_isr_gate_blocks_the_counter_and_the_flag():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')
    channel.set_enabled(False)

    channel.handler(pin)

    assert channel.count() == 0
    assert channel.take() is False
    assert _wait_times_out(channel)


def test_re_enabling_restores_counting_and_rearms_with_the_stored_trigger():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_FALLING')
    channel.set_enabled(False)
    channel.set_enabled(True)

    assert pin.calls[-1] == (channel.handler, 'IRQ_FALLING')

    channel.handler(pin)

    assert channel.count() == 1
    assert _wait_returns(channel)


def test_set_enabled_is_a_noop_when_the_state_is_unchanged():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')

    channel.set_enabled(True)
    channel.set_enabled(True)
    channel.set_enabled(False)
    channel.set_enabled(False)

    assert pin.calls == [(None, None)]


def test_debounce_suppresses_an_edge_inside_the_window(monkeypatch):
    clock = {'now': 1000}
    monkeypatch.setattr(interrupts, '_ticks_ms', lambda: clock['now'])
    monkeypatch.setattr(
        interrupts, '_ticks_diff', lambda current, previous: current - previous
    )

    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING', 50)
    clock['now'] = 1030
    channel.handler(pin)
    clock['now'] = 1040
    channel.handler(pin)

    assert channel.count() == 1

    clock['now'] = 1090
    channel.handler(pin)

    assert channel.count() == 2


def test_counter_wraps_through_the_small_int_mask_and_take_reports_it(monkeypatch):
    assert interrupts._COUNT_MASK == 0x3FFFFFFF
    monkeypatch.setattr(interrupts, '_COUNT_MASK', 1)

    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')
    assert channel.take() is False

    channel.handler(pin)

    assert channel.count() == 1
    assert channel.take() is True

    channel.handler(pin)

    assert channel.count() == 0
    assert channel.take() is True
    assert channel.take() is False


def test_take_reports_one_edge_batch_once():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')

    channel.handler(pin)
    channel.handler(pin)
    channel.handler(pin)

    assert channel.count() == 3
    assert channel.take() is True
    assert channel.take() is False


def test_wait_returns_for_an_edge_that_arrived_before_the_call():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')

    channel.handler(pin)

    assert _wait_returns(channel)
    assert _wait_times_out(channel)


def test_take_does_not_consume_the_flag():
    pin = FakePin()
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')

    channel.handler(pin)

    assert channel.take() is True
    assert _wait_returns(channel)


def test_state_reflects_the_pin_level():
    pin = FakePin(1)
    channel = interrupts.InterruptInput('button', pin, 'IRQ_RISING')

    assert channel.state() is True

    pin.level = 0

    assert channel.state() is False


def test_create_input_registers_and_arms_the_pin():
    pin = FakePin()

    channel = interrupts.create_input('  Button  ', pin, 'IRQ_RISING')

    assert channel.name == 'Button'
    assert interrupts.get_input('Button') is channel
    assert pin.calls == [(channel.handler, 'IRQ_RISING')]


def test_create_input_replaces_the_entry_and_rearms_that_pin():
    first_pin = FakePin()
    second_pin = FakePin()
    interrupts.create_input('Button', first_pin, 'IRQ_RISING')

    replacement = interrupts.create_input('Button', second_pin, 'IRQ_FALLING')

    assert interrupts.get_input('Button') is replacement
    assert second_pin.calls == [(replacement.handler, 'IRQ_FALLING')]


def test_create_input_requires_a_non_blank_name():
    with pytest.raises(ValueError):
        interrupts.create_input('   ', FakePin(), 'IRQ_RISING')


def test_module_set_enabled_returns_false_for_an_unknown_name():
    assert interrupts.set_enabled('missing', True) is False


def test_module_set_enabled_toggles_a_known_channel():
    pin = FakePin()
    channel = interrupts.create_input('Button', pin, 'IRQ_RISING')

    assert interrupts.set_enabled('Button', False) is True
    assert pin.calls[-1] == (None, None)

    assert interrupts.set_enabled('Button', True) is True
    assert pin.calls[-1] == (channel.handler, 'IRQ_RISING')


def test_begin_generation_detaches_in_registration_order_and_clears():
    detached = []

    class RecordingPin(FakePin):
        """Fake pin that logs the detach calls only."""

        def __init__(self, name):
            """Store the name used in the detach log."""
            super().__init__()
            self.name = name

        def irq(self, handler=None, trigger=None):
            """Record a detach before delegating to the shared fake."""
            if handler is None and trigger is None:
                detached.append(self.name)
            super().irq(handler, trigger)

    first = RecordingPin('first')
    second = RecordingPin('second')
    interrupts.create_input('first', first, 'IRQ_RISING')
    interrupts.create_input('second', second, 'IRQ_RISING')

    interrupts.begin_generation()

    assert detached == ['first', 'second']
    assert interrupts.get_input('first') is None
    assert interrupts.get_input('second') is None


def test_wait_raises_for_an_unknown_name():
    with pytest.raises(KeyError):
        asyncio.run(interrupts.wait('missing'))
