"""Notion API 的認證與查詢封裝。回傳原始 page 物件陣列，不做任何轉換。"""

import os

import requests

NOTION_VERSION = "2022-06-28"


class NotionClient:
    def __init__(self):
        self._token = os.environ.get("NOTION_TOKEN")
        self._database_id = os.environ.get("NOTION_DATABASE_ID")
        if not self._token:
            raise SystemExit("環境變數 NOTION_TOKEN 未設定，無法查詢 Notion。")
        if not self._database_id:
            raise SystemExit("環境變數 NOTION_DATABASE_ID 未設定，無法查詢 Notion。")

    def query_database(self):
        """回傳資料庫全部 page 物件。Notion API 單次查詢最多回傳 100 筆，
        用 has_more / next_cursor 分頁迴圈抓完全部。
        """
        pages = []
        cursor = None
        while True:
            body = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            response = requests.post(
                f"https://api.notion.com/v1/databases/{self._database_id}/query",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Notion-Version": NOTION_VERSION,
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            pages.extend(payload["results"])
            if not payload.get("has_more"):
                break
            cursor = payload.get("next_cursor")
        return pages
