import asyncio
import pathlib
import sys

import pytest
from tests.helpers.device_tools_env import install_micropython_shims

VARS_PKG_ROOT = pathlib.Path("src/micro_otter/nodes/device/node_pkgs/vars").resolve()


@pytest.fixture()
def signals(monkeypatch):
    install_micropython_shims(monkeypatch)
    sys.path.insert(0, str(VARS_PKG_ROOT))
    import otter_vars.signals as s

    s._signals = None
    s._edges = {}
    yield s
    sys.path.remove(str(VARS_PKG_ROOT))


def run_wait(module, key, timeout=0.05):
    """Drive one ``wait()`` to completion, or raise on a timeout."""
    return asyncio.run(asyncio.wait_for(module.wait(key), timeout=timeout))


def test_post_before_define_is_dropped(signals):
    signals.post("ghost")
    signals.define("k", ("ghost",), "any")
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")


def test_post_unknown_name_is_a_noop(signals):
    signals.define("k", ("sig",), "any")
    signals.post("unknown")
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")


def test_two_keys_watching_the_same_name_are_both_woken(signals):
    signals.define("a", ("sig",), "any")
    signals.define("b", ("sig",), "any")
    signals.post("sig")
    assert run_wait(signals, "a") is True
    assert run_wait(signals, "b") is True


def test_duplicate_names_in_define_collapse(signals):
    signals.define("k", ("sig", "sig", "other"), "any")
    signals.post("sig")
    assert run_wait(signals, "k") is True
    assert signals.fired("k") == ("sig",)


def test_any_one_post_satisfies_wait(signals):
    signals.define("k", ("sig",), "any")
    signals.post("sig")
    assert run_wait(signals, "k") is True


def test_any_two_posts_yield_exactly_one_return(signals):
    signals.define("k", ("sig",), "any")
    signals.post("sig")
    signals.post("sig")
    assert run_wait(signals, "k") is True
    assert signals.fired("k") == ("sig",)
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")


def test_fired_is_empty_before_the_first_run(signals):
    signals.define("k", ("sig",), "any")
    assert signals.fired("k") == ()


def test_all_waits_for_both_names(signals):
    signals.define("k", ("a", "b"), "all")
    signals.post("a")
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")
    signals.post("b")
    assert run_wait(signals, "k") is True
    assert set(signals.fired("k")) == {"a", "b"}


def test_all_is_satisfied_in_either_order(signals):
    for names in (("b", "a"), ("a", "b")):
        signals.define("k", ("a", "b"), "all")
        signals.post(names[0])
        signals.post(names[1])
        assert run_wait(signals, "k") is True
        assert set(signals.fired("k")) == {"a", "b"}


def test_all_counts_a_name_posted_twice_once(signals):
    signals.define("k", ("a", "b"), "all")
    signals.post("a")
    signals.post("a")
    signals.post("b")
    assert run_wait(signals, "k") is True
    assert len(signals.fired("k")) == 2
    assert set(signals.fired("k")) == {"a", "b"}


def test_consumption_empties_the_pending_set(signals):
    signals.define("k", ("sig",), "any")
    signals.post("sig")
    assert run_wait(signals, "k") is True
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")


def test_lost_wakeup_guard_returns_immediately(signals):
    signals.define("k", ("sig",), "any")
    # Post before entering ``wait``: the doorbell is cleared before the pending
    # set is checked, so this must return without suspending.
    signals.post("sig")
    assert run_wait(signals, "k") is True


def test_multi_listener_independence(signals):
    signals.define("a", ("sig",), "any")
    signals.define("b", ("sig",), "any")
    completed = []

    async def watcher(key):
        await signals.wait(key)
        completed.append(key)

    async def scenario():
        task_a = asyncio.create_task(watcher("a"))
        task_b = asyncio.create_task(watcher("b"))
        for _ in range(5):
            await asyncio.sleep(0)
        signals.post("sig")
        await asyncio.wait_for(asyncio.gather(task_a, task_b), timeout=1.0)

    asyncio.run(scenario())
    assert sorted(completed) == ["a", "b"]


def test_edge_rising_and_held_transitions(signals):
    assert signals.edge("k", False) is False
    assert signals.edge("k", True) is True
    assert signals.edge("k", True) is False
    assert signals.edge("k", False) is False
    assert signals.edge("k", True) is True


def test_edge_keys_are_independent(signals):
    assert signals.edge("a", True) is True
    assert signals.edge("b", False) is False
    assert signals.edge("b", True) is True


def test_empty_watch_list_never_satisfies_or_raises(signals):
    signals.define("k", (), "all")
    with pytest.raises(TimeoutError):
        run_wait(signals, "k")


def test_long_punctuated_name_round_trips(signals):
    name = ("a" * 32) + "-!@#" + ("b" * 28)
    assert len(name) == 64
    signals.define("k", (name,), "any")
    signals.post(name)
    assert run_wait(signals, "k") is True
    assert signals.fired("k") == (name,)
