"""產生 site/tests/fixtures/sample.enc.json——供前端 decrypt.js 的測試讀取，
驗證 Python 加密的密文真的能被瀏覽器的 Web Crypto API 解開。

這個 fixture 用假資料、假密碼，可以安全 commit 進公開 repo。
執行一次即可，之後除非改動 crypto_utils 的加密參數，不需要重新產生。
"""

import json
from pathlib import Path

from crypto_utils import encrypt_json

FIXTURE_PASSWORD = "test-password-123"
FIXTURE_PAYLOAD = {"hello": "world", "days": [{"date": "2026-07-01", "sessions": 5}]}

if __name__ == "__main__":
    out_path = Path(__file__).resolve().parent.parent.parent / "site" / "tests" / "fixtures" / "sample.enc.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    enc = encrypt_json(FIXTURE_PAYLOAD, FIXTURE_PASSWORD)
    out_path.write_text(json.dumps(enc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 {out_path}")
    print(f"測試密碼：{FIXTURE_PASSWORD}")
    print(f"預期解密結果：{FIXTURE_PAYLOAD}")
