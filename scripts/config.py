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
