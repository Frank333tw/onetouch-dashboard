# OneTouch GA 互動儀表板 — 設計規格

建立日期：2026-07-28
狀態：設計已與 Frank 確認，待寫實作計畫

## 背景

`recruitment-web` 專案裡已經有一支能運作的 GA4 月報腳本（`reports/ga/`，分支 `ga-monthly-report`），產出靜態 HTML 月報。Frank 使用後希望進一步做成：

- 圖表視覺化（非純表格），滑鼠移到圖表上顯示詳細數字
- 一個**持續累積**的儀表板，而非每月各自獨立一份報表
- 使用者可自訂日期區間查看
- 部署在 Zeabur（後續討論改為 GitHub Pages，見下方「部署平台」）
- **跟 `recruitment-web` 的 git 分開，不要混在一起**

這是全新專案，不是月報腳本的擴充——資料粒度、技術棧、部署方式都不同，因此獨立開一個 repo：`onetouch-dashboard`。

原本的月報腳本（`recruitment-web/reports/ga/`）維持不動，continued 用於 Frank 每月自己看的進度快照；本專案是給「隨時查看、可篩選區間」的常駐儀表板，兩者並存、互不取代。

## 已確認的需求（2026-07-27～28 逐項與 Frank 確認）

| 項目 | 決定 |
|---|---|
| 資料來源方式 | 預先撈好（GitHub Actions 排程執行），前端做日期篩選，不現場即時查 GA4 |
| 存取保護 | 密碼保護，真加密（非前端擋畫面），密碼由 Frank 提供 |
| 更新機制 | 定期自動重建（GitHub Actions 排程，免費），不要花錢 |
| 部署平台 | **GitHub Pages**（repo 公開） |
| 頁籤結構 | 五頁籤，依主題分組（總覽／單位／轉換路徑／工具／裝置） |
| PDF 匯出 | 不需要 |
| Repo | 獨立於 `recruitment-web`，全新 repo |

### 部署平台的決策過程

一開始討論的是 Zeabur（沿用 AM 說明簡報等既有靜態頁的部署方式），但有個未解的風險：Zeabur CLI 在 GitHub Actions 這種非互動環境（non-TTY）能不能免登入部署，沒有把握——`recruitment-web` 的維護記錄裡就記載過「Zeabur CLI 互動式登入指令在非 TTY 環境會卡死」的踩坑經驗。

改用 **GitHub Pages**：GitHub Actions 官方維護的部署動作（`actions/deploy-pages`），沒有登入卡住的風險，規則透明。**代價是 repo 必須公開**（GitHub Pages 免費方案只支援公開 repo，私有 repo 要用需升級付費方案）。Frank 確認可接受。

### 費用確認

Frank 已登入 Zeabur 帳號確認現有兩個靜態網站（AM 說明簡報、主管進度報告）用量皆為 $0；GitHub Actions 排程免費額度（公開 repo 無限制、私有 repo 每月 2,000 分鐘）遠超過本專案單次執行所需的時間。改走 GitHub Pages 後，整條流程完全在 GitHub 一個平台上，費用與計費規則都是公開透明的，不再需要像 Zeabur 那樣仰賴不確定的計費細節。

## 一個關鍵的安全性考量：公開 repo 與資料保護的衝突

`recruitment-web` 的月報腳本把 `data.json`（未加密的原始數字）直接 commit 進 repo 當「永久存檔」。**這個做法不能原樣搬過來**：這個新 repo 是公開的，如果把未加密的原始數字也 commit 進去存底，等於用另一個管道把密碼保護的數據外洩出去，密碼保護整個失去意義。

**解法：repo 裡任何時候都只會出現加密後的密文，不會出現明文數字**，包括扮演「歷史存檔」角色的那份也一樣。存檔方式：每次重新產生資料都整份覆蓋同一個加密檔案（`data.enc.json`）並 commit——**git 的版本歷史本身就是存檔**，需要回頭看某個時間點的數字，用 `git show <commit>:data.enc.json` 挖出當時的密文，一樣需要密碼才能解開，不會因為想「調閱歷史」而繞過保護。

## 架構

