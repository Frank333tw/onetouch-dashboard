from transform_daily import (
    format_date, build_days, build_days_by_unit, build_days_by_tool, build_days_by_device,
)


def test_format_date_converts_yyyymmdd_to_dashed():
    assert format_date("20260701") == "2026-07-01"
    assert format_date("20261231") == "2026-12-31"


def test_build_days_combines_totals_events_and_hub_views():
    totals_rows = [
        {"dims": ["20260701"], "metrics": ["12", "9"]},
        {"dims": ["20260702"], "metrics": ["8", "6"]},
    ]
    event_rows = [
        {"dims": ["20260701", "tool_open"], "metrics": ["5"]},
        {"dims": ["20260701", "result_view"], "metrics": ["2"]},
        {"dims": ["20260701", "result_generate_image"], "metrics": ["1"]},
        {"dims": ["20260701", "result_download"], "metrics": ["1"]},
        {"dims": ["20260702", "tool_open"], "metrics": ["3"]},
    ]
    page_rows = [
        {"dims": ["20260701", "/hub/contact"], "metrics": ["8"]},
        {"dims": ["20260701", "/tool/behavior-disc"], "metrics": ["5"]},
        {"dims": ["20260702", "/hub/contact"], "metrics": ["4"]},
    ]

    days = build_days(totals_rows, event_rows, page_rows, "2026-07-01", "2026-07-02")

    assert len(days) == 2
    d1 = next(d for d in days if d["date"] == "2026-07-01")
    assert d1["sessions"] == 12
    assert d1["active_users"] == 9
    assert d1["tool_open"] == 5
    assert d1["result_view"] == 2
    assert d1["result_generate_image"] == 1
    assert d1["result_download"] == 1
    assert d1["result_share"] == 0, "沒出現的事件要補 0，不是漏欄位"
    assert d1["hub_view"] == 8, "/hub/ 開頭的頁面瀏覽數加總，不含 /tool/"

    d2 = next(d for d in days if d["date"] == "2026-07-02")
    assert d2["tool_open"] == 3
    assert d2["hub_view"] == 4


def test_build_days_sorted_chronologically():
    totals_rows = [
        {"dims": ["20260703"], "metrics": ["1", "1"]},
        {"dims": ["20260701"], "metrics": ["1", "1"]},
        {"dims": ["20260702"], "metrics": ["1", "1"]},
    ]
    days = build_days(totals_rows, [], [], "2026-07-01", "2026-07-03")
    assert [d["date"] for d in days] == ["2026-07-01", "2026-07-02", "2026-07-03"]


def test_build_days_includes_feedback_funnel_events():
    totals_rows = [{"dims": ["20260701"], "metrics": ["1", "1"]}]
    event_rows = [
        {"dims": ["20260701", "result_feedback_opened"], "metrics": ["4"]},
        {"dims": ["20260701", "result_feedback_page2_view"], "metrics": ["2"]},
        {"dims": ["20260701", "result_feedback_submitted"], "metrics": ["2"]},
        {"dims": ["20260701", "result_feedback_pdf_download"], "metrics": ["1"]},
        {"dims": ["20260701", "feedback_submitted"], "metrics": ["99"]},
    ]
    days = build_days(totals_rows, event_rows, [], "2026-07-01", "2026-07-01")
    d = days[0]
    assert d["feedback_opened"] == 4
    assert d["feedback_page2"] == 2
    assert d["feedback_submitted"] == 2
    assert d["feedback_pdf"] == 1
    # 站務意見信箱 feedback_submitted（右下角浮動按鈕）不可跟受測者回饋問卷的
    # result_feedback_submitted 混用——這裡用了誇張值 99 確保沒被誤加進去
    assert d["feedback_submitted"] != 99


def test_build_days_by_unit_pivots_source_and_event():
    rows = [
        {"dims": ["20260701", "feiang", "tool_open"], "metrics": ["3"]},
        {"dims": ["20260701", "feiang", "result_view"], "metrics": ["1"]},
        {"dims": ["20260701", "taian", "tool_open"], "metrics": ["2"]},
    ]
    result = build_days_by_unit(rows)
    assert len(result) == 2
    feiang = next(r for r in result if r["source"] == "feiang")
    assert feiang["date"] == "2026-07-01"
    assert feiang["tool_open"] == 3
    assert feiang["result_view"] == 1
    taian = next(r for r in result if r["source"] == "taian")
    assert taian["tool_open"] == 2
    assert taian["result_view"] == 0


def test_build_days_by_tool_filters_tool_paths_only():
    rows = [
        {"dims": ["20260701", "/tool/behavior-disc"], "metrics": ["5"]},
        {"dims": ["20260701", "/hub/contact"], "metrics": ["8"]},
        {"dims": ["20260702", "/tool/career-needs"], "metrics": ["3"]},
    ]
    result = build_days_by_tool(rows)
    assert len(result) == 2, "只取 /tool/ 開頭，/hub/ 要排除"
    assert all(r["path"].startswith("/tool/") for r in result)


def test_build_days_by_device():
    rows = [
        {"dims": ["20260701", "desktop"], "metrics": ["10"]},
        {"dims": ["20260701", "mobile"], "metrics": ["5"]},
        {"dims": ["20260702", "desktop"], "metrics": ["8"]},
    ]
    result = build_days_by_device(rows)
    assert len(result) == 3
    d1 = next(r for r in result if r["date"] == "2026-07-01" and r["category"] == "desktop")
    assert d1["sessions"] == 10


def test_build_days_fills_gaps_for_dates_ga4_omits_as_zero_activity():
    """GA4 對零活動的日期不會回傳任何列（不是回傳全 0 的列，是完全不出現）。
    totals_rows 只有 7/1、7/3（7/2 零活動，GA4 沒回傳），但範圍是 7/1~7/3，
    build_days 仍要讓 7/2 以零值出現，不能讓那天在 days[] 裡憑空消失。"""
    totals_rows = [
        {"dims": ["20260701"], "metrics": ["10", "8"]},
        {"dims": ["20260703"], "metrics": ["5", "4"]},
    ]
    days = build_days(totals_rows, [], [], "2026-07-01", "2026-07-03")
    assert [d["date"] for d in days] == ["2026-07-01", "2026-07-02", "2026-07-03"]
    d2 = days[1]
    assert d2["sessions"] == 0
    assert d2["active_users"] == 0
    assert d2["tool_open"] == 0


def test_build_days_ignores_event_and_page_rows_outside_the_requested_range():
    """event_rows／page_rows 若出現 start~end 範圍以外的日期（理論上不該發生，
    但作為邊界防呆），不能讓 days[] 意外多出範圍外的一天。"""
    totals_rows = [{"dims": ["20260701"], "metrics": ["1", "1"]}]
    event_rows = [{"dims": ["20260810", "tool_open"], "metrics": ["99"]}]
    days = build_days(totals_rows, event_rows, [], "2026-07-01", "2026-07-01")
    assert len(days) == 1
    assert days[0]["tool_open"] == 0
