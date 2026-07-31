# OneTouch GA 互動儀表板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個獨立的互動儀表板網站，每日自動從 GA4 抓取每日粒度資料、加密後部署到 GitHub Pages，使用者輸入密碼後可依自訂日期區間瀏覽五個主題頁籤的圖表化推廣成效數據。

**Architecture:** 後端（Python，GitHub Actions 執行）負責「抓取→整理成每日粒度→加密」三步驟，只產出一份加密檔 `site/data.enc.json`；前端（純 Vanilla JS，無 React、無建置工具）負責「解密→依使用者選的區間加總→用 Chart.js 畫圖」，兩端用同一套 PBKDF2+AES-GCM 參數溝通，一份跨語言測試 fixture 確保兩邊真的能互通解密。

**Tech Stack:** Python 3.12（uv 管理 venv）、`google-analytics-data`、`google-auth-oauthlib`、`cryptography`（AES-GCM）、pytest；前端 Chart.js 4.5.1（CDN + SRI）、Node.js 內建 `node:test`（測前端純函式，不需額外套件）；GitHub Actions＋GitHub Pages。

**前置狀態（2026-07-28 已完成，不需重做）：**
- Repo `onetouch-dashboard` 已 `git init`，分支 `main`，設計規格已 commit（`c125256`）
- GA4 property ID `538937948`，OAuth 憑證已存在於 `~/.config/onetouch-ga/`（`recruitment-web` 專案沿用同一組，不必重新走 Google Cloud 設定）
- `gh` CLI 已安裝（`~/.local/bin/gh`）且已登入 `Frank333tw` 帳號（`repo` scope）——可直接建 repo、設 Secrets、開 Pages
- Chart.js 4.5.1 CDN URL 與 SRI 雜湊已驗證：
  `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js`
  `sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ`

**設計規格：** `docs/superpowers/specs/2026-07-28-onetouch-dashboard-design.md`

**對規格的一處修正**：規格草圖把 `data.enc.json` 畫在 repo 根目錄，跟 `site/` 分開。實作時改成 `site/data.enc.json`——這樣 GitHub Pages 部署只需要上傳整個 `site/` 目錄，不需要額外一道「複製資料檔進部署目錄」的步驟。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `scripts/config.py` | property ID、單位/工具/裝置對照表、憑證路徑、`ROLLOUT_START` |
| `scripts/ga_client.py` | OAuth 憑證載入與更新、GA4 Data API 查詢封裝（回傳原始 rows，不做轉換） |
| `scripts/transform_daily.py` | 純函式：原始 rows → 每日粒度中繼結構。無網路、無檔案 IO |
| `scripts/crypto_utils.py` | 純函式：`encrypt_json`/`decrypt_json`（PBKDF2+AES-GCM），前後端共用的加密參數定義於此 |
| `scripts/fetch_daily.py` | CLI：呼叫 client → transform，寫出**未加密**的中繼快取（gitignored，不進 repo） |
| `scripts/encrypt_build.py` | CLI：讀中繼快取，呼叫 `crypto_utils.encrypt_json`，寫出 `site/data.enc.json` |
| `site/index.html` | 密碼閘門 + 五頁籤外殼（靜態，只在改版時手動修改，排程不會動它） |
| `site/style.css` | navy/gold/cream 視覺（沿用 `recruitment-web` 設計語言） |
| `site/decrypt.js` | 純函式（async）：`decryptData(encBlob, password)` → 解密後的 JSON，瀏覽器 Web Crypto API |
| `site/aggregate.js` | 純函式：每日粒度陣列 + 日期區間 → 六區塊需要的彙總資料 |
| `site/dashboard.js` | 串接層：密碼輸入→呼叫 decrypt→呼叫 aggregate→Chart.js 畫圖→頁籤切換→日期篩選器事件 |
| `site/tests/fixtures/sample.enc.json` | 跨語言加密測試 fixture（假資料、假密碼，Python 產生、JS 測試讀取） |
| `.github/workflows/build-deploy.yml` | 排程（每日 UTC 00:00）＋手動觸發，執行抓取→加密→commit→部署 |

分層理由：`transform_daily.py` 與 `aggregate.js` 都是純函式、無外部依賴，各自可以完整單元測試；`ga_client.py`（網路）與 `decrypt.js`（瀏覽器 API）則用真實執行/真實 fixture 驗證，不寫 mock。

---

## Task 1: Python 專案骨架與 config

**Files:**
- Create: `scripts/config.py`
- Create: `scripts/tests/__init__.py`
- Create: `scripts/tests/test_config.py`
- Create: `scripts/pytest.ini`
- Create/Modify: `.gitignore`

- [ ] **Step 1: 建立 venv 並安裝套件**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p scripts
cd scripts
uv venv --python 3.12
```

- [ ] **Step 2: 建立 `scripts/requirements.txt`（本機與 GitHub Actions 共用同一份清單，避免兩邊各寫一次）**

建立 `scripts/requirements.txt`：

```
google-analytics-data
google-auth-oauthlib
cryptography
pytest
```

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
uv pip install -r requirements.txt
```

- [ ] **Step 3: 補 `.gitignore`**

在 `/Users/frank/Desktop/claude code/onetouch-dashboard/.gitignore`（已有 `.superpowers/` 一行，在其後追加）：

```
.superpowers/

# Python
scripts/.venv/
scripts/__pycache__/
scripts/**/__pycache__/
scripts/.pytest_cache/
*.pyc

# 未加密的中繼快取，絕對不能進 repo（這個 repo 是公開的）
scripts/.cache/

# 本機測試用的假憑證（若有）
credentials.json
token.json
client_secret*.json
```

- [ ] **Step 4: 寫失敗的測試**

建立 `scripts/tests/test_config.py`：

```python
from config import (
    PROPERTY_ID, UNIT_LABELS, TOOL_LABELS, DEVICE_LABELS, ROLLOUT_START,
    unit_label, tool_label, device_label,
)


def test_property_id_is_numeric_string():
    assert PROPERTY_ID == "538937948"


def test_rollout_start():
    assert ROLLOUT_START == "2026-07-01"


def test_unit_label_maps_known_units():
    assert unit_label("taian") == "台安"
    assert unit_label("feiang") == "飛昂"
    assert unit_label("changqing") == "長青"
    assert unit_label("yisheng") == "益盛"


def test_unit_label_direct_traffic():
    assert unit_label("(direct)") == "直接進入／未帶追蹤連結"


def test_unit_label_passes_through_unknown():
    assert unit_label("m.facebook.com") == "m.facebook.com"


def test_tool_label_maps_paths():
    assert tool_label("/tool/behavior-disc") == "行為模式 DISC"
    assert tool_label("/tool/career-needs") == "收入需求試算"
    assert tool_label("/tool/career-motivation") == "動力分析"
    assert tool_label("/tool/work-satisfaction") == "工作滿意度"
    assert tool_label("/tool/career-placement") == "職業落點"


def test_tool_label_marks_retired_tool():
    assert tool_label("/tool/career-unlock") == "圓夢起點（已下架）"


def test_device_label_translates():
    assert device_label("desktop") == "桌機"
    assert device_label("mobile") == "手機"
    assert device_label("tablet") == "平板"
```

