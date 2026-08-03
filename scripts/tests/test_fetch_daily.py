import pytest

from fetch_daily import assert_not_suspiciously_empty


def _days(sessions_list, start="2026-07-01"):
    import datetime as dt

    base = dt.date.fromisoformat(start)
    return [
        {"date": (base + dt.timedelta(days=i)).isoformat(), "sessions": s}
        for i, s in enumerate(sessions_list)
    ]


def test_raises_when_full_week_is_entirely_zero():
    data = {"days": _days([0] * 7)}
    with pytest.raises(SystemExit):
        assert_not_suspiciously_empty(data, "2026-07-01", "2026-07-07")


def test_does_not_raise_when_some_sessions_exist():
    data = {"days": _days([0, 0, 3, 0, 0, 0, 1])}
    assert_not_suspiciously_empty(data, "2026-07-01", "2026-07-07")  # 不拋例外


def test_does_not_raise_for_short_range_even_if_all_zero():
    """範圍太短（例如剛上線第一天）本來就可能真的是 0，不該誤判成管線故障。"""
    data = {"days": _days([0, 0, 0])}
    assert_not_suspiciously_empty(data, "2026-07-01", "2026-07-03")
