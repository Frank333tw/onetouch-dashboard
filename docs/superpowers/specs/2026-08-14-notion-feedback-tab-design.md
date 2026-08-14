# 問卷回饋頁籤（Notion 串接）— 設計規格

建立日期：2026-08-14
狀態：設計已與 Frank 確認（brainstorming 階段完成，含畫面模擬），待寫實作計畫

## 背景與目的

`recruitment-web` 的「測驗結果回饋表」（準增員完成測驗後填的兩頁式回饋問卷）已經串接 Notion——問卷送出後透過 Netlify Function 同步寫進 Notion「測驗結果回饋表紀錄」資料庫（詳見 `recruitment-web/SPEC/feedback-export/04_Notion資料庫串接_設計規格.md`）。目前要查看這些問卷內容，唯一管道是登入該 Notion 工作區。

Frank 想在 `onetouch-dashboard`（既有的 GA4 推廣成效儀表板，密碼保護、部署於 GitHub Pages）直接看到這些問卷結果，原因：儀表板現在只看得到回饋問卷的**漏斗計數**（打開/第二頁/送出/下載 PDF，來自 GA4 事件），看不到問卷**內容**（星等、留言、Q1-Q5 逐題填答）；而儀表板會分享給其他主管/同仁，這些人沒有 Notion 工作區權限，光靠連去 Notion 無法讓他們看到內容。

## 已確認的需求（2026-08-13～14 逐項與 Frank 確認，含畫面模擬審閱）

| 項目 | 決定 |
|---|---|
| 想看的內容 | 彙整統計（平均星等、推薦率、Q1-Q3 意願度分布、Q4 改善項目排行）**與**逐筆個別紀錄，兩者都要 |
| 儀表板使用對象 | 除 Frank 本人外，會分享給其他主管/同仁（密碼登入） |
| 個資欄位處理 | 全部照顯示（受測者姓名/年齡/職業、主管姓名/單位皆不做匿名化）——內部工具、同一批人本來就看得到彼此資訊 |
| 實作方式 | 比照現有 GA4 管線：GitHub Actions 每日排程新增一支腳本抓 Notion API，併入同一份加密資料 |
| 呈現位置 | 儀表板新增第 6 個頁籤「問卷回饋」 |
| 逐筆列表 | 卡片預設收合（顯示姓名/工具/星等/推薦/留言摘要），點開才展開 Q1-Q5 完整填答；列表做分頁 |
| Excel 下載 | 需要，下載目前畫面篩選後的清單，全欄位 |
| Notion 原始連結 | 保留在頁尾，作為 Frank 自己要匯出/篩選更多欄位或做後續追蹤管理時的備用入口，不是給所有使用者看內容的主要管道 |

畫面模擬（已與 Frank 確認）：<https://claude.ai/code/artifact/94972fc5-52f5-485c-958f-b64b19b2c091>

## 範圍外（本次不做）

- 不做匿名化／欄位遮蔽——所有欄位對所有登入者一致顯示
- 不做「追蹤管理」欄位（聯絡狀態、負責人等）——這點沿用 Notion 串接規格原本的排除範圍，儀表板只讀不寫
- 不做增量抓取（見下方「為什麼每次整段重新抓」）
- 不做即時/現場查詢——維持現有「每日排程預先抓好，前端只做篩選」的架構，不現場呼叫 Notion API

## 整體架構

```
GitHub Actions（既有每日排程，UTC 00:00）
  → scripts/fetch_daily.py：GA4 資料（既有，不動）
  → scripts/fetch_notion.py：（新增）呼叫 Notion API，抓「測驗結果回饋表紀錄」資料庫全部列
  → scripts/transform_notion.py：（新增）Notion API 回傳的 page 物件 → 扁平化紀錄陣列
  → scripts/encrypt_build.py：（既有腳本擴充）把 GA 資料與 feedback_records 一起塞進同一份 data.enc.json 加密輸出
  → git commit 加密後的 data.enc.json（版本歷史 = 永久存檔，沿用既有安全模型）
  → actions/deploy-pages 部署
```

沿用既有 repo 的核心安全原則（見 `2026-07-28-onetouch-dashboard-design.md`「一個關鍵的安全性考量」）：repo 公開，任何時候只 commit 加密後的密文，不出現明文個資。問卷紀錄的個資敏感度比 GA 匯總數字更高（含真實姓名），這條規則對這批資料**更加**重要，沒有放寬空間。