- [ ] **Step 5: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_config.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'config'`

- [ ] **Step 6: 寫 config.py**

建立 `scripts/config.py`：

```python
"""GA 儀表板後端設定與對照表。此檔不含任何機密，可進公開 repo。"""

import os
from pathlib import Path

# GA4 資源 ID（數值，非 measurement ID G-P3BYNW30P8），與 recruitment-web 同一個 property
PROPERTY_ID = "538937948"

# 憑證路徑：預設沿用 recruitment-web 已設定好的位置，可用環境變數覆寫（CI 用）
CRED_DIR = Path(os.environ.get("ONETOUCH_GA_CRED_DIR", Path.home() / ".config" / "onetouch-ga"))
CLIENT_SECRET_PATH = CRED_DIR / "client_secret.json"
TOKEN_PATH = CRED_DIR / "token.json"

SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

# 專案根目錄（本檔在 scripts/ 底下，根目錄是上一層）
BASE_DIR = Path(__file__).resolve().parent.parent

# 未加密中繼快取的存放位置（gitignored）
CACHE_DIR = BASE_DIR / "scripts" / ".cache"
CACHE_PATH = CACHE_DIR / "daily_raw.json"

# 加密後成品的存放位置（唯一會被 commit 的資料檔）
SITE_DIR = BASE_DIR / "site"
ENCRYPTED_DATA_PATH = SITE_DIR / "data.enc.json"

# 推廣起始日：抓取範圍從這天開始
ROLLOUT_START = "2026-07-01"

UNIT_LABELS = {
    "taian": "台安",
    "yisheng": "益盛",
    "changqing": "長青",
    "feiang": "飛昂",
    "(direct)": "直接進入／未帶追蹤連結",
    "(not set)": "來源未知",
}

TOOL_LABELS = {
    "/tool/behavior-disc": "行為模式 DISC",
    "/tool/career-needs": "收入需求試算",
    "/tool/career-motivation": "動力分析",
    "/tool/work-satisfaction": "工作滿意度",
    "/tool/career-placement": "職業落點",
    "/tool/career-unlock": "圓夢起點（已下架）",
}

DEVICE_LABELS = {
    "desktop": "桌機",
    "mobile": "手機",
    "tablet": "平板",
}

# 四個推廣單位固定出現在單位比較區塊，即使數字為零
TRACKED_UNITS = ["taian", "yisheng", "changqing", "feiang"]

REPORT_NOTES = [
    "單位比較會低估回訪使用量：GA4 於 session 開始時歸因來源，"
    "主管第一次用單位短網址進入會正確歸戶，之後直接開網址或從書籤進入的"
    "session 會歸到「直接進入」。因此各單位數字偏低、「直接進入」會隨推廣時間膨脹。",
    "長青、益盛自 2026-07-23 起推廣進度 pending、暫緩，"
    "兩單位數字偏低或為零是「尚未開始」，不代表工具或推廣效果不佳。",
]


def unit_label(source: str) -> str:
    return UNIT_LABELS.get(source, source)


def tool_label(path: str) -> str:
    return TOOL_LABELS.get(path, path)


def device_label(category: str) -> str:
    return DEVICE_LABELS.get(category, category)
```

- [ ] **Step 7: 建立 pytest.ini**

建立 `scripts/pytest.ini`：

```ini
[pytest]
pythonpath = .
testpaths = tests
```

建立空的 `scripts/tests/__init__.py`（完全空白）。

- [ ] **Step 8: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_config.py -v
```
Expected: PASS，8 passed

- [ ] **Step 9: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/config.py scripts/requirements.txt scripts/pytest.ini scripts/tests/ .gitignore
git commit -m "feat: Python 專案骨架、requirements.txt 與 config 對照表"
```

---

## Task 2: crypto_utils — 加密核心（前後端共用參數的權威定義）

**Files:**
- Create: `scripts/crypto_utils.py`
- Create: `scripts/tests/test_crypto_utils.py`

這個模組定義的參數（PBKDF2 迭代次數、salt/iv 長度）之後在 `site/decrypt.js` 裡必須逐字對應，否則跨語言解密會失敗。

- [ ] **Step 1: 寫失敗的測試**

建立 `scripts/tests/test_crypto_utils.py`：

```python
import json

from crypto_utils import encrypt_json, decrypt_json, PBKDF2_ITERATIONS


def test_round_trip_encrypt_decrypt():
    payload = {"hello": "world", "n": 42}
    enc = encrypt_json(payload, "correct-horse-battery-staple")
    result = decrypt_json(enc, "correct-horse-battery-staple")
    assert result == payload


def test_wrong_password_raises():
    enc = encrypt_json({"a": 1}, "right-password")
    try:
        decrypt_json(enc, "wrong-password")
        assert False, "應該要拋出例外，不該解密成功"
    except Exception:
        pass


def test_encrypted_blob_has_expected_fields():
    enc = encrypt_json({"a": 1}, "pw")
    assert set(enc.keys()) == {"salt", "iv", "ciphertext", "iterations"}
    assert enc["iterations"] == PBKDF2_ITERATIONS


def test_encrypted_blob_never_contains_plaintext_field_names():
    """迴歸測試：確保密文欄位是 base64 字串，不是不小心把明文 dict 序列化進去。"""
    enc = encrypt_json({"secret_marker_xyz": 1}, "pw")
    assert "secret_marker_xyz" not in json.dumps(enc)


