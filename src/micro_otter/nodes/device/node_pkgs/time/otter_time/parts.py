# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Dependency-free calendar arithmetic for the ``time`` node package.

Every function here is pure integer arithmetic on a UTC epoch: nothing imports
``time``, ``machine``, ``network`` or the clock service, so the module runs on
CPython (which is how it is tested) and on MicroPython alike.

Conventions used throughout this module:

* an *epoch* is a UTC timestamp in whole seconds since 1970-01-01T00:00:00Z and may
  be negative (dates before 1970 are valid);
* an *offset* is a fixed UTC offset in hours (``-12`` … ``+14``, half hours
  allowed); it is added to the epoch before any field is derived, so a positive
  offset is "local time ahead of UTC";
* a *weekday index* is ``0`` for Monday … ``6`` for Sunday (ISO order).

The civil-date conversion is Howard Hinnant's ``days_from_civil`` /
``civil_from_days`` pair, which needs no leap-year table and stays correct for
negative day counts because all divisions floor (``//``).
"""

SECONDS_PER_DAY = 86400


def days_from_civil(year, month, day):
    """Return the day count of *year-month-day* relative to 1970-01-01."""
    y = int(year)
    m = int(month)
    d = int(day)
    if m <= 2:
        y -= 1
    era = y // 400
    yoe = y - era * 400
    if m > 2:
        mp = m - 3
    else:
        mp = m + 9
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def civil_from_days(days):
    """Return ``(year, month, day)`` for a day count relative to 1970-01-01."""
    z = int(days) + 719468
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    if mp < 10:
        m = mp + 3
    else:
        m = mp - 9
    if m <= 2:
        y += 1
    return (y, m, d)


def weekday_index(days):
    """Return the weekday of a day count with ``0`` = Monday … ``6`` = Sunday."""
    # 1970-01-01 was a Thursday, so day 0 maps to index 3.
    return (int(days) + 3) % 7


def _offset_seconds(offset_hours):
    """Return a fixed UTC offset in whole seconds (half hours are exact)."""
    return int(offset_hours * 3600)


def clock_parts(epoch, offset_hours=0):
    """Return ``(hour, minute, second)`` of *epoch* shifted by *offset_hours*.

    The offset is applied before the modulo, so the fields describe local time.
    Modulo keeps the result non-negative for epochs before 1970.
    """
    local = int(epoch) + _offset_seconds(offset_hours)
    seconds = local % SECONDS_PER_DAY
    return (seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def date_parts(epoch, offset_hours=0):
    """Return ``(year, month, day, weekday)`` of *epoch* shifted by *offset_hours*.

    ``weekday`` is ``0`` for Monday … ``6`` for Sunday. Negative epochs (dates
    before 1970) are valid and stay correct because the day count floors.
    """
    local = int(epoch) + _offset_seconds(offset_hours)
    days = local // SECONDS_PER_DAY
    year, month, day = civil_from_days(days)
    return (year, month, day, weekday_index(days))


def hour(epoch, offset_hours=0):
    """Return the local hour (0–23) of *epoch*."""
    return clock_parts(epoch, offset_hours)[0]


def minute(epoch, offset_hours=0):
    """Return the local minute (0–59) of *epoch*."""
    return clock_parts(epoch, offset_hours)[1]


def second(epoch, offset_hours=0):
    """Return the local second (0–59) of *epoch*."""
    return clock_parts(epoch, offset_hours)[2]


def year(epoch, offset_hours=0):
    """Return the local year of *epoch*."""
    return date_parts(epoch, offset_hours)[0]


def month(epoch, offset_hours=0):
    """Return the local month (1–12) of *epoch*."""
    return date_parts(epoch, offset_hours)[1]


def day(epoch, offset_hours=0):
    """Return the local day of month (1–31) of *epoch*."""
    return date_parts(epoch, offset_hours)[2]


def weekday(epoch, offset_hours=0):
    """Return the local weekday (``0`` = Monday … ``6`` = Sunday) of *epoch*."""
    return date_parts(epoch, offset_hours)[3]


def parse_hhmm(text):
    """Return the minutes of day of a ``H:MM`` / ``HH:MM`` wall-clock string.

    Surrounding whitespace is ignored and the hour may carry one or two digits.
    Out-of-range values and anything that is not ``HH:MM`` raise ``ValueError``:
    the node definitions only ever produce valid values, so a malformed string is
    a programming error rather than a user-input path.
    """
    raw = '' if text is None else str(text).strip()
    fields = raw.split(':')
    if len(fields) != 2:
        raise ValueError('expected HH:MM, got %r' % (text,))
    hour_text = fields[0].strip()
    minute_text = fields[1].strip()
    if not hour_text.isdigit() or not minute_text.isdigit():
        raise ValueError('expected HH:MM, got %r' % (text,))
    hour_value = int(hour_text)
    minute_value = int(minute_text)
    if hour_value > 23 or minute_value > 59:
        raise ValueError('time out of range, got %r' % (text,))
    return hour_value * 60 + minute_value


def minute_of_day(epoch, offset_hours=0):
    """Return the local minute of day (0–1439) of *epoch*."""
    clock = clock_parts(epoch, offset_hours)
    return clock[0] * 60 + clock[1]


def between(epoch, offset_hours, start, end):
    """Return whether local time lies inside the ``[start, end)`` window.

    * ``start`` and ``end`` are minutes of day or ``HH:MM`` strings.
    * The window is half-open: ``start`` is inside, ``end`` is outside.
    * ``start > end`` wraps past midnight (``22:00`` → ``06:00``), so the window
      covers the evening and the following morning.
    * ``start == end`` is a full day (``True``), so a zero-length window never
      silently disables a node.
    """
    if isinstance(start, str):
        start_minute = parse_hhmm(start)
    else:
        start_minute = int(start)
    if isinstance(end, str):
        end_minute = parse_hhmm(end)
    else:
        end_minute = int(end)
    current = minute_of_day(epoch, offset_hours)
    if start_minute == end_minute:
        return True
    if start_minute < end_minute:
        return start_minute <= current < end_minute
    return current >= start_minute or current < end_minute


def day_of_year(epoch, offset_hours=0):
    """Return the local day of year (1–366) of *epoch*."""
    year_value, month_value, day_value, _weekday = date_parts(epoch, offset_hours)
    return days_from_civil(year_value, month_value, day_value) - days_from_civil(
        year_value, 1, 1
    ) + 1


def _pad(value, width):
    """Return a non-negative integer as decimal text of at least *width* digits."""
    text = str(int(value))
    while len(text) < width:
        text = '0' + text
    return text


def _pad2(value):
    """Return *value* zero-padded to two digits."""
    return _pad(value, 2)


def _pad3(value):
    """Return *value* zero-padded to three digits."""
    return _pad(value, 3)


def _pad4(value):
    """Return *value* zero-padded to four digits."""
    return _pad(value, 4)


def format_time(epoch, offset_hours, pattern):
    """Render *epoch* with the supported ``strftime``-like specifiers.

    Supported: ``%Y`` (year), ``%m`` (month), ``%d`` (day of month), ``%H``
    (hour), ``%M`` (minute), ``%S`` (second), ``%j`` (day of year, 001–366) and
    ``%%`` (a literal percent sign). An unknown specifier is emitted verbatim
    (``%q`` stays ``%q``) instead of raising, so a typo in a control value cannot
    break the loop.
    """
    text = '' if pattern is None else str(pattern)
    if not text:
        return ''
    hour_value, minute_value, second_value = clock_parts(epoch, offset_hours)
    year_value, month_value, day_value, _weekday = date_parts(epoch, offset_hours)
    doy = day_of_year(epoch, offset_hours)
    out = []
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char != '%' or index + 1 >= length:
            out.append(char)
            index += 1
            continue
        spec = text[index + 1]
        index += 2
        if spec == 'Y':
            out.append(_pad4(year_value))
        elif spec == 'm':
            out.append(_pad2(month_value))
        elif spec == 'd':
            out.append(_pad2(day_value))
        elif spec == 'H':
            out.append(_pad2(hour_value))
        elif spec == 'M':
            out.append(_pad2(minute_value))
        elif spec == 'S':
            out.append(_pad2(second_value))
        elif spec == 'j':
            out.append(_pad3(doy))
        elif spec == '%':
            out.append('%')
        else:
            out.append('%' + spec)
    return ''.join(out)