### Notion API 串接細節

- 沿用 `recruitment-web` 已建立的 Notion Integration（「OneTouch回饋同步」，internal integration，已有 Read content 權限）——同一顆 token 可以讀，不需要新建 integration，但**這是一個新的存取來源，需要 Frank 手動去 Notion「測驗結果回饋表紀錄」資料庫的 Connections 確認／新增這個 integration 的存取權**（如果目前只有 write 用途授權過，讀取需要同一顆 token 但仍建議在 Notion 畫面上確認一次）。
- 呼叫 `POST https://api.notion.com/v1/databases/{database_id}/query`，`database_id` 沿用既有值 `7bda2331f51344049378e9be09ad6cc9`（見 `reference_onetouch_notion_asp_b_team` 記憶，2026-07-21 上線時已驗證過這是資料庫本身的 ID，不是 data source ID，這裡不會重蹈覆轍）。
- Notion API 單次查詢最多回傳 100 筆，需用回傳的 `has_more` / `next_cursor` 做分頁迴圈，直到抓完全部列。
- **新增 GitHub Actions Secrets**：`NOTION_TOKEN`、`NOTION_DATABASE_ID`（Frank 手動在 repo Settings → Secrets and variables → Actions 新增，Claude 無法代勞）。

### 為什麼每次整段重新抓，不做增量抓取

沿用既有 GA4 管線的同一個判斷：這批資料量小（內部工具的回饋問卷，量體遠低於百筆量級的 GA4 每日數字），增量抓取需要額外追蹤「上次抓到哪一筆」的狀態，一旦漏抓或中斷就會產生對不上的資料。整段重新抓取、整份覆蓋，是簡單、無狀態、冪等的做法，這批資料量下 API 成本可忽略。

## 資料模型

`fetch_notion.py` 產出、`transform_notion.py` 扁平化後的結構：

```json
{
  "feedback_records": [
    {
      "id": "notion-page-id",
      "submitted_at": "2026-08-12T09:00:00.000Z",
      "tool_title": "行為模式DISC",
      "mgr_name": "陳建宏", "mgr_region": "北二", "mgr_office": "信義通訊處",
      "cand_name": "王曉萱", "cand_gender": "女", "cand_age": 28, "cand_occupation": "門市人員",
      "cand_overall": 5, "cand_process": 4, "cand_recommend": true,
      "cand_comment": "解說很清楚，希望能有更多職業對照的例子。",
      "adv_q1": "非常同意", "adv_q2": "同意", "adv_q3": "同意",
      "adv_q4": ["結果解讀說明", "介面速度"], "adv_q4_other": "",
      "adv_q5": ["薪資制度", "教育訓練"]
    }
  ]
}
```

欄位直接對應 Notion 資料庫的既有 19 個欄位（詳見 `04_Notion資料庫串接_設計規格.md` 的欄位表），不重新設計欄位。`feedback_records` 併入 `data.enc.json` 頂層，跟既有的 `days` / `days_by_unit` / `days_by_tool` / `days_by_device` 同層。

### 待確認事項：Q1-Q3 的 select 選項實際值

`adv_q1`–`adv_q3` 是 Notion `select` 型態，原始 Notion 串接規格未列出精確的選項文字（只知道是選填、單選）。彙整統計要算「意願度同意比例」，需要先讀取 Notion 資料庫欄位設定裡的實際選項列表（例如是否為「非常同意／同意／普通／不同意／非常不同意」五分量表），才能定義「算作同意」的分界，不能用假設值硬編。**這是實作前必須先查證的一步**，寫進實作計畫的第一個任務。

## 彙整統計計算邏輯

前端（比照既有 `aggregate.js` 的「後端存原始每日資料、前端依日期區間即時加總」原則）：

- **KPI 卡**：回收問卷數（`feedback_records.length`，套用日期區間篩選）、平均整體體驗星等（`cand_overall` 平均）、平均流程體驗星等（`cand_process` 平均）、推薦率（`cand_recommend` 為真的比例）
- **Q1-Q3 意願度圖**：各題「同意類」選項占比（分界依「待確認事項」查證結果）
- **Q4 改善項目排行**：`adv_q4` 多選值攤平後計數排序，取前 N 名