```
GitHub Actions（cron 排程 ＋ 手動觸發 workflow_dispatch）
  → 執行 scripts/fetch_daily.py：從 GA4 Data API 抓「每日粒度」資料
  → 執行 scripts/encrypt_build.py：用密碼加密資料、產出網站檔案
  → git commit 加密後的 data.enc.json（版本歷史 = 永久存檔）
  → actions/deploy-pages 部署到 GitHub Pages（固定網址，不隨每次重建改變）
```

**排程頻率：每日一次，UTC 00:00（台灣時間早上 8:00）。** 選這個時間點是因為此時 GA4「昨天」的資料已經穩定不再變動（見下方「為什麼抓到昨天」）。加上 `workflow_dispatch` 手動觸發，需要時 Frank 或 Claude 都能隨時立即重建，不用等到隔天排程。

### 為什麼资料粒度要改成「每日」而不是沿用月報的「整月一個數字」

使用者要能自訂任意日期區間查看，數學上只有一種做法能支援：**儲存「每一天」的數字，區間由前端加總**。這代表 GA4 查詢邏輯要重寫——每個查詢都要多加 `date` 維度分組，不是把現有月報腳本包一層而已。因此 `fetch_daily.py` 是獨立重寫的一份，跟 `recruitment-web/reports/ga/` 的月報腳本互不共用程式碼（可以參考其查詢邏輯與已知的踩坑知識，但檔案是分開的）。

### 為什麼每次都整段重新抓，不做增量抓取

理論上可以只抓「上次抓取之後新增的天數」再累加進舊資料，但這樣需要額外追蹤「上次抓到哪一天」的狀態，一旦漏抓一天或程式中斷過就容易產生對不上的資料。以這個資料量（一年份的每日數字，每次查詢頂多幾百列），整段重新抓取的 API 成本可忽略不計。**選擇簡單、無狀態、冪等的做法**：每次執行都是從 `ROLLOUT_START`（2026-07-01）抓到「昨天」，整份覆蓋，不依賴上次執行的結果。

### 為什麼抓到「昨天」而不是「今天」

GA4 當天的資料尚未走完完整的處理週期，「今天」這一天的數字會隨著時間推移持續變動，不是穩定值。只抓到「昨天」確保每個日期一旦出現在資料裡就不會再改變。

## 資料模型

`fetch_daily.py` 對每個既有的查詢維度加上 `date`，產出的中繼資料形如：

```json
{
  "days": [
    {"date": "2026-07-01", "sessions": 12, "tool_open": 5, "result_view": 2, ...},
    {"date": "2026-07-02", "sessions": 8, "tool_open": 3, "result_view": 1, ...}
  ],
  "days_by_unit": [
    {"date": "2026-07-01", "source": "taian", "tool_open": 2, "result_view": 1},
    ...
  ],
  "days_by_tool": [...],
  "days_by_device": [...],
  "meta": {"generated_at": "...", "rollout_start": "2026-07-01", "last_day": "2026-07-27"}
}
```

**分工說明**：`transform_daily.py`（後端，Python）只負責把 GA4 API 回傳的原始 rows 整理成「每一天一筆」的結構化紀錄（`days`/`days_by_unit`/`days_by_tool`/`days_by_device`），不做任何跨日加總或衍生指標計算。真正的「依使用者選的區間加總、算完成率、排行榜排序」發生在瀏覽器端的 `dashboard.js`——使用者切換日期區間時，直接把該區間內的每日紀錄加總後重新算一次，跟 `recruitment-web` 月報腳本裡 `transform.py` 的計算邏輯相同（完成率無分母時回 `None`、`result_feedback_submitted` 不可與 `feedback_submitted` 混用等既有原則全部沿用），只是從「後端 Python 對整月資料算一次」變成「前端 JS 對使用者選的任意區間即時算」。

## 加密與密碼保護

**建置時**（GitHub Actions 內，`encrypt_build.py`）：
1. 讀取 `DASHBOARD_PASSWORD` GitHub Secret
2. 產生隨機 salt，用密碼＋salt 透過 PBKDF2 做金鑰延展，導出 AES-GCM 金鑰
3. 產生隨機 IV，用該金鑰加密整份資料 JSON
4. 把 `{salt, iv, ciphertext}`（皆 base64 編碼）內嵌進 `data.enc.json`

