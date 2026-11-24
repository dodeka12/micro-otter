"""Device code may only call the MicroPython subset of the CPython API.

``mpy-cross`` (``npm run check:device-syntax``) *compiles* the device tree, so it catches
syntax errors but not a call to a method MicroPython never implemented: that only fails on
the board, at runtime, inside whatever subsystem made the call. Two such calls shipped and
both stopped something on hardware (runtime 1.50.0, MicroPython v1.29.0, ESP32-S3):

* ``str.isalnum()`` in ``otter_hass.runtime._sanitize_id`` - ``AttributeError: 'str'
  object has no attribute 'isalnum'`` killed ``app.main_loop`` on every start, so the app
  never ran and the controller restarted it until the restart limit.
* ``Task.exception()`` in ``otter_main`` and ``otter_runtime.web_interface`` -
  ``AttributeError: 'Task' object has no attribute 'exception'`` replaced the real app
  failure with a bogus one and made a crashed server task look like a start timeout.

The table below is the difference between CPython and MicroPython's ``str`` (checked
against ``py/objstr.c`` of v1.29.0, which implements ``isspace``, ``isalpha``,
``isdigit``, ``isupper``, ``islower`` and no other ``is*`` predicate) plus the one
``asyncio`` method this runtime kept reaching for. Add an entry when a call is proven
missing on the device; a line that must stay gets the ``micropython-api-ok`` marker and a
reason.
"""

import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEVICE_TREE = REPO_ROOT / 'src' / 'micro_otter' / 'nodes' / 'device'

#: Directories that hold compiled output, not sources.
SKIPPED_DIRS = {'__pycache__', '__mpycache__'}

#: Trailing marker that exempts a single line (state why on the line).
ALLOW_MARKER = 'micropython-api-ok'

#: (pattern, name used in the message, what to use instead)
FORBIDDEN_CALLS = (
    (r'\.isalnum\(', 'str.isalnum()', 'test c.isalpha() or c.isdigit()'),
    (r'\.isascii\(', 'str.isascii()', 'check ord(c) < 128'),
    (r'\.isdecimal\(', 'str.isdecimal()', 'test c.isdigit()'),
    (r'\.isidentifier\(', 'str.isidentifier()', 'write the check explicitly'),
    (r'\.isnumeric\(', 'str.isnumeric()', 'test c.isdigit()'),
    (r'\.istitle\(', 'str.istitle()', 'no replacement; compare the characters'),
    (r'\.casefold\(', 'str.casefold()', 'use .lower()'),
    (r'\.removeprefix\(', 'str.removeprefix()', 'slice after startswith()'),
    (r'\.removesuffix\(', 'str.removesuffix()', 'slice after endswith()'),
    (r'\.swapcase\(', 'str.swapcase()', 'no replacement; map the characters'),
    (r'\.title\(', 'str.title()', 'no replacement; capitalise explicitly'),
    (r'\.capitalize\(', 'str.capitalize()', 'no replacement; capitalise explicitly'),
    (r'\.zfill\(', 'str.zfill()', 'format with leading zeros yourself'),
    (r'\.ljust\(', 'str.ljust()', 'pad with a format string'),
    (r'\.rjust\(', 'str.rjust()', 'pad with a format string'),
    (r'\.expandtabs\(', 'str.expandtabs()', 'no replacement'),
    (r'\.format_map\(', 'str.format_map()', 'use format(**mapping)'),
    (r'\.maketrans\(', 'str.maketrans()', 'no replacement; map the characters'),
    (r'\.translate\(', 'str.translate()', 'no replacement; map the characters'),
    (r'\.exception\(\)', 'asyncio.Task.exception()', 'await the task and catch what it raises'),
)

_COMPILED = tuple(
    (re.compile(pattern), name, hint) for pattern, name, hint in FORBIDDEN_CALLS
)
_HINTS = {name: hint for _pattern, name, hint in FORBIDDEN_CALLS}


