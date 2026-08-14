# 問卷回饋頁籤（Notion 串接）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 儀表板新增「問卷回饋」頁籤，每日自動從 Notion「測驗結果回饋表紀錄」資料庫同步問卷資料，顯示彙整統計與逐筆紀錄（可篩選、分頁、下載 Excel）。

**Architecture:** 比照既有 GA4 管線：GitHub Actions 每日排程新增一支腳本呼叫 Notion API 抓資料，併入既有的加密建置流程，最終成品仍是同一份 `site/data.enc.json`（多一個 `feedback_records` 欄位）。前端沿用「純函式做資料整理＋DOM 渲染分離」的既有分工，新增的篩選、分頁、Excel 下載全部是純前端邏輯，不需要後端 API。

**Tech Stack:** Python 3.12（`requests` 呼叫 Notion API）／既有 `pytest`、`node --test`／前端純 JS ES module／SheetJS（`xlsx.full.min.js`，CDN 載入，同 Chart.js 的載入方式）

**Spec:** `docs/superpowers/specs/2026-08-14-notion-feedback-tab-design.md`

---

## 前置需求（Frank 手動操作，不屬於任何 Task，但 Task 3 之後的步驟依賴它）

在執行 Task 3（`fetch_notion.py` 需要真的呼叫 Notion API）之前，Frank 需要：

1. 打開 Notion「測驗結果回饋表紀錄」資料庫（`https://app.notion.com/p/7bda2331f51344049378e9be09ad6cc9`）→ 右上角「...」→「Connections」→ 確認「OneTouch回饋同步」這個 integration 已被加入（`recruitment-web` 寫入時已加過，讀取用同一顆 token，理論上不用重加，但建議上機前用畫面確認一次）
2. 到 `recruitment-web` 或原本設定 integration 的地方，複製該 integration 的 Internal Integration Secret（`ntn_` 開頭）
3. 到 GitHub repo `Frank333tw/onetouch-dashboard` → Settings → Secrets and variables → Actions → New repository secret，新增兩個：
   - `NOTION_TOKEN` = 上一步複製的 token
   - `NOTION_DATABASE_ID` = `7bda2331f51344049378e9be09ad6cc9`

本機開發測試（Task 1-4）不需要真的連線 Notion，用 mock／假資料即可完成並通過測試；只有想在本機手動跑一次 `fetch_notion.py` 真實驗證時，才需要在本機終端機 `export NOTION_TOKEN=... NOTION_DATABASE_ID=...` 後執行。

---

### Task 1: Notion API 客戶端（`scripts/notion_client.py`）

**Files:**
- Create: `scripts/notion_client.py`
- Create: `scripts/tests/test_notion_client.py`
- Modify: `scripts/requirements.txt`

- [ ] **Step 1: 在 requirements.txt 加入 requests**

打開 `scripts/requirements.txt`，加一行：

```
requests==2.32.3
```

完整檔案內容應為：

```
google-analytics-data==0.23.0
google-auth-oauthlib==1.4.0
cryptography==49.0.0
pytest==9.1.1
requests==2.32.3
```

安裝：

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && pip install -r requirements.txt
```

- [ ] **Step 2: 寫失敗的測試（環境變數檢查）**

建立 `scripts/tests/test_notion_client.py`：

```python
import pytest

from notion_client import NotionClient


def test_raises_when_token_missing(monkeypatch):
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    monkeypatch.setenv("NOTION_DATABASE_ID", "test-db-id")
    with pytest.raises(SystemExit):
        NotionClient()