所有比率沿用既有計算原則：分母為零時回 `null`（顯示 `—`），不是 0。

## 個別紀錄 UI

- **篩選器**：單位、工具、推薦與否；日期區間沿用頁面既有的全域日期篩選（不另建第二套）
- **卡片**：預設收合，顯示姓名／年齡／職業／單位／主管、工具徽章、推薦徽章、整體與流程星等、提交日期、留言摘要；點擊展開顯示 Q1-Q5 完整填答
- **分頁**：列表隨時間持續累積，做分頁（每頁筆數與分頁 UI 細節留給實作計畫決定，抓現有 `.kpi`／`.chart-card` 一致的視覺語言）
- 視覺樣式沿用儀表板既有 CSS 變數（`--navy` / `--navy-soft` / `--gold` / `--cream` / `--paper` / `--line` / `--muted`）與既有元件 class（`.kpi`、`.tab`、`.tab-panel`），不引入新的視覺系統

## Excel 下載

- **純前端產生，不經後端**：資料在瀏覽器解密後已在記憶體中，篩選也是前端算的，下載只是把「目前畫面篩選後（單位／工具／推薦／日期區間全部套用）的那份清單」序列化成 `.xlsx`
- **技術選擇**：透過 CDN script 標籤載入 SheetJS（`xlsx.js`），比照現有 Chart.js 的載入手法，不引入建置流程
- **欄位**：全欄位，對應 Notion 資料庫的 19 個欄位
- **檔名**：反映目前篩選與日期區間，例如 `問卷回饋_北一_2026-07-01至2026-08-14.xlsx`；若無單位篩選則用「全部」

## Notion 連結

頁尾保留一個「在 Notion 開啟原始資料庫」連結，供 Frank 自己需要匯出、篩選更多欄位、或做後續追蹤管理時使用。**這個連結對沒有 Notion 工作區權限的其他使用者是無效的**，不是這個功能對他們的主要呈現管道——他們的完整需求由頁籤本身的彙整圖表＋逐筆列表滿足。

## 測試計畫

沿用既有 repo 的 TDD 慣例（Python `pytest` + 前端 `node --test`）：

- `scripts/tests/test_fetch_notion.py`：mock Notion API 回應，驗證分頁邏輯（`has_more`/`next_cursor`）正確抓完多頁
- `scripts/tests/test_transform_notion.py`：驗證 Notion page 物件正確扁平化成 `feedback_records`；`adv_q4`/`adv_q5` 的 multi_select 陣列正確轉換；未填欄位正確處理為空值不報錯
- `site/tests/`：新增彙整統計函式（KPI／Q1-Q3 分布／Q4 排行）的零分母、空資料邊界測試；Excel 下載函式的欄位對應與檔名產生邏輯測試

## 驗收條件

- 儀表板新增「問卷回饋」頁籤，密碼解鎖後可見，資料每日隨既有排程自動更新
- 彙整統計數字與 Notion 資料庫人工核對一致
- 逐筆列表可依單位／工具／推薦篩選，卡片預設收合、展開後 Q1-Q5 完整
- 列表有分頁，量體成長後畫面不會一次全部渲染
- 下載 Excel 得到的筆數與欄位，跟畫面目前篩選狀態一致；檔名反映篩選條件
- Notion API 抓取失敗時（例如排程當次 API 逾時），不會讓網站掛掉或顯示半套/損毀的資料——**寫實作計畫時簡化為跟 GA4 快取同一套 fail-closed 規則**：Notion 快取跟 GA4 快取任一份缺失，整次建置直接中止、不產出新的 `data.enc.json`，網站繼續顯示「上一次成功」部署的完整資料（GA4 與問卷回饋一起停留在同一個舊版本，不做「GA4 更新但問卷回饋沿用舊資料」的局部復原）。比原本設想的「兩者互相獨立、各自失敗互不影響」更簡單，代價是 Notion 單獨出問題那天 GA4 資料也會跟著沒更新——內部工具、排程一天一次，這個代價可接受，見 `docs/superpowers/plans/2026-08-14-notion-feedback-tab-plan.md` Task 4