def device_python_files(root=DEVICE_TREE):
    """Yield every device source file, skipping the compiled-output directories."""

    for path in sorted(pathlib.Path(root).rglob('*.py')):
        if SKIPPED_DIRS.intersection(path.parts):
            continue
        yield path


def find_forbidden_calls(root=DEVICE_TREE):
    """Return ``(path, lineno, name, line)`` for every unsupported call below *root*."""

    findings = []
    for path in device_python_files(root):
        allowed = False
        for lineno, line in enumerate(path.read_text(encoding='utf-8').splitlines(), start=1):
            # The marker exempts the call it annotates, on its own line or above it.
            if ALLOW_MARKER in line:
                allowed = True
                continue
            if allowed:
                allowed = False
                continue
            for pattern, name, _hint in _COMPILED:
                if pattern.search(line):
                    findings.append((path, lineno, name, line.strip()))
                    break
    return findings


def _device_tree(tmp_path, files):
    root = tmp_path / 'device'
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
    return root


def _message(finding):
    """Render one finding as a single actionable line for the assertion message."""
    path, lineno, name, line = finding
    hint = _HINTS[name]
    return (
        f'{path.relative_to(REPO_ROOT)}:{lineno}: {name} is not implemented by MicroPython '
        f'({line}) -> use {hint}'
    )


def test_device_tree_calls_only_the_micropython_api():
    findings = find_forbidden_calls()

    assert not findings, '\n'.join(_message(finding) for finding in findings)


def test_guard_reads_the_whole_tree():
    files = list(device_python_files())
    names = {str(path.relative_to(DEVICE_TREE)) for path in files}

    assert len(files) > 70, 'the guard must roam the whole device tree, not a subfolder'
    assert 'runtime/general/otter_main.py' in names
    assert 'node_pkgs/hass/otter_hass/runtime.py' in names


def test_guard_flags_the_str_method_that_stopped_the_hass_bridge(tmp_path):
    root = _device_tree(
        tmp_path,
        {'node_pkgs/hass/otter_hass/runtime.py': 'if char.isalnum():\n    pass\n'},
    )

    findings = find_forbidden_calls(root)

    assert [(finding[2], finding[1]) for finding in findings] == [('str.isalnum()', 1)]


def test_guard_flags_the_task_method_that_hid_the_real_failure(tmp_path):
    root = _device_tree(
        tmp_path, {'runtime/general/otter_main.py': 'failure = task.exception()\n'}
    )

    findings = find_forbidden_calls(root)

    assert [finding[2] for finding in findings] == ['asyncio.Task.exception()']


def test_guard_keeps_the_supported_predicates(tmp_path):
    root = _device_tree(
        tmp_path,
        {
            'driver.py': (
                'keep = char.isalpha() or char.isdigit() or char.isspace()\n'
                'case = text.upper() + text.lower() + text.strip()\n'
            )
        },
    )

    assert find_forbidden_calls(root) == []


def test_allow_marker_exempts_one_documented_line(tmp_path):
    root = _device_tree(
        tmp_path,
        {
            'driver.py': (
                '# micropython-api-ok: host-only helper, never imported on the board\n'
                'name = value.isalnum()\n'
            )
        },
    )

    assert find_forbidden_calls(root) == []


def test_guard_keeps_the_collection_reduction_builtins(tmp_path):
    root = _device_tree(
        tmp_path,
        {
            'node_pkgs/vars/otter_vars/arrays.py': (
                'values = sorted(buf)\n'
                'total = sum(values)\n'
                'lo = min(values)\n'
                'hi = max(values)\n'
            )
        },
    )

    assert find_forbidden_calls(root) == []


def test_compiled_output_is_not_scanned(tmp_path):
    root = _device_tree(
        tmp_path,
        {
            '__pycache__/driver.py': 'x = value.isalnum()\n',
            '__mpycache__/abcd/driver.py': 'x = value.isalnum()\n',
            'driver.py': 'x = value.isalpha()\n',
        },
    )

    assert find_forbidden_calls(root) == []