**使用者端**（`dashboard.js`，瀏覽器內建 Web Crypto API）：
1. 顯示密碼輸入畫面
2. 讀取 `data.enc.json` 裡的 `salt`，用使用者輸入的密碼透過同樣的 PBKDF2 參數導出金鑰
3. 用該金鑰嘗試解密 `ciphertext`
4. AES-GCM 內建驗證機制：密碼錯誤時解密會直接失敗（不會得到亂碼結果，而是明確的錯誤），畫面顯示「密碼錯誤」
5. 解密成功後才解析 JSON、渲染儀表板

**密碼本身不會出現在 repo 裡**，只存在 GitHub Secrets，建置時才被讀取使用。

### 誠實的安全性但書

Frank 選用的密碼是 8 位數字，空間為 1 億種組合。這對「擋掉搜尋引擎索引、路人瞎逛」足夠，但對「離線暴力破解」不算強——就算加了金鑰延展拖慢嘗試速度，1 億種組合仍在一般運算資源可行的破解範圍內。以本資料的敏感度（內部使用量統計，非客戶個資）來說風險可接受，Frank 已確認維持此密碼（2026-07-28）。**沒有登入失敗次數限制或鎖定機制**——這是靜態網站＋前端解密架構的必然限制，解密過程完全在瀏覽器本機發生，沒有伺服器可以做速率限制。

## 圖表函式庫

**Chart.js**（CDN 引入，比照 `recruitment-web` 現有 React/Babel 的做法釘版本＋SRI 雜湊）。

考慮過的替代方案：
- **D3.js**：彈性最大但過於底層，連 tooltip 都要自己刻，對標準的長條圖／折線圖／圓餅圖需求是過度工程
- **手刻 SVG/Canvas**：無額外相依，但 Frank 明確要「互動細節」（hover 顯示數字），手刻的維護成本與潛在 bug 風險（本專案過去在 html2canvas 上就踩過好幾次視覺渲染的坑）不划算

Chart.js 內建 hover tooltip、圖例、動畫，五個頁籤全部圖表類型都能用同一套函式庫覆蓋：總覽用 KPI 卡片＋折線圖、單位比較用長條圖、轉換路徑用遞減長條模擬漏斗形狀（Chart.js 無原生漏斗圖，遞減長條是常見替代做法）、工具排行用長條圖、裝置用圓餅圖。

**這個網站需要連外部 CDN**——跟月報 HTML「完全離線可開」的設計不同，這裡是刻意的取捨：這是一個活的網站，本來就需要連網才能開啟，不是要傳給人下載到本機的檔案。

## 前端技術

**純 Vanilla JS，不用 React。** 這個網站規模比整套面談工具 SPA 小很多——五個頁籤、幾種圖表、一個日期篩選器，不需要 React 那套元件／狀態管理的重量級解法，維持精簡（YAGNI）。

## 頁籤結構（brainstorming 視覺化確認，方案 B）

| 頁籤 | 內容 |
|---|---|
| 總覽 | KPI 卡片（使用人次／開啟工具／完成測驗／完成率／問卷回收）＋ 時間趨勢折線圖 |
| 單位 | 四單位＋其他來源比較長條圖，含既有的歸因限制註記與長青／益盛暫緩註記 |
| 轉換路徑 | 使用漏斗（Hub→開啟→結果→產圖→下載分享）＋ 回饋問卷漏斗，兩者合併呈現因為都是「使用者在哪裡流失」 |
| 工具 | 五工具（含已下架的圓夢起點標註）受歡迎度排行 |
| 裝置 | 桌機／手機／平板佔比 |

考慮過的替代方案：六頁籤（一區塊一頁，太瑣碎，看不出漏斗流失是否集中在特定單位這類跨區塊關聯）、三頁籤（單位與工具擠在同一頁太擁擠）。

## 日期區間篩選

預設按鈕（本週／本月／近三個月／累積至今）＋ 自訂起訖日期輸入。切換時前端直接用已下載的每日資料重新篩選、加總、重繪圖表，**不會再打任何網路請求**（資料在頁面載入解密時就已經全部在瀏覽器記憶體裡）。

## 異常處理（沿用月報腳本已驗證的原則）

- **「查不到」與「真的是 0」必須長得不一樣**：長青、益盛數字為零時顯示既有的暫緩註記，不會被誤讀成效果不佳
- **單位比較的歸因限制註記**：直接進入或書籤進入的流量會歸到「其他來源」，沿用月報腳本已寫好的文字
- **建置失敗時不 commit、不部署**：`fetch_daily.py` 或 `encrypt_build.py` 任一步驟失敗，GitHub Actions job 直接失敗結束，**不會**用不完整的資料覆蓋掉 `data.enc.json`——網站會繼續顯示上一次成功建置的版本，不會出現半殘資料

