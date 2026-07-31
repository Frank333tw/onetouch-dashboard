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
from config import CACHE_PATH, ROLLOUT_START
from ga_client import GAClient


def yesterday() -> str:
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


def collect(client: GAClient, start: str, end: str) -> dict:
    totals = client.run(["date"], ["sessions", "activeUsers"], start, end)
    events = client.run(["date", "eventName"], ["eventCount"], start, end)
    pages = client.run(["date", "pagePath"], ["screenPageViews"], start, end)
    units = client.run(["date", "sessionSource", "eventName"], ["eventCount"], start, end)
    devices = client.run(["date", "deviceCategory"], ["sessions"], start, end)

    return {
        "days": td.build_days(totals, events, pages, start, end),
        "days_by_unit": td.build_days_by_unit(units),
        "days_by_tool": td.build_days_by_tool(pages),
        "days_by_device": td.build_days_by_device(devices),
    }


def main():
    parser = argparse.ArgumentParser(description="抓取 OneTouch GA4 每日粒度資料")
    parser.add_argument("--end-date", default=None, help="結束日期 YYYY-MM-DD，預設為昨天")
    args = parser.parse_args()

    end = args.end_date or yesterday()
    client = GAClient()
    data = collect(client, ROLLOUT_START, end)
    data["meta"] = {
        "rollout_start": ROLLOUT_START,
        "last_day": end,
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }

    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 {CACHE_PATH}")
    print(f"  天數={len(data['days'])} 範圍={ROLLOUT_START}~{end}")


if __name__ == "__main__":
    main()