def test_raises_when_database_id_missing(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    monkeypatch.delenv("NOTION_DATABASE_ID", raising=False)
    with pytest.raises(SystemExit):
        NotionClient()
```

- [ ] **Step 3: 執行測試確認失敗（因為 notion_client.py 還不存在）**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/test_notion_client.py -v
```

預期：`ModuleNotFoundError: No module named 'notion_client'`

- [ ] **Step 4: 寫最小實作**

建立 `scripts/notion_client.py`：

```python
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
```

- [ ] **Step 5: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/test_notion_client.py -v
```

預期：2 個測試 PASS

- [ ] **Step 6: 補分頁邏輯的測試（mock requests.post）**

在 `scripts/tests/test_notion_client.py` 加入：

```python
from unittest.mock import MagicMock, patch


def _client(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    monkeypatch.setenv("NOTION_DATABASE_ID", "test-db-id")
    return NotionClient()


@patch("notion_client.requests.post")
def test_query_database_follows_pagination_cursor(mock_post, monkeypatch):
    client = _client(monkeypatch)

    page1 = MagicMock()
    page1.json.return_value = {
        "results": [{"id": "a"}, {"id": "b"}],
        "has_more": True,
        "next_cursor": "cursor-1",
    }
    page2 = MagicMock()
    page2.json.return_value = {
        "results": [{"id": "c"}],
        "has_more": False,
        "next_cursor": None,
    }
    mock_post.side_effect = [page1, page2]

    pages = client.query_database()

    assert [p["id"] for p in pages] == ["a", "b", "c"]
    assert mock_post.call_count == 2
    second_call_body = mock_post.call_args_list[1].kwargs["json"]
    assert second_call_body["start_cursor"] == "cursor-1"


@patch("notion_client.requests.post")
def test_query_database_stops_when_has_more_is_false(mock_post, monkeypatch):
    client = _client(monkeypatch)
    single_page = MagicMock()
    single_page.json.return_value = {"results": [{"id": "x"}], "has_more": False, "next_cursor": None}
    mock_post.return_value = single_page

    pages = client.query_database()

    assert len(pages) == 1
    assert mock_post.call_count == 1
```

- [ ] **Step 7: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/test_notion_client.py -v
```

預期：4 個測試 PASS

- [ ] **Step 8: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add scripts/notion_client.py scripts/tests/test_notion_client.py scripts/requirements.txt && git commit -m "feat: 新增 Notion API 客戶端（分頁查詢資料庫）"
```

---

### Task 2: 資料轉換（`scripts/transform_notion.py`）

**Files:**
- Create: `scripts/transform_notion.py`
- Create: `scripts/tests/test_transform_notion.py`

- [ ] **Step 1: 寫失敗的測試**

建立 `scripts/tests/test_transform_notion.py`：

```python
from transform_notion import build_feedback_records


def _prop_title(text):
    return {"title": [{"plain_text": text}]}


def _prop_text(text):
    return {"rich_text": [{"plain_text": text}] if text else []}


def _prop_select(name):
    return {"select": {"name": name} if name else None}


def _prop_multi_select(names):
    return {"multi_select": [{"name": n} for n in names]}


def _prop_number(value):
    return {"number": value}


def _prop_checkbox(value):
    return {"checkbox": value}


def _prop_date(iso_string):
    return {"date": {"start": iso_string} if iso_string else None}


def _full_page(page_id="page-1", submitted_at="2026-08-12T09:00:00.000+08:00"):
    return {
        "id": page_id,
        "properties": {
            "名稱": _prop_title("王曉萱 - 行為模式DISC"),
            "工具名稱": _prop_select("行為模式DISC"),
            "主管姓名": _prop_text("陳建宏"),
            "主管區域": _prop_select("北二"),
            "主管單位": _prop_select("信義通訊處"),
            "受測者姓名": _prop_text("王曉萱"),
            "受測者性別": _prop_select("女"),
            "受測者年齡": _prop_number(28),
            "受測者職業": _prop_text("門市人員"),
            "整體體驗星等": _prop_number(5),
            "流程體驗星等": _prop_number(4),
            "是否推薦": _prop_checkbox(True),
            "留言": _prop_text("解說很清楚。"),
            "Q1 更了解工作現況": _prop_select("非常同意"),
            "Q2 開始思考轉變": _prop_select("同意"),
            "Q3 願意了解機會": _prop_select("同意"),
            "Q4 最希望改善項目": _prop_multi_select(["結果解讀說明", "介面速度"]),
            "Q4 其他文字": _prop_text(""),
            "Q5 希望提供資訊": _prop_multi_select(["薪資制度", "教育訓練"]),
            "提交時間": _prop_date(submitted_at),
        },
    }


def test_build_feedback_records_maps_all_fields():
    records = build_feedback_records([_full_page()])
    assert len(records) == 1
    r = records[0]
    assert r["id"] == "page-1"
    assert r["submitted_at"] == "2026-08-12T09:00:00.000+08:00"
    assert r["tool_title"] == "行為模式DISC"
    assert r["mgr_name"] == "陳建宏"
    assert r["mgr_region"] == "北二"
    assert r["mgr_office"] == "信義通訊處"
    assert r["cand_name"] == "王曉萱"
    assert r["cand_gender"] == "女"
    assert r["cand_age"] == 28
    assert r["cand_occupation"] == "門市人員"
    assert r["cand_overall"] == 5
    assert r["cand_process"] == 4
    assert r["cand_recommend"] is True
    assert r["cand_comment"] == "解說很清楚。"
    assert r["adv_q1"] == "非常同意"
    assert r["adv_q2"] == "同意"
    assert r["adv_q3"] == "同意"
    assert r["adv_q4"] == ["結果解讀說明", "介面速度"]
    assert r["adv_q4_other"] == ""
    assert r["adv_q5"] == ["薪資制度", "教育訓練"]


def test_build_feedback_records_handles_empty_optional_fields():
    page = _full_page(page_id="page-2")
    page["properties"]["Q1 更了解工作現況"] = _prop_select(None)
    page["properties"]["Q4 最希望改善項目"] = _prop_multi_select([])
    page["properties"]["留言"] = _prop_text("")

    records = build_feedback_records([page])

    r = records[0]
    assert r["adv_q1"] is None, "未填的 select 要是 None，不能報錯或變成空字串跟'未填'混淆"
    assert r["adv_q4"] == []
    assert r["cand_comment"] == ""


def test_build_feedback_records_sorts_newest_first():
    older = _full_page(page_id="old", submitted_at="2026-08-01T00:00:00.000+08:00")
    newer = _full_page(page_id="new", submitted_at="2026-08-12T00:00:00.000+08:00")

    records = build_feedback_records([older, newer])

    assert [r["id"] for r in records] == ["new", "old"]
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/test_transform_notion.py -v
```

預期：`ModuleNotFoundError: No module named 'transform_notion'`

- [ ] **Step 3: 寫實作**

建立 `scripts/transform_notion.py`：

```python
"""Notion API page 物件 → 逐筆問卷回饋紀錄。純函式，無網路、無檔案 IO。"""


def _rich_text(prop):
    return "".join(p["plain_text"] for p in prop.get("rich_text", []))


def _select(prop):
    value = prop.get("select")
    return value["name"] if value else None


def _multi_select(prop):
    return [item["name"] for item in prop.get("multi_select", [])]


def _number(prop):
    return prop.get("number")


def _checkbox(prop):
    return bool(prop.get("checkbox"))


def _date(prop):
    value = prop.get("date")
    return value["start"] if value else None


def build_feedback_records(pages):
    """pages: Notion database query 回傳的 results 陣列（原始 page 物件）。
    依提交時間新到舊排序，供前端逐筆列表預設顯示最新的在最上面。
    """
    records = []
    for page in pages:
        props = page["properties"]
        records.append({
            "id": page["id"],
            "submitted_at": _date(props["提交時間"]),
            "tool_title": _select(props["工具名稱"]),
            "mgr_name": _rich_text(props["主管姓名"]),
            "mgr_region": _select(props["主管區域"]),
            "mgr_office": _select(props["主管單位"]),
            "cand_name": _rich_text(props["受測者姓名"]),
            "cand_gender": _select(props["受測者性別"]),
            "cand_age": _number(props["受測者年齡"]),
            "cand_occupation": _rich_text(props["受測者職業"]),
            "cand_overall": _number(props["整體體驗星等"]),
            "cand_process": _number(props["流程體驗星等"]),
            "cand_recommend": _checkbox(props["是否推薦"]),
            "cand_comment": _rich_text(props["留言"]),
            "adv_q1": _select(props["Q1 更了解工作現況"]),
            "adv_q2": _select(props["Q2 開始思考轉變"]),
            "adv_q3": _select(props["Q3 願意了解機會"]),
            "adv_q4": _multi_select(props["Q4 最希望改善項目"]),
            "adv_q4_other": _rich_text(props["Q4 其他文字"]),
            "adv_q5": _multi_select(props["Q5 希望提供資訊"]),
        })
    records.sort(key=lambda r: r["submitted_at"] or "", reverse=True)
    return records
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/test_transform_notion.py -v
```

預期：3 個測試 PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add scripts/transform_notion.py scripts/tests/test_transform_notion.py && git commit -m "feat: Notion page 物件轉換成逐筆問卷回饋紀錄"
```

---

### Task 3: 抓取腳本與快取路徑（`scripts/fetch_notion.py`）

**Files:**
- Modify: `scripts/config.py`
- Create: `scripts/fetch_notion.py`

- [ ] **Step 1: 在 config.py 加入 Notion 快取路徑常數**

打開 `scripts/config.py`，在既有的 `CACHE_PATH = CACHE_DIR / "daily_raw.json"`（第 21 行）之後加一行：

```python
CACHE_PATH = CACHE_DIR / "daily_raw.json"
NOTION_CACHE_PATH = CACHE_DIR / "notion_raw.json"
```

- [ ] **Step 2: 寫 fetch_notion.py**

建立 `scripts/fetch_notion.py`：

```python
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
```

這支腳本本身不寫額外測試——比照 `fetch_daily.py` 的既有慣例：協調層（呼叫 API client＋轉換函式＋寫檔）不重複測試，因為 `NotionClient`（Task 1）與 `build_feedback_records`（Task 2）已經個別測過，`main()` 只是薄薄一層串接。

- [ ] **Step 3: 手動驗證（需要 Notion 憑證，本機測試用）**

若本機已設定 `NOTION_TOKEN`／`NOTION_DATABASE_ID` 環境變數：

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python fetch_notion.py
```

預期輸出 `已寫入 .../scripts/.cache/notion_raw.json`，並印出筆數。若尚未設定憑證（見本文件最前面的「前置需求」），此步驟可以先跳過，不影響後續 Task。

- [ ] **Step 4: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add scripts/config.py scripts/fetch_notion.py && git commit -m "feat: 新增 fetch_notion.py 抓取問卷回饋資料"
```

---

### Task 4: 併入加密建置流程（`scripts/encrypt_build.py`）

**Files:**
- Modify: `scripts/encrypt_build.py`

- [ ] **Step 1: 修改 encrypt_build.py，讀取並併入 Notion 快取**

打開 `scripts/encrypt_build.py`，把：

```python
from config import CACHE_PATH, ENCRYPTED_DATA_PATH
from crypto_utils import encrypt_json


def main():
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        sys.exit("環境變數 DASHBOARD_PASSWORD 未設定，無法加密。")

    if not CACHE_PATH.exists():
        sys.exit(f"找不到 {CACHE_PATH}，請先執行 fetch_daily.py")

    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        sys.exit(f"找不到有效的快取資料，{CACHE_PATH} 內容無法解析為 JSON")
```

改成：

```python
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
```

（後面 `enc = encrypt_json(data, password)` 開始的內容不動。）

這是刻意選擇的失敗模式：Notion 快取跟 GA4 快取地位相同，兩者缺一都讓整個建置失敗、不產出新的 `data.enc.json`——比照既有 GA4 管線「排程若壞掉，網站繼續顯示上一次成功的資料」的 fail-closed 設計（見 `dashboard.js` 對 `data-range-sub` 的處理），這裡不做「GA4 更新但問卷回饋沿用舊資料」的局部復原，理由是那需要在 `encrypt_build.py` 裡額外解密舊版 `data.enc.json` 來取回上次的 `feedback_records`，複雜度不成比例——維持跟 GA4 一致的簡單規則。

- [ ] **Step 2: 手動驗證**

建立假的兩份快取檔測試合併邏輯：

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
mkdir -p .cache
echo '{"days": [], "meta": {"rollout_start": "2026-07-01", "last_day": "2026-08-13"}, "notes": []}' > .cache/daily_raw.json
echo '{"feedback_records": [{"id": "test-1", "cand_name": "測試"}]}' > .cache/notion_raw.json
DASHBOARD_PASSWORD=test123 python encrypt_build.py
cat ../site/data.enc.json | python -m json.tool | head -5
```

預期：印出 `已寫入 .../site/data.enc.json`，且該檔案是加密後的 JSON（`salt`/`iv`/`ciphertext`/`iterations` 欄位），不是明文。驗證完後把 `site/data.enc.json` 還原（`git checkout site/data.enc.json`），避免把測試用假資料誤 commit。

- [ ] **Step 3: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add scripts/encrypt_build.py && git commit -m "feat: encrypt_build.py 併入 Notion 問卷回饋資料"
```

---

### Task 5: GitHub Actions 排程串接 Notion 抓取

**Files:**
- Modify: `.github/workflows/build-deploy.yml`

- [ ] **Step 1: 在「抓取每日粒度資料」與「加密建置」兩個既有 step 之間，新增「抓取問卷回饋資料」step**

打開 `.github/workflows/build-deploy.yml`，找到：

```yaml
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
```

改成：

```yaml
      - name: 抓取每日粒度資料
        run: |
          cd scripts
          python fetch_daily.py
        env:
          ONETOUCH_GA_CRED_DIR: /tmp/onetouch-ga-cred

      - name: 抓取問卷回饋資料
        run: |
          cd scripts
          python fetch_notion.py
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}

      - name: 加密建置
        run: |
          cd scripts
          python encrypt_build.py
        env:
          DASHBOARD_PASSWORD: ${{ secrets.DASHBOARD_PASSWORD }}
```

- [ ] **Step 2: 確認 GitHub Secrets 已設定**

這一步是確認，不是程式修改：前往 `https://github.com/Frank333tw/onetouch-dashboard/settings/secrets/actions`，確認 `NOTION_TOKEN`、`NOTION_DATABASE_ID` 兩個 secrets 存在（見本文件最前面「前置需求」，若尚未設定，Frank 需要先手動完成）。沒有這兩個 secrets，`workflow_dispatch` 手動觸發或每日排程都會在「抓取問卷回饋資料」這個 step 失敗（`NotionClient.__init__` 會 `sys.exit`）。

- [ ] **Step 3: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add .github/workflows/build-deploy.yml && git commit -m "feat: CI 排程新增 Notion 問卷回饋資料抓取"
```

---

### Task 6: 前端彙整統計純函式（`site/aggregate.js`）

**Files:**
- Modify: `site/aggregate.js`
- Modify: `site/tests/aggregate.test.js`

- [ ] **Step 1: 查證 Notion adv_q1-q3 的 select 選項實際文字**

這一步需要 Notion 憑證（見前置需求），在終端機執行：

```bash
curl -s -X GET "https://api.notion.com/v1/databases/$NOTION_DATABASE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  | python3 -m json.tool > /tmp/notion-schema.json
grep -A 20 '"Q1 更了解工作現況"' /tmp/notion-schema.json
```

輸出的 `select.options` 陣列裡每個物件的 `"name"` 欄位就是實際選項文字（例如可能是「非常同意」「同意」「普通」「不同意」「非常不同意」五分量表，或其他文字——**以實際輸出為準，不要假設**）。記下裡面「算作同意」的選項文字（通常是量表裡偏正向的那幾個），下一步要用。

- [ ] **Step 2: 寫失敗的測試**

打開 `site/tests/aggregate.test.js`，在檔案開頭 import 那行加入新函式名稱：

```js
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
  buildFeedbackKpi, buildAdvocacyDistribution, buildImprovementRanking,
  filterFeedbackRecords, distinctSorted, paginate,
} from '../aggregate.js';
```

在檔案尾端加入（先用假設的「同意」「非常同意」，Step 1 查到的實際選項文字若不同，這裡跟著改）：

```js
const FEEDBACK_RECORDS = [
  { id: '1', submitted_at: '2026-08-01T00:00:00.000+08:00', tool_title: 'DISC',
    mgr_office: '信義通訊處', cand_overall: 5, cand_process: 4, cand_recommend: true,
    adv_q1: '非常同意', adv_q2: '同意', adv_q3: null, adv_q4: ['介面速度'] },
  { id: '2', submitted_at: '2026-08-05T00:00:00.000+08:00', tool_title: '收入需求試算',
    mgr_office: '大墩通訊處', cand_overall: 3, cand_process: 3, cand_recommend: false,
    adv_q1: '不同意', adv_q2: '同意', adv_q3: '同意', adv_q4: ['介面速度', '題目數量'] },
];

test('buildFeedbackKpi 計算平均星等與推薦率', () => {
  const kpi = buildFeedbackKpi(FEEDBACK_RECORDS);
  assert.equal(kpi.count, 2);
  assert.equal(kpi.avg_overall, 4);
  assert.equal(kpi.avg_process, 3.5);
  assert.equal(kpi.recommend_rate, 0.5);
});

test('buildFeedbackKpi 空陣列時平均值回 null 不是 0', () => {
  const kpi = buildFeedbackKpi([]);
  assert.equal(kpi.count, 0);
  assert.equal(kpi.avg_overall, null);
  assert.equal(kpi.recommend_rate, null);
});

test('buildAdvocacyDistribution 只計入有填答的紀錄，未填不計入分母', () => {
  const dist = buildAdvocacyDistribution(FEEDBACK_RECORDS);
  const q1 = dist.find((d) => d.field === 'adv_q1');
  const q3 = dist.find((d) => d.field === 'adv_q3');
  assert.equal(q1.answered_count, 2);
  assert.equal(q1.agree_rate, 0.5, '兩筆各一同意一不同意');
  assert.equal(q3.answered_count, 1, '一筆是 null，不計入分母');
  assert.equal(q3.agree_rate, 1);
});

test('buildImprovementRanking 多選值攤平計數並排序', () => {
  const ranking = buildImprovementRanking(FEEDBACK_RECORDS);
  assert.equal(ranking[0].label, '介面速度');
  assert.equal(ranking[0].count, 2);
  assert.equal(ranking[1].label, '題目數量');
  assert.equal(ranking[1].count, 1);
});

test('filterFeedbackRecords 依日期區間與單位篩選', () => {
  const result = filterFeedbackRecords(FEEDBACK_RECORDS, {
    start: '2026-08-01', end: '2026-08-01', office: 'all', tool: 'all', recommend: 'all',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
});

test('filterFeedbackRecords 依推薦與否篩選', () => {
  const result = filterFeedbackRecords(FEEDBACK_RECORDS, {
    start: '2026-08-01', end: '2026-08-31', office: 'all', tool: 'all', recommend: 'no',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
});

test('distinctSorted 取不重複值並排序', () => {
  const offices = distinctSorted(FEEDBACK_RECORDS, 'mgr_office');
  assert.deepEqual(offices, ['大墩通訊處', '信義通訊處']);
});

test('paginate 切頁並回傳頁數資訊', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const result = paginate(items, 2, 10);
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0], 10);
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 3);
  assert.equal(result.totalCount, 25);
});

test('paginate 頁碼超出範圍時夾回最後一頁', () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  const result = paginate(items, 99, 10);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && node --test
```

預期：新增的測試因為 `buildFeedbackKpi` 等函式不存在而 FAIL（`SyntaxError` 或 `undefined is not a function`）

- [ ] **Step 4: 在 aggregate.js 加入新函式**

打開 `site/aggregate.js`，在檔案尾端（`buildTrend` 函式之後）加入：

```js
export function buildFeedbackKpi(records) {
  const count = records.length;
  const avg = (field) => (count ? records.reduce((acc, r) => acc + r[field], 0) / count : null);
  const recommendCount = records.filter((r) => r.cand_recommend).length;
  return {
    count,
    avg_overall: avg('cand_overall'),
    avg_process: avg('cand_process'),
    recommend_rate: count ? recommendCount / count : null,
  };
}

// 「算作同意」的選項文字——來自 Notion「測驗結果回饋表紀錄」資料庫
// adv_q1/adv_q2/adv_q3 三個 select 欄位的實際選項，查證方式見本檔案
// 對應的 implementation plan Task 6 Step 1。
const ADVOCACY_AGREE_OPTIONS = new Set(['同意', '非常同意']);

const ADVOCACY_QUESTIONS = [
  ['adv_q1', 'Q1 更了解工作現況'],
  ['adv_q2', 'Q2 開始思考轉變'],
  ['adv_q3', 'Q3 願意了解機會'],
];

export function buildAdvocacyDistribution(records) {
  return ADVOCACY_QUESTIONS.map(([field, label]) => {
    const answered = records.filter((r) => r[field] !== null && r[field] !== undefined);
    const agreeCount = answered.filter((r) => ADVOCACY_AGREE_OPTIONS.has(r[field])).length;
    return {
      field,
      label,
      answered_count: answered.length,
      agree_rate: answered.length ? agreeCount / answered.length : null,
    };
  });
}

export function buildImprovementRanking(records) {
  const acc = {};
  for (const r of records) {
    for (const item of r.adv_q4 || []) {
      acc[item] = (acc[item] || 0) + 1;
    }
  }
  return Object.entries(acc)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function filterFeedbackRecords(records, { start, end, office = 'all', tool = 'all', recommend = 'all' }) {
  return records.filter((r) => {
    const date = r.submitted_at.slice(0, 10);
    if (date < start || date > end) return false;
    if (office !== 'all' && r.mgr_office !== office) return false;
    if (tool !== 'all' && r.tool_title !== tool) return false;
    if (recommend === 'yes' && !r.cand_recommend) return false;
    if (recommend === 'no' && r.cand_recommend) return false;
    return true;
  });
}

export function distinctSorted(records, field) {
  return [...new Set(records.map((r) => r[field]))].filter(Boolean).sort();
}

export function paginate(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    totalCount: items.length,
  };
}
```

**若 Step 1 查到的實際「同意類」選項文字跟上面 `ADVOCACY_AGREE_OPTIONS` 的假設值（`'同意'`, `'非常同意'`）不同，這裡要照實際查到的文字修改**，並同步修改 Step 2 測試資料裡的 `adv_q1`/`adv_q2`/`adv_q3` 假資料文字，確保測試值跟這裡的判斷邏輯用的是同一套字。

- [ ] **Step 5: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && node --test
```

預期：全部測試（含既有的）PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add site/aggregate.js site/tests/aggregate.test.js && git commit -m "feat: 問卷回饋彙整統計純函式（KPI／意願度分布／改善項目排行／篩選／分頁）"
```

---

### Task 7: Excel 匯出純函式（`site/export-excel.js`）

**Files:**
- Create: `site/export-excel.js`
- Create: `site/tests/export-excel.test.js`

- [ ] **Step 1: 寫失敗的測試**

建立 `site/tests/export-excel.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbookRows, buildFilename } from '../export-excel.js';

const RECORDS = [
  {
    tool_title: '行為模式DISC', mgr_name: '陳建宏', mgr_region: '北二', mgr_office: '信義通訊處',
    cand_name: '王曉萱', cand_gender: '女', cand_age: 28, cand_occupation: '門市人員',
    cand_overall: 5, cand_process: 4, cand_recommend: true, cand_comment: '解說很清楚。',
    adv_q1: '非常同意', adv_q2: '同意', adv_q3: null,
    adv_q4: ['結果解讀說明', '介面速度'], adv_q4_other: '', adv_q5: ['薪資制度'],
    submitted_at: '2026-08-12T09:00:00.000+08:00',
  },
];

test('buildWorkbookRows 把多選陣列合併成頓號分隔字串', () => {
  const rows = buildWorkbookRows(RECORDS);
  assert.equal(rows[0]['Q4 最希望改善項目'], '結果解讀說明、介面速度');
  assert.equal(rows[0]['Q5 希望提供資訊'], '薪資制度');
});

test('buildWorkbookRows 把布林值轉成是/否', () => {
  const rows = buildWorkbookRows(RECORDS);
  assert.equal(rows[0]['是否推薦'], '是');
});

test('buildWorkbookRows 把 null 轉成空字串，不是字面上的 "null"', () => {
  const rows = buildWorkbookRows(RECORDS);
  assert.equal(rows[0]['Q3 願意了解機會'], '');
});

test('buildWorkbookRows 保留所有 19 個欄位對應的中文表頭', () => {
  const rows = buildWorkbookRows(RECORDS);
  const headers = Object.keys(rows[0]);
  assert.equal(headers.length, 19);
  assert.ok(headers.includes('受測者姓名'));
  assert.ok(headers.includes('提交時間'));
});

test('buildFilename 套用單位篩選與日期區間', () => {
  const name = buildFilename({ office: '信義通訊處' }, ['2026-07-01', '2026-08-14']);
  assert.equal(name, '問卷回饋_信義通訊處_2026-07-01至2026-08-14.xlsx');
});

test('buildFilename 無單位篩選時用「全部」', () => {
  const name = buildFilename({ office: 'all' }, ['2026-07-01', '2026-08-14']);
  assert.equal(name, '問卷回饋_全部_2026-07-01至2026-08-14.xlsx');
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && node --test tests/export-excel.test.js
```

預期：FAIL，找不到 `../export-excel.js`

- [ ] **Step 3: 寫實作**

建立 `site/export-excel.js`：

```js
// 問卷回饋逐筆紀錄 → Excel 下載。純資料整理（buildWorkbookRows／buildFilename）
// 與實際觸發下載（downloadFeedbackExcel，依賴全域 window.XLSX）分開，
// 前者可在 Node 測試環境驗證，後者需要瀏覽器與 SheetJS，不寫自動化測試。

const COLUMNS = [
  ['tool_title', '工具名稱'],
  ['mgr_name', '主管姓名'],
  ['mgr_region', '主管區域'],
  ['mgr_office', '主管單位'],
  ['cand_name', '受測者姓名'],
  ['cand_gender', '受測者性別'],
  ['cand_age', '受測者年齡'],
  ['cand_occupation', '受測者職業'],
  ['cand_overall', '整體體驗星等'],
  ['cand_process', '流程體驗星等'],
  ['cand_recommend', '是否推薦'],
  ['cand_comment', '留言'],
  ['adv_q1', 'Q1 更了解工作現況'],
  ['adv_q2', 'Q2 開始思考轉變'],
  ['adv_q3', 'Q3 願意了解機會'],
  ['adv_q4', 'Q4 最希望改善項目'],
  ['adv_q4_other', 'Q4 其他文字'],
  ['adv_q5', 'Q5 希望提供資訊'],
  ['submitted_at', '提交時間'],
];

export function buildWorkbookRows(records) {
  return records.map((record) => {
    const row = {};
    for (const [key, header] of COLUMNS) {
      const value = record[key];
      if (Array.isArray(value)) row[header] = value.join('、');
      else if (typeof value === 'boolean') row[header] = value ? '是' : '否';
      else if (value === null || value === undefined) row[header] = '';
      else row[header] = value;
    }
    return row;
  });
}

export function buildFilename(filters, range) {
  const office = filters.office && filters.office !== 'all' ? filters.office : '全部';
  const [start, end] = range;
  return `問卷回饋_${office}_${start}至${end}.xlsx`;
}

export function downloadFeedbackExcel(records, filters, range) {
  const rows = buildWorkbookRows(records);
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, '問卷回饋');
  window.XLSX.writeFile(workbook, buildFilename(filters, range));
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && node --test tests/export-excel.test.js
```

預期：6 個測試 PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add site/export-excel.js site/tests/export-excel.test.js && git commit -m "feat: 問卷回饋 Excel 匯出（欄位對應與檔名產生邏輯）"
```

---

### Task 8: 頁面外殼——HTML／CSS（問卷回饋頁籤）

**Files:**
- Modify: `site/index.html`
- Modify: `site/style.css`

- [ ] **Step 1: index.html 加入 SheetJS CDN script 標籤**

打開 `site/index.html`，在既有的 Chart.js `<script>` 標籤（第 12-14 行）之後、`</head>`（第 15 行）之前加入：

```html
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
  integrity="sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT"
  crossorigin="anonymous"></script>
```

（這個 integrity hash 已經用 `curl` 下載官方 CDN 檔案、`openssl dgst -sha384` 現算驗證過，是真實有效的值，不是佔位符。）

- [ ] **Step 2: index.html 新增頁籤按鈕**

找到：

```html
    <button class="tab" data-tab="devices">裝置</button>
  </div>
```

改成：

```html
    <button class="tab" data-tab="devices">裝置</button>
    <button class="tab" data-tab="feedback">問卷回饋</button>
  </div>
```

- [ ] **Step 3: index.html 新增頁籤內容**

找到：

```html
  <div class="tab-panel" id="panel-devices">
    <div class="chart-wrap"><canvas id="chart-devices"></canvas></div>
  </div>
</div>
```

改成：

```html
  <div class="tab-panel" id="panel-devices">
    <div class="chart-wrap"><canvas id="chart-devices"></canvas></div>
  </div>

  <div class="tab-panel" id="panel-feedback">
    <p class="section-intro">準增員填完測驗後填寫的回饋表，資料每日同步自 Notion「測驗結果回饋表紀錄」資料庫。</p>
    <div class="kpis" id="feedback-kpi-cards"></div>
    <div class="charts-row">
      <div class="chart-card">
        <h3>受測者意願度（同意比例）</h3>
        <div id="feedback-advocacy"></div>
      </div>
      <div class="chart-card">
        <h3>Q4 最希望改善項目（可複選）</h3>
        <div id="feedback-improvement"></div>
      </div>
    </div>
    <div class="section-heading">
      <h2>逐筆紀錄</h2>
      <span class="count" id="feedback-record-count"></span>
    </div>
    <div class="filters">
      <div class="left">
        <select id="feedback-filter-office"></select>
        <select id="feedback-filter-tool"></select>
        <select id="feedback-filter-recommend">
          <option value="all">推薦：全部</option>
          <option value="yes">僅推薦</option>
          <option value="no">僅未推薦</option>
        </select>
      </div>
      <button class="dl-btn" id="feedback-download-btn">下載 Excel</button>
    </div>
    <div class="records" id="feedback-records"></div>
    <div class="pagination">
      <button id="feedback-page-prev">‹ 上一頁</button>
      <button id="feedback-page-next">下一頁 ›</button>
    </div>
    <div class="notion-cta">
      <div class="txt">需要匯出、篩選更多欄位，或做後續追蹤管理？<b>完整資料庫在 Notion。</b></div>
      <a href="https://app.notion.com/p/7bda2331f51344049378e9be09ad6cc9" target="_blank" rel="noopener">在 Notion 開啟原始資料庫 ↗</a>
    </div>
  </div>
</div>
```

- [ ] **Step 4: style.css 擴充色彩 token**

打開 `site/style.css`，找到第一行：

```css
:root{--navy:#0F2545;--navy-soft:#1E3A6B;--gold:#C8973A;--cream:#F4EFE4;
--paper:#FAF7EF;--line:#D9CFBA;--muted:#6B7280}
```

改成：

```css
:root{--navy:#0F2545;--navy-soft:#1E3A6B;--gold:#C8973A;--cream:#F4EFE4;
--paper:#FAF7EF;--line:#D9CFBA;--muted:#6B7280;
--good:#3F7A4E;--good-bg:#EAF3EC;--warn:#B5622A;--warn-bg:#FBEEE3}
```

- [ ] **Step 5: style.css 新增問卷回饋頁籤樣式**

在 `site/style.css` 檔尾（`.note-box li{margin-bottom:6px}` 之後）加入：

```css
/* 問卷回饋頁籤 */
.section-intro{font-size:13px;color:var(--muted);margin:0 0 20px;max-width:62ch}

.charts-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
@media (max-width:720px){.charts-row{grid-template-columns:1fr}}
.chart-card{background:var(--cream);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
.chart-card h3{font-size:13.5px;margin:0 0 14px;font-weight:700}
.bar-row{display:grid;grid-template-columns:100px 1fr 40px;align-items:center;gap:10px;
  font-size:12.5px;margin-bottom:9px}
.bar-row .label{color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{background:var(--paper);border-radius:5px;height:14px;overflow:hidden;border:1px solid var(--line)}
.bar-fill{height:100%;border-radius:5px 0 0 5px;background:var(--navy-soft)}
.bar-row .val{text-align:right;color:var(--muted);font-size:12px}

.section-heading{display:flex;justify-content:space-between;align-items:center;
  margin:0 0 14px;flex-wrap:wrap;gap:10px}
.section-heading h2{font-size:16px;margin:0}
.section-heading .count{font-size:12.5px;color:var(--muted)}

.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center;
  justify-content:space-between}
.filters .left{display:flex;gap:8px;flex-wrap:wrap}
.filters select{font-family:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);
  border-radius:8px;background:var(--cream);color:var(--navy)}
.dl-btn{font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 14px;
  border:1px solid var(--navy);border-radius:8px;background:var(--navy);color:var(--cream);
  cursor:pointer;white-space:nowrap}
.dl-btn:hover{background:var(--navy-soft)}

.records{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}
.record{background:var(--cream);border:1px solid var(--line);border-radius:10px;padding:14px 18px}
.record-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;cursor:pointer}
.record-who{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.record-who .name{font-weight:700;font-size:14.5px}
.record-who .meta{font-size:12px;color:var(--muted)}
.record-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tag{font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid var(--line);
  color:var(--navy);background:var(--paper)}
.tag.tool{border-color:var(--navy-soft);color:var(--navy-soft)}
.tag.rec-yes{background:var(--good-bg);color:var(--good);border-color:transparent;font-weight:600}
.tag.rec-no{background:var(--warn-bg);color:var(--warn);border-color:transparent;font-weight:600}
.stars{font-size:12.5px;color:var(--gold);letter-spacing:1px}
.stars .dim{color:var(--line)}
.record-scores{display:flex;gap:18px;margin:10px 0 8px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.comment{font-size:13px;color:var(--navy);margin:6px 0 0;line-height:1.6}
.comment .q{color:var(--muted)}
.toggle{font-size:12px;color:var(--navy-soft);cursor:pointer;margin-top:10px;
  display:inline-block;font-weight:600}
.toggle::before{content:"▾ "}
.record.collapsed .detail{display:none}
.record.collapsed .toggle::before{content:"▸ "}
.detail{margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);
  display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:12.5px}
@media (max-width:600px){.detail{grid-template-columns:1fr}}
.detail dt{color:var(--muted);margin-bottom:2px}
.detail dd{margin:0 0 8px;color:var(--navy)}
.detail dd .chip{display:inline-block;background:var(--paper);border:1px solid var(--line);
  border-radius:14px;padding:2px 9px;margin:2px 4px 0 0;font-size:11.5px}

.pagination{display:flex;justify-content:center;gap:12px;margin-bottom:20px}
.pagination button{padding:8px 16px;font-size:13px;border:1px solid var(--line);
  background:var(--paper);color:var(--navy);border-radius:8px;cursor:pointer}
.pagination button:disabled{opacity:.4;cursor:default}

.notion-cta{display:flex;justify-content:space-between;align-items:center;
  gap:12px;flex-wrap:wrap;background:var(--cream);border:1px solid var(--line);
  border-radius:10px;padding:14px 18px}
.notion-cta .txt{font-size:12.5px;color:var(--muted)}
.notion-cta .txt b{color:var(--navy)}
.notion-cta a{font-size:12.5px;font-weight:700;color:#fff;background:var(--navy);
  padding:8px 16px;border-radius:8px;text-decoration:none;white-space:nowrap}
```

- [ ] **Step 6: 手動確認頁面結構（無 JS 邏輯前的靜態檢查）**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && python3 -m http.server 8080
```

用瀏覽器開 `http://localhost:8080`，輸入密碼後（本機沒有正確密碼的話畫面會停在密碼輸入頁，這一步只是確認頁籤按鈕跟頁面骨架有沒有明顯錯位/沒有 HTML 解析錯誤，不需要真的解鎖）。按 Ctrl+C 結束伺服器。

- [ ] **Step 7: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add site/index.html site/style.css && git commit -m "feat: 問卷回饋頁籤 HTML／CSS 外殼"
```

---

### Task 9: 渲染邏輯與互動（`site/dashboard.js`）

**Files:**
- Modify: `site/dashboard.js`

- [ ] **Step 1: 擴充 import 與模組狀態**

打開 `site/dashboard.js`，把：

```js
import { decryptData } from './decrypt.js';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
} from './aggregate.js';
```

改成：

```js
import { decryptData } from './decrypt.js';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
  buildFeedbackKpi, buildAdvocacyDistribution, buildImprovementRanking,
  filterFeedbackRecords, distinctSorted, paginate,
} from './aggregate.js';
import { downloadFeedbackExcel } from './export-excel.js';
```

把：

```js
let ALL_DATA = null; // { days, days_by_unit, days_by_tool, days_by_device, meta }
let charts = {};
let currentRange = null; // [start, end]，供切換頁籤時重繪目前圖表用
let listenersInitialized = false; // 見 unlock() 內說明
```

改成：

```js
let ALL_DATA = null; // { days, days_by_unit, days_by_tool, days_by_device, feedback_records, meta }
let charts = {};
let currentRange = null; // [start, end]，供切換頁籤時重繪目前圖表用
let listenersInitialized = false; // 見 unlock() 內說明
let feedbackFilters = { office: 'all', tool: 'all', recommend: 'all' };
let feedbackPage = 1;
const FEEDBACK_PAGE_SIZE = 10;
```

- [ ] **Step 2: 加入渲染函式**

在 `renderTrend` 函式之後（`renderUnits` 之前）加入：

```js
function currentFeedbackRecords() {
  const [start, end] = currentRange;
  return filterFeedbackRecords(ALL_DATA.feedback_records, { start, end, ...feedbackFilters });
}

function renderFeedbackKpis(kpi) {
  const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const avg = (v) => (v === null ? '—' : v.toFixed(1));
  const cards = [
    [kpi.count, '回收問卷數'],
    [avg(kpi.avg_overall), '平均整體體驗星等'],
    [avg(kpi.avg_process), '平均流程體驗星等'],
    [pct(kpi.recommend_rate), '推薦率'],
  ];
  document.getElementById('feedback-kpi-cards').innerHTML = cards
    .map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');
}

function renderBarRows(containerId, rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  document.getElementById(containerId).innerHTML = rows.map((r) => `
    <div class="bar-row">
      <span class="label">${r.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max * 100).toFixed(0)}%"></div></div>
      <span class="val">${r.display}</span>
    </div>
  `).join('');
}

function renderAdvocacy(distribution) {
  const rows = distribution.map((d) => ({
    label: d.label.replace(/^Q\d /, ''),
    value: d.agree_rate === null ? 0 : d.agree_rate * 100,
    display: d.agree_rate === null ? '—' : `${(d.agree_rate * 100).toFixed(0)}%`,
  }));
  renderBarRows('feedback-advocacy', rows);
}

function renderImprovementRanking(ranking) {
  const rows = ranking.map((r) => ({ label: r.label, value: r.count, display: String(r.count) }));
  renderBarRows('feedback-improvement', rows);
}

function renderFeedbackFilterOptions() {
  const offices = distinctSorted(ALL_DATA.feedback_records, 'mgr_office');
  const tools = distinctSorted(ALL_DATA.feedback_records, 'tool_title');
  const officeSelect = document.getElementById('feedback-filter-office');
  const toolSelect = document.getElementById('feedback-filter-tool');
  officeSelect.innerHTML = ['<option value="all">單位：全部</option>']
    .concat(offices.map((o) => `<option value="${o}">${o}</option>`)).join('');
  toolSelect.innerHTML = ['<option value="all">工具：全部</option>']
    .concat(tools.map((t) => `<option value="${t}">${t}</option>`)).join('');
  officeSelect.value = feedbackFilters.office;
  toolSelect.value = feedbackFilters.tool;
  document.getElementById('feedback-filter-recommend').value = feedbackFilters.recommend;
}

function starsHtml(score) {
  const full = Math.max(0, Math.min(5, Math.round(score || 0)));
  return `${'★'.repeat(full)}<span class="dim">${'★'.repeat(5 - full)}</span>`;
}

function chipsHtml(values) {
  return values.length ? values.map((v) => `<span class="chip">${v}</span>`).join('') : '（未填）';
}

function recordCardHtml(r) {
  return `
    <div class="record collapsed" data-id="${r.id}">
      <div class="record-top">
        <div class="record-who">
          <span class="name">${r.cand_name}</span>
          <span class="meta">${r.cand_age}歲・${r.cand_occupation}・${r.mgr_region}・${r.mgr_office}（${r.mgr_name} 主管）</span>
        </div>
        <div class="record-tags">
          <span class="tag tool">${r.tool_title}</span>
          <span class="tag ${r.cand_recommend ? 'rec-yes' : 'rec-no'}">${r.cand_recommend ? '推薦' : '未推薦'}</span>
        </div>
      </div>
      <div class="record-scores">
        <span>整體體驗 <span class="stars">${starsHtml(r.cand_overall)}</span></span>
        <span>流程體驗 <span class="stars">${starsHtml(r.cand_process)}</span></span>
        <span>${r.submitted_at.slice(0, 10)} 提交</span>
      </div>
      <p class="comment"><span class="q">留言：</span>${r.cand_comment || '（未填）'}</p>
      <span class="toggle">查看完整問卷</span>
      <div class="detail">
        <div><dt>Q1 更了解工作現況</dt><dd>${r.adv_q1 || '（未填）'}</dd></div>
        <div><dt>Q2 開始思考轉變</dt><dd>${r.adv_q2 || '（未填）'}</dd></div>
        <div><dt>Q3 願意了解機會</dt><dd>${r.adv_q3 || '（未填）'}</dd></div>
        <div><dt>Q4 最希望改善項目</dt><dd>${chipsHtml(r.adv_q4)}</dd></div>
        <div><dt>Q5 希望提供資訊</dt><dd>${chipsHtml(r.adv_q5)}</dd></div>
      </div>
    </div>
  `;
}

function renderFeedbackRecords() {
  const filtered = currentFeedbackRecords();
  const { items, page, totalPages, totalCount } = paginate(filtered, feedbackPage, FEEDBACK_PAGE_SIZE);
  feedbackPage = page;
  document.getElementById('feedback-record-count').textContent = `共 ${totalCount} 筆，第 ${page}／${totalPages} 頁`;
  document.getElementById('feedback-records').innerHTML = items.map(recordCardHtml).join('');
  document.getElementById('feedback-download-btn').textContent = `下載 Excel（${totalCount} 筆）`;
  document.getElementById('feedback-page-prev').disabled = page <= 1;
  document.getElementById('feedback-page-next').disabled = page >= totalPages;
}

function renderFeedback() {
  const records = currentFeedbackRecords();
  renderFeedbackKpis(buildFeedbackKpi(records));
  renderAdvocacy(buildAdvocacyDistribution(records));
  renderImprovementRanking(buildImprovementRanking(records));
  renderFeedbackFilterOptions();
  renderFeedbackRecords();
}
```

- [ ] **Step 3: 把 renderFeedback() 掛進 renderAll()**

找到 `renderAll` 函式裡的：

```js
  renderTools(buildTools(toolDays));
  renderDevices(buildDevices(deviceDays));
```

改成：

```js
  renderTools(buildTools(toolDays));
  renderDevices(buildDevices(deviceDays));
  renderFeedback();
```

- [ ] **Step 4: 加入互動邏輯（篩選、分頁、展開收合、下載）**

在 `setupDateFilter` 函式之後加入：

```js
function setupFeedbackControls() {
  ['feedback-filter-office', 'feedback-filter-tool', 'feedback-filter-recommend'].forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const key = { 'feedback-filter-office': 'office', 'feedback-filter-tool': 'tool',
        'feedback-filter-recommend': 'recommend' }[id];
      feedbackFilters[key] = e.target.value;
      feedbackPage = 1;
      renderFeedback();
    });
  });

  document.getElementById('feedback-page-prev').addEventListener('click', () => {
    feedbackPage -= 1;
    renderFeedbackRecords();
  });
  document.getElementById('feedback-page-next').addEventListener('click', () => {
    feedbackPage += 1;
    renderFeedbackRecords();
  });

  // 事件代理：卡片會隨篩選/換頁整批重建，直接綁在容器上，
  // 不用每次重新渲染後逐一重新掛監聽器。
  document.getElementById('feedback-records').addEventListener('click', (e) => {
    const card = e.target.closest('.record');
    if (!card) return;
    if (e.target.closest('.record-top') || e.target.closest('.toggle')) {
      card.classList.toggle('collapsed');
    }
  });

  document.getElementById('feedback-download-btn').addEventListener('click', () => {
    downloadFeedbackExcel(currentFeedbackRecords(), feedbackFilters, currentRange);
  });
}
```

- [ ] **Step 5: 在 unlock() 的一次性初始化區塊掛上新的監聽器**

找到 `unlock` 函式裡的：

```js
    if (!listenersInitialized) {
      setupTabs();
      setupDateFilter();
      listenersInitialized = true;
    }