## GA4 憑證：沿用既有設定，不必重新走 OAuth

本專案讀的是同一個 GA4 property（`538937948`），沿用 `recruitment-web` 專案已經設定好的 OAuth 用戶端（`~/.config/onetouch-ga/client_secret.json`、`token.json`）——直接把這兩份檔案的內容存成新 repo 的 GitHub Secrets（例如 `GA_CLIENT_SECRET_JSON`、`GA_TOKEN_JSON`），**不需要重新走一次 Google Cloud 設定或 OAuth 授權流程**。

## Repo 結構

```
onetouch-dashboard/
├── .github/workflows/build-deploy.yml   ← cron 排程 + workflow_dispatch，三步驟：抓取→加密→部署
├── scripts/
│   ├── fetch_daily.py                    ← GA4 每日粒度抓取（獨立於月報腳本，理念相同）
│   ├── transform_daily.py                ← 純函式：原始 rows → 每日粒度中繼結構（可單元測試）
│   ├── encrypt_build.py                  ← 加密＋產出網站檔案
│   └── config.py                         ← property ID、單位/工具/裝置對照表（沿用月報腳本既有內容）
├── site/
│   ├── index.html                        ← 密碼閘門 + 五頁籤外殼
│   ├── dashboard.js                      ← 解密／依區間加總／繪圖／頁籤切換
│   └── style.css                         ← navy/gold/cream 視覺（沿用月報腳本設計語言）
├── data.enc.json                         ← 加密後的資料（repo 裡唯一的資料檔，只有密文）
├── docs/superpowers/specs/               ← 本設計文件
└── README.md
```

## Frank 需要做的一次性設定

1. 在 GitHub 建立新的公開 repo `onetouch-dashboard`（或告知既有帳號要用哪個）
2. 提供密碼（已提供：與先前討論一致，維持 8 位數字）
3. 把 `~/.config/onetouch-ga/client_secret.json`、`token.json` 的內容設成 repo 的 GitHub Secrets（Claude 可代為操作，若有 `gh` CLI 存取權限）
4. Repo 設定裡啟用 GitHub Pages（來源選 GitHub Actions）

## 驗收條件

- 排程與手動觸發（`workflow_dispatch`）皆可正確跑完抓取→加密→部署三步驟
- `fetch_daily.py` 抓到的資料涵蓋 `ROLLOUT_START` 到「昨天」，且與 `recruitment-web` 月報腳本同期資料的加總結果一致（交叉驗證兩套獨立實作的正確性）
- 密碼輸入正確才能看到儀表板內容；密碼錯誤時顯示明確錯誤訊息，不洩漏任何資料片段
- Repo 裡任何時候 `git log` 翻查所有版本，都只找得到加密後的密文，沒有明文數字
- 五個頁籤內容與圖表皆正確渲染，hover 可看到詳細數字
- 日期區間篩選（預設按鈕與自訂區間）正確重新加總並重繪圖表，過程不發出任何網路請求
- 建置失敗時網站維持上一次成功版本，不出現半殘資料
- 網址固定不變，重新整理／重新部署後網址不改變

## 範圍外

- **PDF 匯出**：Frank 確認暫不需要
- **登入失敗次數限制／鎖定機制**：靜態網站架構下無法實現（沒有伺服器可做速率限制），已列為已知限制而非待辦
- **與月報腳本合併或共用程式碼**：兩專案刻意分開維護，各自服務不同用途（每月快照 vs 常駐可篩選儀表板）
- **增量抓取**：目前用整段重新抓取，資料量成長到讓這個決定不再划算時再重新評估

## 相關檔案

- `recruitment-web/SPEC/analytics/04_GA月報腳本_設計.md`（月報腳本的 GA4 事件定義、兩個回饋事件差異、自訂維度踩坑，本專案的資料語意沿用同一套知識）
- `recruitment-web/reports/ga/transform.py`（既有計算邏輯參考：完成率 None 處理、四單位掛零仍列出等原則）
- `~/.config/onetouch-ga/`（GA4 OAuth 憑證來源，本專案將其內容複製進 GitHub Secrets）
