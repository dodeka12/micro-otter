"""Calendar arithmetic of the `time` node package, tested on CPython.

`otter_time.parts` is the dependency-free half of the package: it imports neither
`time` nor `machine` nor the clock service, which is exactly what makes it testable
here. See `docs/dev/nodes/time-node-system.md`.
"""

import sys
from pathlib import Path

import pytest

PKG_ROOT = Path('src/micro_otter/nodes/device/node_pkgs').resolve()


@pytest.fixture(scope='module')
def parts():
    sys.path.insert(0, str(PKG_ROOT / 'time'))
    import otter_time.parts as parts_module

    yield parts_module
    sys.path.remove(str(PKG_ROOT / 'time'))


# 1970-01-01 was a Thursday, i.e. weekday index 3 with 0 = Monday.
ROUND_TRIP_DATES = (
    (1970, 1, 1),
    (1970, 1, 2),
    (1999, 12, 31),
    (2000, 2, 29),
    (2023, 11, 14),
    (2024, 2, 29),
    (2100, 3, 1),
    (1969, 12, 31),
    (1900, 1, 1),
)


def test_civil_round_trip(parts):
    for year, month, day in ROUND_TRIP_DATES:
        days = parts.days_from_civil(year, month, day)
        assert parts.civil_from_days(days) == (year, month, day)


def test_epoch_origin_day_count(parts):
    assert parts.days_from_civil(1970, 1, 1) == 0
    assert parts.days_from_civil(1969, 12, 31) == -1
    assert parts.days_from_civil(1970, 1, 2) == 1


def test_negative_day_counts_stay_correct(parts):
    # 1900-01-01 lies before the epoch; flooring division must not drift.
    assert parts.days_from_civil(1900, 1, 1) == -25567
    assert parts.civil_from_days(-25567) == (1900, 1, 1)


def test_leap_day_handling(parts):
    assert parts.days_from_civil(2024, 3, 1) - parts.days_from_civil(2024, 2, 29) == 1
    assert parts.days_from_civil(2000, 3, 1) - parts.days_from_civil(2000, 2, 29) == 1
    # 2100 is not a leap year.
    assert parts.days_from_civil(2100, 3, 1) - parts.days_from_civil(2100, 2, 28) == 1


def test_weekday_index_is_zero_for_monday(parts):
    assert parts.weekday_index(parts.days_from_civil(1970, 1, 1)) == 3
    assert parts.weekday_index(parts.days_from_civil(2024, 2, 29)) == 3
    # 2024-03-04 was a Monday.
    assert parts.weekday_index(parts.days_from_civil(2024, 3, 4)) == 0
    # 1969-12-31 was a Wednesday.
    assert parts.weekday_index(parts.days_from_civil(1969, 12, 31)) == 2


def test_weekday_index_wraps_forward(parts):
    monday = parts.days_from_civil(2024, 3, 4)
    assert [parts.weekday_index(monday + offset) for offset in range(8)] == [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        0,
    ]


# 1700000000 == 2023-11-14T22:13:20Z, a Tuesday (weekday index 1).
KNOWN_EPOCH = 1700000000


def test_clock_parts_of_the_epoch_origin(parts):
    assert parts.clock_parts(0) == (0, 0, 0)
    assert parts.date_parts(0) == (1970, 1, 1, 3)


def test_clock_and_date_parts_of_a_known_instant(parts):
    assert parts.clock_parts(KNOWN_EPOCH) == (22, 13, 20)
    assert parts.date_parts(KNOWN_EPOCH) == (2023, 11, 14, 1)


def test_positive_offset_rolls_into_the_next_day(parts):
    assert parts.clock_parts(KNOWN_EPOCH, 2) == (0, 13, 20)
    assert parts.date_parts(KNOWN_EPOCH, 2) == (2023, 11, 15, 2)


def test_negative_offset_keeps_the_same_day(parts):
    assert parts.clock_parts(KNOWN_EPOCH, -5) == (17, 13, 20)
    assert parts.date_parts(KNOWN_EPOCH, -5) == (2023, 11, 14, 1)


def test_half_hour_offsets_are_exact(parts):
    assert parts.clock_parts(KNOWN_EPOCH, 5.5) == (3, 43, 20)
    assert parts.clock_parts(KNOWN_EPOCH, -11.5) == (10, 43, 20)


def test_epoch_before_1970(parts):
    assert parts.clock_parts(-1) == (23, 59, 59)
    assert parts.date_parts(-1) == (1969, 12, 31, 2)


def test_offset_extremes(parts):
    assert parts.date_parts(KNOWN_EPOCH, 14) == (2023, 11, 15, 2)
    assert parts.clock_parts(KNOWN_EPOCH, 14) == (12, 13, 20)
    assert parts.date_parts(KNOWN_EPOCH, -12) == (2023, 11, 14, 1)
    assert parts.clock_parts(KNOWN_EPOCH, -12) == (10, 13, 20)


def test_day_boundaries(parts):
    assert parts.clock_parts(86399) == (23, 59, 59)
    assert parts.clock_parts(86400) == (0, 0, 0)
    assert parts.date_parts(86399)[:3] == (1970, 1, 1)
    assert parts.date_parts(86400)[:3] == (1970, 1, 2)