```

改成：

```js
    if (!listenersInitialized) {
      setupTabs();
      setupDateFilter();
      setupFeedbackControls();
      listenersInitialized = true;
    }
```

- [ ] **Step 6: 手動端對端驗證**

本機沒有正式的 `DASHBOARD_PASSWORD` 與真實 `data.enc.json` 內容時，可以用 Task 4 Step 2 產生過的測試用加密檔驗證流程能跑通（不需要看到正確資料，只需要確認沒有 JS 錯誤、頁籤切換、篩選、展開/收合、分頁按鈕、下載按鈕都有反應）：

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts"
mkdir -p .cache
echo '{"days": [{"date": "2026-08-01", "sessions": 1, "active_users": 1, "tool_open": 1, "result_view": 1, "result_generate_image": 0, "result_download": 0, "result_share": 0, "hub_view": 1, "feedback_opened": 0, "feedback_page2": 0, "feedback_submitted": 0, "feedback_pdf": 0}], "days_by_unit": [], "days_by_tool": [], "days_by_device": [], "meta": {"rollout_start": "2026-08-01", "last_day": "2026-08-01"}, "notes": []}' > .cache/daily_raw.json
echo '{"feedback_records": [{"id": "t1", "submitted_at": "2026-08-01T00:00:00.000+08:00", "tool_title": "DISC", "mgr_name": "測試主管", "mgr_region": "北一", "mgr_office": "測試單位", "cand_name": "測試員", "cand_gender": "女", "cand_age": 30, "cand_occupation": "測試", "cand_overall": 5, "cand_process": 4, "cand_recommend": true, "cand_comment": "測試留言", "adv_q1": "同意", "adv_q2": "同意", "adv_q3": null, "adv_q4": ["介面速度"], "adv_q4_other": "", "adv_q5": ["薪資制度"]}]}' > .cache/notion_raw.json
DASHBOARD_PASSWORD=test123 python encrypt_build.py
cd ../site && python3 -m http.server 8080
```

