"""CLI：讀取未加密中繼快取，加密後寫成網站唯一的資料檔 site/data.enc.json。

用法（密碼從環境變數讀取，不接受命令列參數，避免密碼留在 shell history）：
    DASHBOARD_PASSWORD=xxx .venv/bin/python encrypt_build.py
"""

import json
import os
import sys
import tempfile

from config import CACHE_PATH, ENCRYPTED_DATA_PATH, NOTION_CACHE_PATH
from crypto_utils import encrypt_json


def main():
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        sys.exit("環境變數 DASHBOARD_PASSWORD 未設定，無法加密。")

    if not CACHE_PATH.exists():
        sys.exit(f"找不到 {CACHE_PATH}，請先執行 fetch_daily.py")
    if not NOTION_CACHE_PATH.exists():
        sys.exit(f"找不到 {NOTION_CACHE_PATH}，請先執行 fetch_notion.py")

    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        sys.exit(f"找不到有效的快取資料，{CACHE_PATH} 內容無法解析為 JSON")

    try:
        notion_data = json.loads(NOTION_CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        sys.exit(f"找不到有效的快取資料，{NOTION_CACHE_PATH} 內容無法解析為 JSON")

    data["feedback_records"] = notion_data["feedback_records"]

    enc = encrypt_json(data, password)
    content = json.dumps(enc, ensure_ascii=False, indent=2)

    # 原子寫入：先寫暫存檔再 rename，避免 CI 排程執行中途被中斷時
    # 留下損毀的檔案——這是公開 repo 裡唯一會被 commit 的資料檔。
    ENCRYPTED_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=ENCRYPTED_DATA_PATH.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, ENCRYPTED_DATA_PATH)
    except BaseException:
        os.unlink(tmp_path)
        raise

    print(f"已寫入 {ENCRYPTED_DATA_PATH}（{len(content)} bytes）")


if __name__ == "__main__":
    main()
