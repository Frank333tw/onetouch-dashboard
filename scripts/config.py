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
NOTION_CACHE_PATH = CACHE_DIR / "notion_raw.json"

# 加密後成品的存放位置（唯一會被 commit 的資料檔）
SITE_DIR = BASE_DIR / "site"
ENCRYPTED_DATA_PATH = SITE_DIR / "data.enc.json"

# 推廣起始日：抓取範圍從這天開始
ROLLOUT_START = "2026-07-01"

# ⚠️ 這幾份對照表（UNIT_LABELS／TOOL_LABELS／DEVICE_LABELS）目前沒有任何
# 生產程式碼路徑引用——fetch_daily.py／transform_daily.py 都不匯入它們，
# 只有 tests/test_config.py 在測。使用者實際看到的中文標籤來自
# site/aggregate.js 自己的同名對照表（那份才是真正生效、需要跟這裡手動
# 保持一致的版本）。之後若要改標籤文字，兩邊都要改；若之後要讓這裡真正
# 成為單一資料來源，可仿照 REPORT_NOTES 的做法經 fetch_daily.py 的
# meta 欄位傳到前端。
UNIT_LABELS = {
    "taian": "台安",
    "feiang": "飛昂",
    "(direct)": "直接進入／未帶追蹤連結",
}

TOOL_LABELS = {
    "/tool/behavior-disc": "行為模式 DISC",
    "/tool/career-needs": "收入需求試算",
    "/tool/career-motivation": "動力分析",
    "/tool/work-satisfaction": "工作滿意度",
    "/tool/career-placement": "職業落點",
}

DEVICE_LABELS = {
    "desktop": "桌機",
    "mobile": "手機",
    "tablet": "平板",
}

# 固定出現在單位比較區塊的推廣單位，即使數字為零
# 長青、益盛討論後最終沒有參與測試，不再追蹤
TRACKED_UNITS = ["taian", "feiang"]

# transform_daily.py 實際會處理的事件名稱——查詢 GA4 時用來篩選 eventName，
# 避免把 page_view／scroll／session_start 這類 GA4 自動收集、我們沒在用的
# 事件也撈進來，讓查詢結果的筆數不必要地變大（GA4 單次查詢有筆數上限，
# 篩掉用不到的事件等於買到更長的安全邊際）。
TRACKED_EVENTS = [
    "tool_open",
    "result_view",
    "result_generate_image",
    "result_download",
    "result_share",
    "result_feedback_opened",
    "result_feedback_page2_view",
    "result_feedback_submitted",
    "result_feedback_pdf_download",
]

# 單位比較區塊只用到這兩個事件（見 transform_daily.build_days_by_unit），
# 篩選範圍比 TRACKED_EVENTS 更小，進一步降低這個查詢的筆數。
UNIT_TRACKED_EVENTS = ["tool_open", "result_view"]

REPORT_NOTES = [
    "單位數字可能偏低：主管第一次用單位連結進入才會正確歸戶，"
    "之後回訪（直接開網址、用書籤）會算成「直接進入」，不算進原單位。",
]


def unit_label(source: str) -> str:
    return UNIT_LABELS.get(source, source)


def tool_label(path: str) -> str:
    return TOOL_LABELS.get(path, path)


def device_label(category: str) -> str:
    return DEVICE_LABELS.get(category, category)