def test_single_value_helpers_match_the_tuple_helpers(parts):
    assert parts.hour(KNOWN_EPOCH, 2) == 0
    assert parts.minute(KNOWN_EPOCH, 2) == 13
    assert parts.second(KNOWN_EPOCH, 2) == 20
    assert parts.year(KNOWN_EPOCH, 2) == 2023
    assert parts.month(KNOWN_EPOCH, 2) == 11
    assert parts.day(KNOWN_EPOCH, 2) == 15
    assert parts.weekday(KNOWN_EPOCH, 2) == 2
    assert parts.hour(KNOWN_EPOCH) == 22
    assert parts.weekday(KNOWN_EPOCH) == 1


def _local(parts, hour_value, minute_value, day=4, month=3, year=2024):
    """Epoch of a local wall-clock time (offset 0) on a fixed civil date."""
    days = parts.days_from_civil(year, month, day)
    return days * 86400 + hour_value * 3600 + minute_value * 60


def test_parse_hhmm_accepts_one_and_two_digit_hours(parts):
    assert parts.parse_hhmm('09:05') == 545
    assert parts.parse_hhmm('9:05') == 545
    assert parts.parse_hhmm(' 09:05 ') == 545
    assert parts.parse_hhmm('00:00') == 0
    assert parts.parse_hhmm('23:59') == 1439


@pytest.mark.parametrize('text', ['24:00', '12:60', '1200', '', 'ab:cd', '12', '12:60:00'])
def test_parse_hhmm_rejects_malformed_values(parts, text):
    with pytest.raises(ValueError):
        parts.parse_hhmm(text)


def test_minute_of_day(parts):
    assert parts.minute_of_day(_local(parts, 0, 0)) == 0
    assert parts.minute_of_day(_local(parts, 23, 59)) == 1439


def test_between_inside_a_plain_window(parts):
    assert parts.between(_local(parts, 8, 0), 0, '08:00', '17:00') is True
    assert parts.between(_local(parts, 16, 59), 0, '08:00', '17:00') is True
    assert parts.between(_local(parts, 12, 0), 0, '08:00', '17:00') is True
    assert parts.between(_local(parts, 7, 59), 0, '08:00', '17:00') is False


def test_between_end_is_exclusive(parts):
    assert parts.between(_local(parts, 17, 0), 0, '08:00', '17:00') is False
    assert parts.between(_local(parts, 17, 1), 0, '08:00', '17:00') is False


def test_between_window_past_midnight(parts):
    assert parts.between(_local(parts, 23, 30), 0, '22:00', '06:00') is True
    assert parts.between(_local(parts, 0, 0), 0, '22:00', '06:00') is True
    assert parts.between(_local(parts, 5, 59), 0, '22:00', '06:00') is True
    assert parts.between(_local(parts, 6, 0), 0, '22:00', '06:00') is False
    assert parts.between(_local(parts, 12, 0), 0, '22:00', '06:00') is False
    assert parts.between(_local(parts, 21, 59), 0, '22:00', '06:00') is False


def test_between_zero_length_window_is_a_full_day(parts):
    assert parts.between(_local(parts, 3, 0), 0, '08:00', '08:00') is True
    assert parts.between(_local(parts, 8, 0), 0, '08:00', '08:00') is True


def test_between_accepts_pre_parsed_minutes(parts):
    assert parts.between(_local(parts, 9, 0), 0, 480, 1020) is True
    assert parts.between(_local(parts, 18, 0), 0, 480, 1020) is False


def test_between_honours_the_offset(parts):
    # 23:00 UTC is 01:00 local at +2, i.e. inside 00:00-06:00.
    utc_2300 = _local(parts, 23, 0)
    assert parts.between(utc_2300, 0, '00:00', '06:00') is False
    assert parts.between(utc_2300, 2, '00:00', '06:00') is True


def test_format_time_date_pattern(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, '%Y-%m-%d') == '2023-11-14'


def test_format_time_clock_pattern_follows_the_offset(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, '%H:%M:%S') == '22:13:20'
    assert parts.format_time(KNOWN_EPOCH, 2, '%H:%M:%S') == '00:13:20'
    assert parts.format_time(KNOWN_EPOCH, 2, '%Y-%m-%d %H:%M:%S') == '2023-11-15 00:13:20'


def test_format_time_day_of_year(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, '%j') == '318'
    leap_day = parts.days_from_civil(2024, 2, 29) * 86400
    assert parts.format_time(leap_day, 0, '%j') == '060'


def test_format_time_leading_zeros(parts):
    assert parts.format_time(_local(parts, 9, 5), 0, '%H:%M:%S') == '09:05:00'
    assert parts.format_time(0, 0, '%Y-%m-%d') == '1970-01-01'


def test_format_time_escapes_and_unknown_specifiers(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, '%%') == '%'
    assert parts.format_time(KNOWN_EPOCH, 0, '100%%') == '100%'
    assert parts.format_time(KNOWN_EPOCH, 0, '%q') == '%q'
    assert parts.format_time(KNOWN_EPOCH, 0, '%%Y') == '%Y'
    assert parts.format_time(KNOWN_EPOCH, 0, 'trailing %') == 'trailing %'


def test_format_time_empty_pattern(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, '') == ''
    assert parts.format_time(KNOWN_EPOCH, 0, None) == ''


def test_format_time_plain_text_is_passed_through(parts):
    assert parts.format_time(KNOWN_EPOCH, 0, 'now') == 'now'


def test_day_of_year_helper(parts):
    assert parts.day_of_year(0) == 1
    assert parts.day_of_year(KNOWN_EPOCH) == 318
    assert parts.day_of_year(parts.days_from_civil(2024, 12, 31) * 86400) == 366

