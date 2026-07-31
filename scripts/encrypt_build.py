"""CLI：讀取未加密中繼快取，加密後寫成網站唯一的資料檔 site/data.enc.json。

用法（密碼從環境變數讀取，不接受命令列參數，避免密碼留在 shell history）：
    DASHBOARD_PASSWORD=xxx .venv/bin/python encrypt_build.py
"""

import json
import os
import sys

from config import CACHE_PATH, ENCRYPTED_DATA_PATH
from crypto_utils import encrypt_json


def main():
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        sys.exit("環境變數 DASHBOARD_PASSWORD 未設定，無法加密。")

    if not CACHE_PATH.exists():
        sys.exit(f"找不到 {CACHE_PATH}，請先執行 fetch_daily.py")

    data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    enc = encrypt_json(data, password)

    ENCRYPTED_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENCRYPTED_DATA_PATH.write_text(json.dumps(enc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 {ENCRYPTED_DATA_PATH}（{len(json.dumps(enc))} bytes）")


if __name__ == "__main__":
    main()