瀏覽器開 `http://localhost:8080`，密碼輸入 `test123`，切到「問卷回饋」頁籤，確認：KPI 卡有數字、兩個橫條圖有畫出來、篩選器選單有選項、卡片點擊可展開收合、下載 Excel 按鈕點擊後瀏覽器有觸發下載一個 `.xlsx` 檔案並可正常用 Excel/Numbers 打開。驗證完後執行 `cd .. && git checkout site/data.enc.json` 還原，並可刪除 `scripts/.cache/*` 測試檔（該路徑已 gitignore，不影響 commit）。

- [ ] **Step 7: Commit**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git add site/dashboard.js && git commit -m "feat: 問卷回饋頁籤渲染與互動邏輯（篩選／分頁／展開收合／Excel 下載）"
```

---

### Task 10: 全套測試與最終檢查

**Files:** 無新增/修改，純驗證

- [ ] **Step 1: 執行全部 Python 測試**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/scripts" && python -m pytest tests/ -v
```

預期：全部 PASS（含既有的 GA4 相關測試與本次新增的 Notion 相關測試）

- [ ] **Step 2: 執行全部前端測試**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard/site" && node --test
```

預期：全部 PASS

- [ ] **Step 3: 確認沒有把測試用假資料誤留在會被 commit 的檔案裡**

```bash
cd "/Users/frank/Desktop/claude code/onetouch-dashboard" && git status
```

預期：`site/data.enc.json` 沒有被標記為已修改（若有，執行 `git checkout site/data.enc.json` 還原成真實排程產出的版本）；`scripts/.cache/` 底下的測試檔不會出現在 `git status`（已 gitignore）。

- [ ] **Step 4: 確認 GitHub Secrets 就緒（見 Task 5 Step 2），手動觸發一次 workflow_dispatch**

前往 `https://github.com/Frank333tw/onetouch-dashboard/actions/workflows/build-deploy.yml` → 「Run workflow」手動觸發一次，觀察執行紀錄：「抓取問卷回饋資料」step 是否成功、「加密建置」step 是否成功、最終是否部署成功。

- [ ] **Step 5: 正式環境驗證**

部署完成後開啟正式網址，密碼解鎖，切到「問卷回饋」頁籤，跟 Notion 資料庫人工核對幾筆資料（姓名、星等、留言）是否一致，確認 Excel 下載功能可用。

---

## 驗收條件對照（回頭比對 spec）

- [x] Task 1-5：Notion 資料每日自動同步進加密資料檔 → spec「整體架構」「Notion API 串接細節」
- [x] Task 6：彙整統計（KPI／Q1-Q3 意願度／Q4 排行）→ spec「彙整統計計算邏輯」
- [x] Task 8-9：逐筆列表、篩選、卡片收合展開、分頁 → spec「個別紀錄 UI」
- [x] Task 7、9：Excel 下載套用目前篩選、全欄位、檔名反映篩選狀態 → spec「Excel 下載」
- [x] Task 8：Notion 原始連結留在頁尾 → spec「Notion 連結」
- [x] Task 4：Notion 快取缺失時 fail-closed，不產出半套資料 → spec「驗收條件」最後一條（實作方式比 spec 原文更簡單，見 Task 4 Step 1 說明，已在對話中跟 Frank 說明這個簡化）
