"""GA4 原始 rows → 每日粒度中繼結構。純函式，無網路、無檔案 IO。"""


def format_date(yyyymmdd: str) -> str:
    """GA4 的 date 維度回傳 '20260701' 這種無分隔格式，轉成 '2026-07-01'。"""
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


# 事件名稱 → days[] 裡的欄位名稱
_EVENT_FIELD_MAP = {
    "tool_open": "tool_open",
    "result_view": "result_view",
    "result_generate_image": "result_generate_image",
    "result_download": "result_download",
    "result_share": "result_share",
    "result_feedback_opened": "feedback_opened",
    "result_feedback_page2_view": "feedback_page2",
    "result_feedback_submitted": "feedback_submitted",
    "result_feedback_pdf_download": "feedback_pdf",
}

_DAY_FIELD_DEFAULTS = {
    "tool_open": 0, "result_view": 0, "result_generate_image": 0,
    "result_download": 0, "result_share": 0,
    "feedback_opened": 0, "feedback_page2": 0, "feedback_submitted": 0, "feedback_pdf": 0,
    "hub_view": 0,
}


def build_days(totals_rows, event_rows, page_rows):
    """合併三種查詢結果成「每天一筆」的紀錄。

    totals_rows: [{dims:[date], metrics:[sessions, activeUsers]}]
    event_rows:  [{dims:[date, eventName], metrics:[count]}]
    page_rows:   [{dims:[date, pagePath], metrics:[views]}]
    """
    days = {}
    for r in totals_rows:
        date = format_date(r["dims"][0])
        days[date] = {
            "date": date,
            "sessions": int(r["metrics"][0]),
            "active_users": int(r["metrics"][1]),
            **_DAY_FIELD_DEFAULTS,
        }

    for r in event_rows:
        date = format_date(r["dims"][0])
        event_name = r["dims"][1]
        field = _EVENT_FIELD_MAP.get(event_name)
        if field is None or date not in days:
            continue
        days[date][field] += int(r["metrics"][0])

    for r in page_rows:
        date = format_date(r["dims"][0])
        path = r["dims"][1]
        if date in days and path.startswith("/hub/"):
            days[date]["hub_view"] += int(r["metrics"][0])

    return sorted(days.values(), key=lambda d: d["date"])


def build_days_by_unit(rows):
    """[{dims:[date, sessionSource, eventName], metrics:[count]}] → 每日每單位紀錄。"""
    acc = {}
    for r in rows:
        date, source, event = format_date(r["dims"][0]), r["dims"][1], r["dims"][2]
        key = (date, source)
        entry = acc.setdefault(key, {"date": date, "source": source, "tool_open": 0, "result_view": 0})
        if event in ("tool_open", "result_view"):
            entry[event] += int(r["metrics"][0])
    return sorted(acc.values(), key=lambda d: (d["date"], d["source"]))


def build_days_by_tool(rows):
    """[{dims:[date, pagePath], metrics:[views]}] → 只保留 /tool/ 路徑。"""
    result = [
        {"date": format_date(r["dims"][0]), "path": r["dims"][1], "views": int(r["metrics"][0])}
        for r in rows
        if r["dims"][1].startswith("/tool/")
    ]
    return sorted(result, key=lambda d: (d["date"], d["path"]))


def build_days_by_device(rows):
    """[{dims:[date, deviceCategory], metrics:[sessions]}] → 每日每裝置紀錄。"""
    result = [
        {"date": format_date(r["dims"][0]), "category": r["dims"][1], "sessions": int(r["metrics"][0])}
        for r in rows
    ]
    return sorted(result, key=lambda d: (d["date"], d["category"]))