def test_different_calls_use_different_salt_and_iv():
    """每次加密都要用新的隨機 salt/iv，不能重複使用（重複使用 IV 是 AES-GCM 的已知安全漏洞）。"""
    enc1 = encrypt_json({"a": 1}, "pw")
    enc2 = encrypt_json({"a": 1}, "pw")
    assert enc1["salt"] != enc2["salt"]
    assert enc1["iv"] != enc2["iv"]
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_crypto_utils.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'crypto_utils'`

- [ ] **Step 3: 寫實作**

建立 `scripts/crypto_utils.py`：

```python
"""前後端共用的加密邏輯。PBKDF2 + AES-GCM。

⚠️ 這裡的參數（PBKDF2_ITERATIONS、SALT_BYTES、IV_BYTES、hash 演算法 SHA-256）
是跨語言的契約——site/decrypt.js 必須用完全相同的參數，否則兩邊導出的金鑰
不一致，解密會失敗。修改這裡的任何數值，務必同步修改 decrypt.js。
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 600_000  # OWASP 現行對 PBKDF2-HMAC-SHA256 的建議值（210_000 是給 SHA-512 的，用錯雜湊會讓拖慢暴力破解的效果打折）
SALT_BYTES = 16
IV_BYTES = 12
KEY_BYTES = 32  # AES-256


def _derive_key(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS, dklen=KEY_BYTES
    )


def encrypt_json(data: dict, password: str) -> dict:
    """加密一個可 JSON 序列化的 dict，回傳可直接寫成 JSON 檔的密文結構。"""
    salt = os.urandom(SALT_BYTES)
    iv = os.urandom(IV_BYTES)
    key = _derive_key(password, salt)
    plaintext = json.dumps(data, ensure_ascii=False).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)
    return {
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "iterations": PBKDF2_ITERATIONS,
    }


def decrypt_json(enc: dict, password: str) -> dict:
    """解密 encrypt_json() 產出的結構。僅供 Python 端測試用（正式使用端是瀏覽器）。"""
    salt = base64.b64decode(enc["salt"])
    iv = base64.b64decode(enc["iv"])
    ciphertext = base64.b64decode(enc["ciphertext"])
    key = _derive_key(password, salt)
    plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_crypto_utils.py -v
```
Expected: PASS，5 passed

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/crypto_utils.py scripts/tests/test_crypto_utils.py
git commit -m "feat: 加密核心 crypto_utils（PBKDF2+AES-GCM），前後端共用參數的權威定義"
```

---

## Task 3: transform_daily — 每日粒度資料整理（純函式）

**Files:**
- Create: `scripts/transform_daily.py`
- Create: `scripts/tests/test_transform_daily.py`

原始資料格式約定（跟 `recruitment-web` 月報腳本一致）：`ga_client` 的每個查詢回傳 `list[dict]`，每筆為 `{"dims": [str, ...], "metrics": [str, ...]}`。GA4 的 `date` 維度回傳格式是 `YYYYMMDD`（無分隔線），需要轉成 `YYYY-MM-DD`。

- [ ] **Step 1: 寫失敗的測試**

建立 `scripts/tests/test_transform_daily.py`：

```python
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

    days = build_days(totals_rows, event_rows, page_rows)

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
    days = build_days(totals_rows, [], [])
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
    days = build_days(totals_rows, event_rows, [])
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_transform_daily.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'transform_daily'`

- [ ] **Step 3: 寫實作**

建立 `scripts/transform_daily.py`：

```python
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
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -m pytest tests/test_transform_daily.py -v
```
Expected: PASS，7 passed

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/transform_daily.py scripts/tests/test_transform_daily.py
git commit -m "feat: transform_daily 每日粒度資料整理（純函式）"
```

---

## Task 4: ga_client — GA4 Data API 每日粒度查詢

**Files:**
- Create: `scripts/ga_client.py`

此層有網路依賴，不寫單元測試；用真實 API 執行驗證（本機已有 `~/.config/onetouch-ga/` 憑證可直接用）。

- [ ] **Step 1: 寫 ga_client.py**

建立 `scripts/ga_client.py`：

```python
"""GA4 Data API 的認證與查詢封裝。回傳原始 rows，不做任何轉換。"""

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, Metric, RunReportRequest,
)
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from config import PROPERTY_ID, SCOPES, TOKEN_PATH


class GAClient:
    def __init__(self):
        if not TOKEN_PATH.exists():
            raise SystemExit(
                f"找不到憑證 {TOKEN_PATH}。\n"
                "本專案沿用 recruitment-web 已設定好的 OAuth 憑證，"
                "若本機不存在，先參考該專案 SPEC/analytics/04_ 的認證章節。"
            )
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
        if not creds.valid:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json())
        self._client = BetaAnalyticsDataClient(credentials=creds)

    def run(self, dimensions, metrics, start_date, end_date, limit=10000):
        request = RunReportRequest(
            property=f"properties/{PROPERTY_ID}",
            date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
            dimensions=[Dimension(name=d) for d in dimensions],
            metrics=[Metric(name=m) for m in metrics],
            limit=limit,
        )
        response = self._client.run_report(request)
        return [
            {
                "dims": [v.value for v in row.dimension_values],
                "metrics": [v.value for v in row.metric_values],
            }
            for row in response.rows
        ]
```

- [ ] **Step 2: 手動驗證憑證可用、確認 date 維度格式**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python -c "
from ga_client import GAClient
c = GAClient()
rows = c.run(['date'], ['sessions', 'activeUsers'], '2026-07-01', '2026-07-05')
for r in rows: print(r)
"
```
Expected: 印出 5 筆（7/1～7/5），`dims[0]` 是 `20260701` 這種 8 位數字格式（確認跟 `transform_daily.format_date` 的假設一致）

- [ ] **Step 3: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/ga_client.py
git commit -m "feat: GA4 Data API 每日粒度查詢封裝"
```

---

## Task 5: fetch_daily — 抓取 CLI（產出未加密中繼快取）

**Files:**
- Create: `scripts/fetch_daily.py`

- [ ] **Step 1: 寫 fetch_daily.py**

建立 `scripts/fetch_daily.py`：

```python
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
from pathlib import Path

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
        "days": td.build_days(totals, events, pages),
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
```

- [ ] **Step 2: 本機執行，驗證資料量合理**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python fetch_daily.py
.venv/bin/python -c "
import json
d = json.load(open('.cache/daily_raw.json'))
print('days 筆數:', len(d['days']))
print('第一天:', d['days'][0])
print('最後一天:', d['days'][-1])
print('單位紀錄數:', len(d['days_by_unit']))
print('工具紀錄數:', len(d['days_by_tool']))
"
```
Expected: `days` 筆數約等於「今天日期 - 7/1」的天數（每天都有紀錄，即使當天 sessions 是 0）；`最後一天` 的 `date` 是昨天

- [ ] **Step 3: 確認快取檔案沒有被 git 追蹤**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git status --short scripts/.cache/
```
Expected: 沒有任何輸出（`.gitignore` 生效，git 完全不追蹤這個目錄）

- [ ] **Step 4: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/fetch_daily.py
git commit -m "feat: fetch_daily CLI，抓取每日粒度資料到未加密中繼快取"
```

---

## Task 6: encrypt_build — 加密 CLI（產出網站唯一的資料檔）

**Files:**
- Create: `scripts/encrypt_build.py`
- Create: `scripts/tests/generate_test_fixture.py`
- Create（由 Step 3 產生）: `site/tests/fixtures/sample.enc.json`

- [ ] **Step 1: 寫 encrypt_build.py**

建立 `scripts/encrypt_build.py`：

```python
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
```

- [ ] **Step 2: 本機執行，用測試密碼加密剛剛抓到的真實資料**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
DASHBOARD_PASSWORD=temp-local-test-only .venv/bin/python encrypt_build.py
cat ../site/data.enc.json | head -c 300
echo
echo "確認 ciphertext 是看不懂的 base64，沒有任何明文數字或欄位名稱"
```
Expected: 印出 `{"salt": "...", "iv": "...", "ciphertext": "...", "iterations": 600000}`，`ciphertext` 是一長串 base64、看不出任何原始數字

- [ ] **Step 3: 產生跨語言測試 fixture（給 Task 7 的 JS 測試用）**

建立 `scripts/tests/generate_test_fixture.py`：

```python
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
```

- [ ] **Step 4: 執行產生 fixture**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python tests/generate_test_fixture.py
cat ../site/tests/fixtures/sample.enc.json
```
Expected: 印出加密後的 JSON 結構，且終端機印出測試密碼與預期解密結果（Task 7 會用到這兩個值）

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add scripts/encrypt_build.py scripts/tests/generate_test_fixture.py site/tests/fixtures/sample.enc.json
git commit -m "feat: encrypt_build CLI，加密輸出＋跨語言測試 fixture"
```

---

## Task 7: site/decrypt.js — 瀏覽器端解密（純函式，跨語言驗證）

**Files:**
- Create: `site/decrypt.js`
- Create: `site/tests/decrypt.test.js`

Node.js（v18+）內建 `crypto.subtle`，跟瀏覽器的 Web Crypto API 是同一套規格，可以直接用 `node --test` 驗證，不需要真的開瀏覽器。

- [ ] **Step 1: 寫失敗的測試**

建立 `site/tests/decrypt.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptData } from '../decrypt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'sample.enc.json'), 'utf-8')
);

test('用正確密碼解密 Python 產生的密文，結果要跟 Python 端一致', async () => {
  const result = await decryptData(fixture, 'test-password-123');
  assert.deepEqual(result, {
    hello: 'world',
    days: [{ date: '2026-07-01', sessions: 5 }],
  });
});

test('密碼錯誤時要 reject，不能回傳亂碼或部分結果', async () => {
  await assert.rejects(() => decryptData(fixture, 'wrong-password'));
});

test('迭代次數沿用密文裡記錄的值，不寫死', async () => {
  assert.equal(fixture.iterations, 600000);
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
node --test tests/decrypt.test.js
```
Expected: FAIL — 找不到 `../decrypt.js`（模組不存在）

- [ ] **Step 3: 寫實作**

建立 `site/decrypt.js`：

```js
// 瀏覽器端解密。參數必須跟 scripts/crypto_utils.py 逐字對應：
// PBKDF2-HMAC-SHA256、salt/iv 皆為 base64、AES-GCM 256-bit 金鑰。

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param {{salt: string, iv: string, ciphertext: string, iterations: number}} encBlob
 * @param {string} password
 * @returns {Promise<any>} 解密後 parse 好的 JSON；密碼錯誤時 reject
 */
export async function decryptData(encBlob, password) {
  const salt = base64ToBytes(encBlob.salt);
  const iv = base64ToBytes(encBlob.iv);
  const ciphertext = base64ToBytes(encBlob.ciphertext);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: encBlob.iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 密碼錯誤時，AES-GCM 的驗證標籤（authentication tag）比對會失敗，
  // crypto.subtle.decrypt 直接 reject——不會回傳看起來正常但其實是亂碼的結果。
  const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const plaintextStr = new TextDecoder().decode(plaintextBuf);
  return JSON.parse(plaintextStr);
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
node --test tests/decrypt.test.js
```
Expected: PASS，3 passed — **這一步是整個專案最關鍵的驗證點**：證明 Python 加密的東西，瀏覽器（或這裡的 Node，同一套 Web Crypto API）真的解得開，不是理論上兩邊參數對得上而已

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add site/decrypt.js site/tests/decrypt.test.js
git commit -m "feat: 瀏覽器端解密 decrypt.js，跨語言測試證實與 Python 加密互通"
```

---

## Task 8: site/aggregate.js — 日期區間加總（純函式）

**Files:**
- Create: `site/aggregate.js`
- Create: `site/tests/aggregate.test.js`

沿用 `recruitment-web` 月報腳本 `transform.py` 已驗證過的計算原則：完成率無分母時回 `null`（不是 0）、四單位掛零仍列出、`feedback_submitted` 不可與站務意見信箱事件混用（這裡在 `transform_daily.py` 階段就已經分開成 `feedback_submitted` 欄位，不會混淆）。

- [ ] **Step 1: 寫失敗的測試**

建立 `site/tests/aggregate.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
} from '../aggregate.js';

const DAYS = [
  { date: '2026-07-01', sessions: 10, active_users: 8, tool_open: 5, result_view: 2,
    result_generate_image: 2, result_download: 1, result_share: 0, hub_view: 8,
    feedback_opened: 3, feedback_page2: 1, feedback_submitted: 1, feedback_pdf: 0 },
  { date: '2026-07-02', sessions: 6, active_users: 5, tool_open: 3, result_view: 1,
    result_generate_image: 1, result_download: 0, result_share: 1, hub_view: 4,
    feedback_opened: 1, feedback_page2: 0, feedback_submitted: 0, feedback_pdf: 0 },
];

test('filterRange 依日期字串範圍篩選（含頭尾）', () => {
  const result = filterRange(DAYS, '2026-07-01', '2026-07-01');
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-01');
});

test('buildKpi 加總區間內所有天數', () => {
  const kpi = buildKpi(DAYS);
  assert.equal(kpi.sessions, 16);
  assert.equal(kpi.tool_open, 8);
  assert.equal(kpi.result_view, 3);
  assert.equal(kpi.completion_rate, 3 / 8);
  assert.equal(kpi.feedback_submitted, 1);
});

test('buildKpi 完成率無分母時回 null，不是 0', () => {
  const kpi = buildKpi([]);
  assert.equal(kpi.tool_open, 0);
  assert.equal(kpi.completion_rate, null);
});

test('buildUnits 四單位掛零仍列出', () => {
  const unitDays = [
    { date: '2026-07-01', source: 'feiang', tool_open: 5, result_view: 2 },
  ];
  const units = buildUnits(unitDays);
  const sources = units.map((u) => u.source);
  assert.ok(['taian', 'yisheng', 'changqing', 'feiang'].every((s) => sources.includes(s)));
  const changqing = units.find((u) => u.source === 'changqing');
  assert.equal(changqing.tool_open, 0);
  assert.equal(changqing.completion_rate, null);
});

test('buildUnits 依 tool_open 由高到低排序', () => {
  const unitDays = [
    { date: '2026-07-01', source: 'taian', tool_open: 2, result_view: 1 },
    { date: '2026-07-01', source: 'feiang', tool_open: 9, result_view: 3 },
  ];
  const units = buildUnits(unitDays);
  assert.equal(units[0].source, 'feiang');
});

test('buildTools 加總每日工具瀏覽數並排序', () => {
  const toolDays = [
    { date: '2026-07-01', path: '/tool/behavior-disc', views: 5 },
    { date: '2026-07-02', path: '/tool/behavior-disc', views: 3 },
    { date: '2026-07-01', path: '/tool/career-needs', views: 1 },
  ];
  const tools = buildTools(toolDays);
  assert.equal(tools[0].path, '/tool/behavior-disc');
  assert.equal(tools[0].views, 8);
  assert.equal(tools[0].label, '行為模式 DISC');
});

test('buildFunnel 五階段含產生結果圖', () => {
  const funnel = buildFunnel(DAYS);
  assert.deepEqual(
    funnel.map((s) => s.stage),
    ['hub_view', 'tool_open', 'result_view', 'result_image', 'result_action']
  );
  assert.equal(funnel[0].count, 12);
  assert.equal(funnel[3].count, 3, '產生結果圖 2+1');
  assert.equal(funnel[4].count, 2, '下載 1+0 加分享 0+1');
});

test('buildFeedbackFunnel 四階段', () => {
  const funnel = buildFeedbackFunnel(DAYS);
  assert.deepEqual(funnel.map((s) => s.count), [4, 1, 1, 0]);
});

test('buildDevices 計算佔比', () => {
  const deviceDays = [
    { date: '2026-07-01', category: 'desktop', sessions: 6 },
    { date: '2026-07-01', category: 'mobile', sessions: 4 },
  ];
  const devices = buildDevices(deviceDays);
  const desktop = devices.find((d) => d.category === 'desktop');
  assert.equal(desktop.sessions, 6);
  assert.equal(desktop.share, 0.6);
});

test('buildTrend 回傳每日序列供折線圖使用', () => {
  const trend = buildTrend(DAYS);
  assert.deepEqual(trend.map((t) => t.date), ['2026-07-01', '2026-07-02']);
  assert.deepEqual(trend.map((t) => t.sessions), [10, 6]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
node --test tests/aggregate.test.js
```
Expected: FAIL — 找不到 `../aggregate.js`

- [ ] **Step 3: 寫實作**

建立 `site/aggregate.js`：

```js
// 純函式：每日粒度陣列 + 日期區間 → 六區塊需要的彙總資料。無 DOM、無網路。

const UNIT_LABELS = {
  taian: '台安', yisheng: '益盛', changqing: '長青', feiang: '飛昂',
  '(direct)': '直接進入／未帶追蹤連結', '(not set)': '來源未知',
};

const TOOL_LABELS = {
  '/tool/behavior-disc': '行為模式 DISC',
  '/tool/career-needs': '收入需求試算',
  '/tool/career-motivation': '動力分析',
  '/tool/work-satisfaction': '工作滿意度',
  '/tool/career-placement': '職業落點',
  '/tool/career-unlock': '圓夢起點（已下架）',
};

const DEVICE_LABELS = { desktop: '桌機', mobile: '手機', tablet: '平板' };
const TRACKED_UNITS = ['taian', 'yisheng', 'changqing', 'feiang'];

export function filterRange(days, start, end) {
  return days.filter((d) => d.date >= start && d.date <= end);
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
}

export function buildKpi(days) {
  const toolOpen = sumField(days, 'tool_open');
  const resultView = sumField(days, 'result_view');
  return {
    sessions: sumField(days, 'sessions'),
    active_users: sumField(days, 'active_users'),
    tool_open: toolOpen,
    result_view: resultView,
    completion_rate: toolOpen ? resultView / toolOpen : null,
    feedback_submitted: sumField(days, 'feedback_submitted'),
  };
}

export function buildUnits(unitDays) {
  const acc = {};
  for (const r of unitDays) {
    const entry = acc[r.source] || { source: r.source, tool_open: 0, result_view: 0 };
    entry.tool_open += r.tool_open || 0;
    entry.result_view += r.result_view || 0;
    acc[r.source] = entry;
  }
  for (const source of TRACKED_UNITS) {
    if (!acc[source]) acc[source] = { source, tool_open: 0, result_view: 0 };
  }
  const units = Object.values(acc).map((u) => ({
    ...u,
    label: UNIT_LABELS[u.source] || u.source,
    completion_rate: u.tool_open ? u.result_view / u.tool_open : null,
  }));
  units.sort((a, b) => b.tool_open - a.tool_open);
  return units;
}

export function buildTools(toolDays) {
  const acc = {};
  for (const r of toolDays) {
    acc[r.path] = (acc[r.path] || 0) + r.views;
  }
  const tools = Object.entries(acc).map(([path, views]) => ({
    path, views, label: TOOL_LABELS[path] || path,
  }));
  tools.sort((a, b) => b.views - a.views);
  return tools;
}

function withRetention(stages) {
  return stages.map((stage, i) => {
    if (i === 0) return { ...stage, retention_from_prev: null };
    const prev = stages[i - 1].count;
    return { ...stage, retention_from_prev: prev ? stage.count / prev : null };
  });
}

export function buildFunnel(days) {
  const stages = [
    { stage: 'hub_view', label: '進入工具清單', count: sumField(days, 'hub_view') },
    { stage: 'tool_open', label: '開啟工具', count: sumField(days, 'tool_open') },
    { stage: 'result_view', label: '看到測驗結果', count: sumField(days, 'result_view') },
    { stage: 'result_image', label: '產生結果圖', count: sumField(days, 'result_generate_image') },
    {
      stage: 'result_action', label: '下載或分享結果',
      count: sumField(days, 'result_download') + sumField(days, 'result_share'),
    },
  ];
  return withRetention(stages);
}

export function buildFeedbackFunnel(days) {
  const stages = [
    { stage: 'feedback_opened', label: '打開回饋問卷', count: sumField(days, 'feedback_opened') },
    { stage: 'feedback_page2', label: '進入第二頁', count: sumField(days, 'feedback_page2') },
    { stage: 'feedback_submitted', label: '送出問卷', count: sumField(days, 'feedback_submitted') },
    { stage: 'feedback_pdf', label: '下載 PDF', count: sumField(days, 'feedback_pdf') },
  ];
  return withRetention(stages);
}

export function buildDevices(deviceDays) {
  const acc = {};
  for (const r of deviceDays) {
    acc[r.category] = (acc[r.category] || 0) + r.sessions;
  }
  const total = Object.values(acc).reduce((a, b) => a + b, 0);
  const devices = Object.entries(acc).map(([category, sessions]) => ({
    category, sessions, label: DEVICE_LABELS[category] || category,
    share: total ? sessions / total : null,
  }));
  devices.sort((a, b) => b.sessions - a.sessions);
  return devices;
}

export function buildTrend(days) {
  return days.map((d) => ({ date: d.date, sessions: d.sessions }));
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
node --test tests/aggregate.test.js
```
Expected: PASS，10 passed

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add site/aggregate.js site/tests/aggregate.test.js
git commit -m "feat: aggregate.js 日期區間加總（純函式），沿用月報腳本既有計算原則"
```

---

## Task 9: site/index.html + style.css — 密碼閘門與五頁籤外殼

**Files:**
- Create: `site/index.html`
- Create: `site/style.css`

- [ ] **Step 1: 寫 style.css**

建立 `site/style.css`：

```css
:root{--navy:#0F2545;--navy-soft:#1E3A6B;--gold:#C8973A;--cream:#F4EFE4;
--paper:#FAF7EF;--line:#D9CFBA;--muted:#6B7280}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--navy);
font-family:"Noto Sans TC","Helvetica Neue",Arial,sans-serif;line-height:1.7}

/* 密碼閘門 */
#gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
background:var(--cream);z-index:100}
#gate.hidden{display:none}
.gate-box{background:var(--paper);border:1px solid var(--line);border-radius:12px;
padding:40px;max-width:360px;width:90%;text-align:center}
.gate-box h1{font-size:20px;margin:0 0 20px}
.gate-box input{width:100%;padding:12px;font-size:16px;border:1px solid var(--line);
border-radius:8px;margin-bottom:12px;text-align:center;letter-spacing:2px}
.gate-box button{width:100%;padding:12px;font-size:15px;font-weight:600;color:#fff;
background:var(--navy);border:none;border-radius:8px;cursor:pointer}
.gate-box button:hover{background:var(--navy-soft)}
.gate-error{color:#C0392B;font-size:13px;margin-top:10px;min-height:18px}

/* 主畫面 */
#app{display:none;max-width:1000px;margin:0 auto;padding:32px 24px 80px}
#app.visible{display:block}
header{border-bottom:3px solid var(--navy);padding-bottom:16px;margin-bottom:24px;
display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
h1{font-size:26px;margin:0}
.sub{color:var(--muted);font-size:13px}

/* 日期區間篩選器 */
.date-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.date-filter button{padding:8px 14px;font-size:13px;border:1px solid var(--line);
background:var(--paper);border-radius:20px;cursor:pointer}
.date-filter button.active{background:var(--navy);color:#fff;border-color:var(--navy)}
.date-filter input[type=date]{padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px}

/* 頁籤 */
.tabs{display:flex;gap:2px;background:var(--navy);padding:6px 6px 0;border-radius:8px 8px 0 0}
.tab{padding:10px 18px;font-size:14px;border-radius:6px 6px 0 0;color:#cbd5e1;
background:var(--navy-soft);cursor:pointer;border:none}
.tab.active{background:var(--cream);color:var(--navy);font-weight:600}
.tab-panel{display:none;background:var(--paper);border:1px solid var(--line);
border-top:none;border-radius:0 0 8px 8px;padding:24px}
.tab-panel.active{display:block}

/* 圖表區塊 */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px}
.kpi{background:var(--cream);border:1px solid var(--line);border-radius:10px;padding:16px}
.kpi .n{font-size:26px;font-weight:700;color:var(--navy-soft)}
.kpi .l{font-size:12px;color:var(--muted);margin-top:4px}
.chart-wrap{position:relative;height:320px;margin-bottom:16px}
.note-box{margin-top:20px;background:#FFF8E7;border:1px solid var(--gold);
border-radius:10px;padding:14px 18px;font-size:13px;color:#5A4A2A}
.note-box li{margin-bottom:6px}
</style>
```

- [ ] **Step 2: 寫 index.html**

建立 `site/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OneTouch 推廣成效儀表板</title>
<link rel="stylesheet" href="style.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
  integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"
  crossorigin="anonymous"></script>
</head>
<body>

<div id="gate">
  <div class="gate-box">
    <h1>OneTouch 推廣成效儀表板</h1>
    <input type="password" id="password-input" placeholder="請輸入密碼" autocomplete="off">
    <button id="unlock-btn">解鎖</button>
    <div class="gate-error" id="gate-error"></div>
  </div>
</div>

<div id="app">
  <header>
    <h1>OneTouch 推廣成效儀表板</h1>
    <div class="sub" id="data-range-sub"></div>
  </header>

  <div class="date-filter" id="date-filter">
    <button data-preset="week">本週</button>
    <button data-preset="month">本月</button>
    <button data-preset="quarter">近三個月</button>
    <button data-preset="all" class="active">累積至今</button>
    <input type="date" id="custom-start">
    <input type="date" id="custom-end">
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="overview">總覽</button>
    <button class="tab" data-tab="units">單位</button>
    <button class="tab" data-tab="funnel">轉換路徑</button>
    <button class="tab" data-tab="tools">工具</button>
    <button class="tab" data-tab="devices">裝置</button>
  </div>

  <div class="tab-panel active" id="panel-overview">
    <div class="kpis" id="kpi-cards"></div>
    <div class="chart-wrap"><canvas id="chart-trend"></canvas></div>
  </div>

  <div class="tab-panel" id="panel-units">
    <div class="chart-wrap"><canvas id="chart-units"></canvas></div>
    <div class="note-box"><ul id="unit-notes"></ul></div>
  </div>

  <div class="tab-panel" id="panel-funnel">
    <div class="chart-wrap"><canvas id="chart-funnel"></canvas></div>
    <div class="chart-wrap"><canvas id="chart-feedback-funnel"></canvas></div>
  </div>

  <div class="tab-panel" id="panel-tools">
    <div class="chart-wrap"><canvas id="chart-tools"></canvas></div>
  </div>

  <div class="tab-panel" id="panel-devices">
    <div class="chart-wrap"><canvas id="chart-devices"></canvas></div>
  </div>
</div>

<script type="module" src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 3: 本機檢查靜態檔案沒有明顯錯誤**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
python3 -c "
from html.parser import HTMLParser
HTMLParser().feed(open('index.html', encoding='utf-8').read())
print('HTML 可正常解析，無明顯標籤錯誤')
"
```
Expected: 印出「HTML 可正常解析，無明顯標籤錯誤」，無例外拋出

- [ ] **Step 4: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add site/index.html site/style.css
git commit -m "feat: 密碼閘門與五頁籤靜態外殼"
```

---

## Task 10: site/dashboard.js — 串接解密／加總／圖表／頁籤／日期篩選

**Files:**
- Create: `site/dashboard.js`

這個檔案是純串接邏輯（DOM 操作 + Chart.js 呼叫），不寫自動化測試——手動在瀏覽器驗證（Task 11）。所有它呼叫的計算邏輯都已經在 Task 7、8 測試過。

- [ ] **Step 1: 寫 dashboard.js**

建立 `site/dashboard.js`：

```js
import { decryptData } from './decrypt.js';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
} from './aggregate.js';

const NAVY = '#0F2545';
const NAVY_SOFT = '#1E3A6B';
const GOLD = '#C8973A';

let ALL_DATA = null; // { days, days_by_unit, days_by_tool, days_by_device, meta }
let charts = {};

async function loadEncryptedData() {
  const res = await fetch('data.enc.json');
  return res.json();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function presetRange(preset, rolloutStart) {
  const end = todayISO();
  switch (preset) {
    case 'week': return [daysAgoISO(7), end];
    case 'month': return [daysAgoISO(30), end];
    case 'quarter': return [daysAgoISO(90), end];
    case 'all':
    default: return [rolloutStart, end];
  }
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderKpis(kpi) {
  const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const cards = [
    [kpi.sessions, '總使用人次'],
    [kpi.tool_open, '開啟工具次數'],
    [kpi.result_view, '完成測驗數'],
    [pct(kpi.completion_rate), '完成率'],
    [kpi.feedback_submitted, '問卷回收數'],
  ];
  document.getElementById('kpi-cards').innerHTML = cards
    .map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');
}

function renderTrend(trend) {
  destroyChart('trend');
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: trend.map((t) => t.date),
      datasets: [{ label: '每日使用人次', data: trend.map((t) => t.sessions),
        borderColor: NAVY_SOFT, backgroundColor: 'rgba(30,58,107,0.1)', fill: true, tension: 0.2 }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function renderUnits(units) {
  destroyChart('units');
  charts.units = new Chart(document.getElementById('chart-units'), {
    type: 'bar',
    data: {
      labels: units.map((u) => u.label),
      datasets: [
        { label: '開啟工具', data: units.map((u) => u.tool_open), backgroundColor: NAVY_SOFT },
        { label: '看到結果', data: units.map((u) => u.result_view), backgroundColor: GOLD },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: {
        afterBody: (items) => {
          const u = units[items[0].dataIndex];
          const pct = u.completion_rate === null ? '—' : `${(u.completion_rate * 100).toFixed(1)}%`;
          return `完成率：${pct}`;
        },
      } } },
    },
  });
  const notes = [
    '單位比較會低估回訪使用量：GA4 於 session 開始時歸因來源，主管第一次用單位短網址進入會正確歸戶，之後直接開網址或從書籤進入的 session 會歸到「直接進入」。',
    '長青、益盛自 2026-07-23 起推廣進度 pending、暫緩，兩單位數字偏低或為零是「尚未開始」，不代表工具或推廣效果不佳。',
  ];
  document.getElementById('unit-notes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
}

function renderFunnel(canvasId, key, funnel) {
  destroyChart(key);
  charts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: funnel.map((s) => s.label),
      datasets: [{ label: '人次', data: funnel.map((s) => s.count), backgroundColor: NAVY_SOFT }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: {
        afterBody: (items) => {
          const s = funnel[items[0].dataIndex];
          if (s.retention_from_prev === null) return '';
          return `相對前一階段：${(s.retention_from_prev * 100).toFixed(0)}%`;
        },
      } } },
    },
  });
}

function renderTools(tools) {
  destroyChart('tools');
  charts.tools = new Chart(document.getElementById('chart-tools'), {
    type: 'bar',
    data: { labels: tools.map((t) => t.label), datasets: [{ label: '瀏覽數', data: tools.map((t) => t.views), backgroundColor: GOLD }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function renderDevices(devices) {
  destroyChart('devices');
  charts.devices = new Chart(document.getElementById('chart-devices'), {
    type: 'doughnut',
    data: {
      labels: devices.map((d) => d.label),
      datasets: [{ data: devices.map((d) => d.sessions), backgroundColor: [NAVY, NAVY_SOFT, GOLD] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function renderAll(start, end) {
  const days = filterRange(ALL_DATA.days, start, end);
  const unitDays = ALL_DATA.days_by_unit.filter((d) => d.date >= start && d.date <= end);
  const toolDays = ALL_DATA.days_by_tool.filter((d) => d.date >= start && d.date <= end);
  const deviceDays = ALL_DATA.days_by_device.filter((d) => d.date >= start && d.date <= end);

  renderKpis(buildKpi(days));
  renderTrend(buildTrend(days));
  renderUnits(buildUnits(unitDays));
  renderFunnel('chart-funnel', 'funnel', buildFunnel(days));
  renderFunnel('chart-feedback-funnel', 'feedbackFunnel', buildFeedbackFunnel(days));
  renderTools(buildTools(toolDays));
  renderDevices(buildDevices(deviceDays));

  document.getElementById('data-range-sub').textContent = `顯示區間：${start} ～ ${end}`;
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function setupDateFilter() {
  const rolloutStart = ALL_DATA.meta.rollout_start;
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const [start, end] = presetRange(btn.dataset.preset, rolloutStart);
      document.getElementById('custom-start').value = start;
      document.getElementById('custom-end').value = end;
      renderAll(start, end);
    });
  });

  const applyCustom = () => {
    const start = document.getElementById('custom-start').value;
    const end = document.getElementById('custom-end').value;
    if (!start || !end || start > end) return;
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('active'));
    renderAll(start, end);
  };
  document.getElementById('custom-start').addEventListener('change', applyCustom);
  document.getElementById('custom-end').addEventListener('change', applyCustom);
}

async function unlock() {
  const password = document.getElementById('password-input').value;
  const errorEl = document.getElementById('gate-error');
  errorEl.textContent = '';
  try {
    const encBlob = await loadEncryptedData();
    ALL_DATA = await decryptData(encBlob, password);
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').classList.add('visible');
    setupTabs();
    setupDateFilter();
    const [start, end] = presetRange('all', ALL_DATA.meta.rollout_start);
    renderAll(start, end);
  } catch (e) {
    errorEl.textContent = '密碼錯誤，請重新輸入';
  }
}

document.getElementById('unlock-btn').addEventListener('click', unlock);
document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlock();
});
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add site/dashboard.js
git commit -m "feat: dashboard.js 串接解密／加總／Chart.js／頁籤／日期篩選"
```

---

## Task 11: 本機端到端驗證

**Files:** 無新檔案，驗證既有成果

- [ ] **Step 1: 用真實資料產生一份本機測試用的加密檔**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
.venv/bin/python fetch_daily.py
DASHBOARD_PASSWORD=local-manual-test .venv/bin/python encrypt_build.py
```
Expected: `site/data.enc.json` 被覆寫成這次執行的加密結果

- [ ] **Step 2: 起本機靜態伺服器**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site"
python3 -m http.server 8123
```

- [ ] **Step 3: 瀏覽器打開 `http://localhost:8123`，逐項人工檢查**

- 密碼輸入 `wrong-password-xyz` → 顯示「密碼錯誤，請重新輸入」，畫面不跳轉
- 密碼輸入 `local-manual-test` → 正確進入儀表板
- 五個頁籤都能點擊切換，切換時對應圖表正確顯示
- 總覽頁籤的折線圖、KPI 卡片有數字（不是全部掛零，除非帳號真的沒有任何資料）
- 單位頁籤：長青、益盛即使掛零也要出現在圖表裡；hover 長條圖能看到完成率
- 轉換路徑頁籤：兩個漏斗圖都渲染出來，五階段的使用漏斗數字遞減合理
- 工具頁籤：五個工具都列出，含「圓夢起點（已下架）」如果七月資料裡還有殘留瀏覽
- 裝置頁籤：圓餅圖三塊都有
- 日期篩選：點「本週」「本月」「近三個月」「累積至今」，畫面數字要跟著變動；用自訂日期選一個很短的區間，數字應該明顯變小
- 開瀏覽器開發者工具的 Console，全程沒有紅色錯誤訊息
- 開發者工具的 Network 分頁，確認**除了 Chart.js CDN 之外沒有其他外部請求**（資料完全在本機，篩選不打任何 API）

- [ ] **Step 4: 關閉伺服器**

```bash
# 在起伺服器的終端機按 Ctrl+C，或另開終端機執行：
pkill -f "http.server 8123"
```

- [ ] **Step 5: 確認沒有任何明文資料誤入 git**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git status --short
git diff --stat site/data.enc.json 2>/dev/null || echo "data.enc.json 尚未被 commit 過，等 Task 12 用正式密碼產生後才 commit"
```
Expected: `scripts/.cache/` 不出現在待追蹤清單；`site/data.enc.json` 若已存在於本機但還沒 commit 過真實內容，先不要 commit——等 Task 12 用 GitHub Secrets 裡的正式密碼透過 CI 產生第一份正式版本

---

## Task 12: GitHub repo、Secrets、Pages 設定與首次上線

**Files:** 無新程式檔案；`.github/workflows/build-deploy.yml` 除外

- [ ] **Step 1: 建立 `.github/workflows/build-deploy.yml`**

```yaml
name: Build and Deploy Dashboard

on:
  schedule:
    - cron: '0 0 * * *'   # 每日 UTC 00:00 = 台灣時間早上 8:00
  workflow_dispatch: {}

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: 安裝 Python 依賴
        run: pip install -r scripts/requirements.txt

      - name: 還原 GA4 憑證
        run: |
          mkdir -p /tmp/onetouch-ga-cred
          echo "$GA_CLIENT_SECRET_JSON" > /tmp/onetouch-ga-cred/client_secret.json
          echo "$GA_TOKEN_JSON" > /tmp/onetouch-ga-cred/token.json
        env:
          GA_CLIENT_SECRET_JSON: ${{ secrets.GA_CLIENT_SECRET_JSON }}
          GA_TOKEN_JSON: ${{ secrets.GA_TOKEN_JSON }}

      - name: 抓取每日粒度資料
        run: |
          cd scripts
          python fetch_daily.py
        env:
          ONETOUCH_GA_CRED_DIR: /tmp/onetouch-ga-cred

      - name: 加密建置
        run: |
          cd scripts
          python encrypt_build.py
        env:
          DASHBOARD_PASSWORD: ${{ secrets.DASHBOARD_PASSWORD }}

      - name: Commit 加密後的資料檔
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add site/data.enc.json
          git diff --staged --quiet && echo "資料無變化，略過 commit" || git commit -m "chore: 自動更新每日資料 $(date -u +%Y-%m-%d)"
          git push

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

> ⚠️ **`site/tests/` 目錄會被一起打包上傳到 Pages**（`upload-pages-artifact` 是整個 `site` 目錄）。這不影響功能（多出兩個沒人連結的檔案），但如果之後想避免這樣，可以在這個 Action 裡加一個「上傳前先排除 tests/ 目錄」的步驟。目前先不處理，記錄在範圍外。

- [ ] **Step 2: 建立 GitHub repo（用 gh CLI，已確認登入 Frank333tw）**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
gh repo create onetouch-dashboard --public --source=. --remote=origin
```
Expected: 印出新建 repo 的網址，`git remote -v` 能看到 `origin`

- [ ] **Step 3: 設定 GitHub Secrets**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"

gh secret set GA_CLIENT_SECRET_JSON --repo Frank333tw/onetouch-dashboard \
  < ~/.config/onetouch-ga/client_secret.json

gh secret set GA_TOKEN_JSON --repo Frank333tw/onetouch-dashboard \
  < ~/.config/onetouch-ga/token.json

# ⚠️ 密碼不能出現在任何要 commit 的檔案裡（這份計畫本身也會被 commit
# 到公開 repo）。用互動輸入，不要把密碼打進指令歷史或任何文件。
read -s -p "輸入 DASHBOARD_PASSWORD: " DASHBOARD_PASSWORD_VALUE
echo
echo -n "$DASHBOARD_PASSWORD_VALUE" | gh secret set DASHBOARD_PASSWORD --repo Frank333tw/onetouch-dashboard
unset DASHBOARD_PASSWORD_VALUE
```
Expected: 三個 `✓ Set Secrets ...` 訊息

- [ ] **Step 4: 啟用 GitHub Pages（來源設為 GitHub Actions）**

```bash
export PATH="$HOME/.local/bin:$PATH"
gh api -X POST repos/Frank333tw/onetouch-dashboard/pages \
  -f "build_type=workflow" 2>&1 || \
gh api -X PUT repos/Frank333tw/onetouch-dashboard/pages \
  -f "build_type=workflow"
```
Expected: 回傳 Pages 設定的 JSON（若已存在會用 PUT 更新，兩種情況都算成功）

- [ ] **Step 5: Push 程式碼並手動觸發第一次執行**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard"
git add .github/workflows/build-deploy.yml
git commit -m "feat: GitHub Actions 排程建置與部署流程"
git push -u origin main

gh workflow run build-deploy.yml --repo Frank333tw/onetouch-dashboard
```

- [ ] **Step 6: 追蹤執行結果**

```bash
export PATH="$HOME/.local/bin:$PATH"
sleep 20
gh run list --repo Frank333tw/onetouch-dashboard --limit 3
gh run watch --repo Frank333tw/onetouch-dashboard --exit-status
```
Expected: 最新一次執行狀態為 `completed success`。若失敗，用 `gh run view --repo Frank333tw/onetouch-dashboard --log-failed` 看錯誤訊息再排除

- [ ] **Step 7: 確認網站上線並可用真正密碼開啟**

```bash
gh api repos/Frank333tw/onetouch-dashboard/pages --jq '.html_url'
```
把印出的網址交給 Frank，用之前設定進 `DASHBOARD_PASSWORD` Secret 的密碼開啟確認畫面正常（密碼是什麼不寫在這裡——Frank 自己知道，見 Step 3 的互動輸入）

- [ ] **Step 8: 回報固定網址**

把 Step 7 的網址記錄下來——之後每次自動重建都是同一個網址，不會改變。

---

## 完成後

- 每日 UTC 00:00 自動重建，`workflow_dispatch` 可隨時手動觸發
- `site/data.enc.json` 的 git 歷史就是永久存檔（只有密文，任何時候翻查都不會看到明文數字）
- 尚未處理（設計規格「範圍外」記錄）：登入失敗次數限制（架構限制，做不到）、PDF 匯出（不需要）、與月報腳本共用程式碼（刻意分開）
- 已知的小尾巴：Pages 部署會連 `site/tests/` 一起上傳，不影響功能，之後想排除的話再處理

---

## Self-Review

**Spec coverage 檢查**：
- 資料來源方式（預先撈好、前端篩選）→ Task 3-10 ✅
- 密碼保護真加密 → Task 2、7 ✅（含跨語言互通驗證）
- 更新機制（GitHub Actions 排程免費）→ Task 12 ✅
- 部署平台 GitHub Pages → Task 12 ✅
- 五頁籤依主題分組 → Task 9、10 ✅
- 公開 repo 但資料保護不能靠明文存底 → Task 6（fixture 用假資料）、Task 12（workflow 只 commit 加密後的檔案）✅
- 每日粒度資料模型 → Task 3、4 ✅
- Chart.js + SRI → Task 9 ✅（真實驗證過的雜湊值，非杜撰）
- GA4 憑證沿用既有設定 → Task 12 Step 3 ✅

**Placeholder 掃描**：全文搜尋 TBD/TODO/待補，無殘留。

**型別一致性檢查**：
- Python `days` 欄位名稱（`tool_open`、`result_view`、`result_generate_image`、`result_download`、`result_share`、`hub_view`、`feedback_opened`、`feedback_page2`、`feedback_submitted`、`feedback_pdf`）與 JS `aggregate.js`/`dashboard.js` 引用的欄位名稱逐一核對一致
- `crypto_utils.py` 的加密輸出欄位（`salt`/`iv`/`ciphertext`/`iterations`）與 `decrypt.js` 讀取的欄位名稱一致
- `buildFunnel`/`buildFeedbackFunnel` 的 `stage`/`label`/`count`/`retention_from_prev` 欄位在 `dashboard.js` 的 `renderFunnel` 裡引用方式一致

**已修正的問題**：資料模型比原始規格草圖更具體（明確列出 `days` 裡每個欄位），這是規格階段留給實作階段決定的合理細節，不算偏離規格。
