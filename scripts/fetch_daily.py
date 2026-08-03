"""CLI：從 GA4 抓取每日粒度資料，寫出未加密的中繼快取。

⚠️ 輸出檔在 scripts/.cache/，已在 .gitignore 排除，絕對不能手動移除該規則
或把這個檔案 commit 進去——這個 repo 是公開的，快取檔是未加密的原始數字。

用法：
    .venv/bin/python fetch_daily.py
    .venv/bin/python fetch_daily.py --end-date 2026-07-10   # 測試用，縮小範圍
"""

import argparse
import datetime as dt
import json

import transform_daily as td
from config import CACHE_PATH, REPORT_NOTES, ROLLOUT_START, TRACKED_EVENTS, UNIT_TRACKED_EVENTS
from ga_client import GAClient


def yesterday() -> str:
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


def collect(client: GAClient, start: str, end: str) -> dict:
    totals = client.run(["date"], ["sessions", "activeUsers"], start, end)
    events = client.run(
        ["date", "eventName"], ["eventCount"], start, end, event_names=TRACKED_EVENTS
    )
    pages = client.run(["date", "pagePath"], ["screenPageViews"], start, end)
    units = client.run(
        ["date", "sessionSource", "eventName"], ["eventCount"], start, end,
        event_names=UNIT_TRACKED_EVENTS,
    )
    devices = client.run(["date", "deviceCategory"], ["sessions"], start, end)

    return {
        "days": td.build_days(totals, events, pages, start, end),
        "days_by_unit": td.build_days_by_unit(units),
        "days_by_tool": td.build_days_by_tool(pages),
        "days_by_device": td.build_days_by_device(devices),
    }


def assert_not_suspiciously_empty(data: dict, start: str, end: str) -> None:
    """GA4 認證成功但回傳零筆資料，跟「這段期間真的沒人用」在管線裡看起來
    一模一樣——但前者是 property 權限被收回、資料串流被刪、篩選條件設錯
    之類的管線本身出問題，不該被當成正常資料寫入快取。這裡對「已經上線
    超過一週、期間內卻整段 sessions 掛零」做一個簡單但有效的防呆：真的
    是管線問題時，這個條件幾乎必然成立；真的是業務上暫緩推廣時，不會
    連 sessions（不需要任何 UTM 或事件就會計入）都是零。
    """
    total_sessions = sum(d["sessions"] for d in data["days"])
    days_in_range = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
    if total_sessions == 0 and days_in_range >= 7:
        raise SystemExit(
            f"抓到的資料整段（{start}~{end}，共 {days_in_range} 天）sessions 全部是 0，"
            "懷疑是 GA4 那端出問題（property 存取權限被收回、資料串流被刪、"
            "篩選條件設錯等），不是真的沒人使用——已中止，不寫入快取。\n"
            "若這段期間真的預期沒有任何流量，请手動確認後再處理。"
        )


def main():
    parser = argparse.ArgumentParser(description="抓取 OneTouch GA4 每日粒度資料")
    parser.add_argument("--end-date", default=None, help="結束日期 YYYY-MM-DD，預設為昨天")
    args = parser.parse_args()

    end = args.end_date or yesterday()
    client = GAClient()
    data = collect(client, ROLLOUT_START, end)
    assert_not_suspiciously_empty(data, ROLLOUT_START, end)
    data["meta"] = {
        "rollout_start": ROLLOUT_START,
        "last_day": end,
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    # 單一資料來源：這份文字隨推廣進度會變動（例如哪個單位暫緩），
    # 只在 config.py 定義一次，經由資料管線帶到前端渲染，
    # 不要在 dashboard.js 另外寫死一份重複的文字。
    data["notes"] = REPORT_NOTES

    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 {CACHE_PATH}")
    print(f"  天數={len(data['days'])} 範圍={ROLLOUT_START}~{end}")


if __name__ == "__main__":
    main()
