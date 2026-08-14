"""CLI：從 Notion API 抓「測驗結果回饋表紀錄」資料庫，寫出未加密的中繼快取。

⚠️ 輸出檔在 scripts/.cache/，已在 .gitignore 排除，絕對不能手動移除該規則
或把這個檔案 commit 進去——這個 repo 是公開的，快取檔含未加密的受測者個資。

用法：
    NOTION_TOKEN=xxx NOTION_DATABASE_ID=xxx .venv/bin/python fetch_notion.py
"""

import json

from config import NOTION_CACHE_PATH
from notion_client import NotionClient
from transform_notion import build_feedback_records


def main():
    client = NotionClient()
    pages = client.query_database()
    data = {"feedback_records": build_feedback_records(pages)}

    NOTION_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    NOTION_CACHE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 {NOTION_CACHE_PATH}")
    print(f"  筆數={len(data['feedback_records'])}")


if __name__ == "__main__":
    main()
