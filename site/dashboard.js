import { decryptData } from './decrypt.js';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildBrowsers, buildTrend,
  buildFeedbackKpi, buildAdvocacyDistribution, buildImprovementRanking,
  filterFeedbackRecords, distinctSorted, paginate,
} from './aggregate.js';
import { downloadFeedbackExcel } from './export-excel.js';

const NAVY = '#0F2545';
const NAVY_SOFT = '#1E3A6B';
const GOLD = '#C8973A';

let ALL_DATA = null; // { days, days_by_unit, days_by_tool, days_by_device, days_by_browser, feedback_records, meta }
let charts = {};
let currentRange = null; // [start, end]，供切換頁籤時重繪目前圖表用
let listenersInitialized = false; // 見 unlock() 內說明
let feedbackFilters = { office: 'all', tool: 'all', recommend: 'all' };
let feedbackPage = 1;
const FEEDBACK_PAGE_SIZE = 10;

async function loadEncryptedData() {
  const res = await fetch('data.enc.json');
  if (!res.ok) throw new Error(`data.enc.json 載入失敗（HTTP ${res.status}）`);
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
      <span class="label">${escapeHtml(r.label)}</span>
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
    .concat(offices.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)).join('');
  toolSelect.innerHTML = ['<option value="all">工具：全部</option>']
    .concat(tools.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)).join('');
  officeSelect.value = feedbackFilters.office;
  toolSelect.value = feedbackFilters.tool;
  document.getElementById('feedback-filter-recommend').value = feedbackFilters.recommend;
}

// Notion 裡的問卷欄位（受測者姓名、留言、主管姓名、Q4 改善項目選項等）
// 是求職者/管理者自由填寫的文字，不是開發者自己寫死的內容，也不受
// enum 限制——不能信任其中不含 HTML/script 標籤。逐筆紀錄卡片
// （recordCardHtml）與改善項目排行的長條圖標籤（renderBarRows，用於
// renderImprovementRanking）都會把這類「不受信任的外部文字」直接塞進
// innerHTML，兩處都要逐一 escape，避免 stored XSS（例如姓名欄位填
// <img onerror=...> 會在每個打開此頁籤的主管瀏覽器裡執行）。之後若再
// 新增會把 Notion 欄位塞進 innerHTML 的地方，也要記得套用同一個
// escapeHtml。
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function starsHtml(score) {
  const full = Math.max(0, Math.min(5, Math.round(score || 0)));
  return `${'★'.repeat(full)}<span class="dim">${'★'.repeat(5 - full)}</span>`;
}

function chipsHtml(values) {
  return values.length ? values.map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join('') : '（未填）';
}

function recordCardHtml(r) {
  return `
    <div class="record collapsed" data-id="${r.id}">
      <div class="record-top">
        <div class="record-who">
          <span class="name">${escapeHtml(r.cand_name)}</span>
          <span class="meta">${r.cand_age}歲・${escapeHtml(r.cand_occupation)}・${escapeHtml(r.mgr_region)}・${escapeHtml(r.mgr_office)}（${escapeHtml(r.mgr_name)} 主管）</span>
        </div>
        <div class="record-tags">
          <span class="tag tool">${escapeHtml(r.tool_title)}</span>
          <span class="tag ${r.cand_recommend ? 'rec-yes' : 'rec-no'}">${r.cand_recommend ? '推薦' : '未推薦'}</span>
        </div>
      </div>
      <div class="record-scores">
        <span>整體體驗 <span class="stars">${starsHtml(r.cand_overall)}</span></span>
        <span>流程體驗 <span class="stars">${starsHtml(r.cand_process)}</span></span>
        <span>${r.submitted_at.slice(0, 10)} 提交</span>
      </div>
      <p class="comment"><span class="q">留言：</span>${escapeHtml(r.cand_comment || '（未填）')}</p>
      <span class="toggle">查看完整問卷</span>
      <div class="detail">
        <div><dt>Q1 更了解工作現況</dt><dd>${escapeHtml(r.adv_q1 || '（未填）')}</dd></div>
        <div><dt>Q2 開始思考轉變</dt><dd>${escapeHtml(r.adv_q2 || '（未填）')}</dd></div>
        <div><dt>Q3 願意了解機會</dt><dd>${escapeHtml(r.adv_q3 || '（未填）')}</dd></div>
        <div><dt>Q4 最希望改善項目</dt><dd>${chipsHtml(r.adv_q4)}</dd></div>
        ${r.adv_q4_other ? `<div><dt>Q4 其他文字</dt><dd>${escapeHtml(r.adv_q4_other)}</dd></div>` : ''}
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
  document.getElementById('feedback-download-btn').disabled = totalCount === 0;
  document.getElementById('feedback-page-prev').disabled = page <= 1;
  document.getElementById('feedback-page-next').disabled = page >= totalPages;
}

function renderFeedback() {
  feedbackPage = 1;
  const records = currentFeedbackRecords();
  renderFeedbackKpis(buildFeedbackKpi(records));
  renderAdvocacy(buildAdvocacyDistribution(records));
  renderImprovementRanking(buildImprovementRanking(records));
  renderFeedbackFilterOptions();
  renderFeedbackRecords();
}

function renderUnits(units, notes) {
  destroyChart('units');
  charts.units = new Chart(document.getElementById('chart-units'), {
    type: 'bar',
    data: {
      labels: units.map((u) => u.label),
      datasets: [
        { label: '開啟工具', data: units.map((u) => u.tool_open), backgroundColor: NAVY_SOFT },
        { label: '完成測驗', data: units.map((u) => u.result_view), backgroundColor: GOLD },
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
  // 註記文字來自 scripts/config.py 的 REPORT_NOTES，經 fetch_daily.py 寫進
  // 資料檔的 notes 欄位——單一資料來源，不在這裡寫死第二份（這是隨推廣
  // 進度會變動的文字，兩份不連動遲早會有一份漏改）。
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

function renderBrowsers(browsers) {
  destroyChart('browsers');
  charts.browsers = new Chart(document.getElementById('chart-browsers'), {
    type: 'doughnut',
    data: {
      labels: browsers.map((b) => b.label),
      datasets: [{ data: browsers.map((b) => b.sessions), backgroundColor: [GOLD, NAVY_SOFT] }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: {
        label: (item) => {
          const b = browsers[item.dataIndex];
          const pct = b.share === null ? '—' : `${(b.share * 100).toFixed(1)}%`;
          return `${b.label}：${b.sessions}（${pct}）`;
        },
      } } },
    },
  });
}

function renderAll(start, end) {
  currentRange = [start, end];
  const days = filterRange(ALL_DATA.days, start, end);
  const unitDays = ALL_DATA.days_by_unit.filter((d) => d.date >= start && d.date <= end);
  const toolDays = ALL_DATA.days_by_tool.filter((d) => d.date >= start && d.date <= end);
  const deviceDays = ALL_DATA.days_by_device.filter((d) => d.date >= start && d.date <= end);
  const browserDays = ALL_DATA.days_by_browser.filter((d) => d.date >= start && d.date <= end);

  renderKpis(buildKpi(days));
  renderTrend(buildTrend(days));
  renderUnits(buildUnits(unitDays), ALL_DATA.notes || []);
  renderFunnel('chart-funnel', 'funnel', buildFunnel(days));
  renderFunnel('chart-feedback-funnel', 'feedbackFunnel', buildFeedbackFunnel(days));
  renderTools(buildTools(toolDays));
  renderDevices(buildDevices(deviceDays));
  renderBrowsers(buildBrowsers(browserDays));
  renderFeedback();

  // 顯示資料實際更新到哪一天：這是排程失敗時唯一會被使用者看見的線索
  // ——排程若壞掉，網站會繼續正常顯示「上一次成功」的資料（刻意的
  // fail-closed 設計），畫面本身不會出現任何錯誤。沒有這行，資料卡在
  // 半年前會被誤讀成「這陣子用量下滑」，而不是「排程壞了」。
  document.getElementById('data-range-sub').textContent =
    `顯示區間：${start} ～ ${end}（資料更新至 ${ALL_DATA.meta.last_day}）`;
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
      // Chart.js 在畫布所在的 .tab-panel 還是 display:none 時建立圖表，
      // 量不到實際尺寸會畫成空白（且事後用 resize()/update() 修補時機
      // 不穩定，實測過會有數百毫秒到數秒的延遲，不可靠）。這裡改成
      // 先讓目前頁籤變成可見，再整個重新呼叫 renderAll()——沿用一開始
      // 就驗證正常的「銷毀舊圖表再建立新的」模式，保證使用者正在看的
      // 頁籤，圖表一定是在畫布真正可見時才建立。其餘隱藏頁籤的圖表
      // 也會一併重建（一樣建立在隱藏畫布裡），但沒人正在看，等下次
      // 切過去時本來就會再重繪一次，不影響正確性，資料量小也不值得
      // 為了省這點運算另外做「只重繪目前頁籤」的複雜邏輯。
      if (currentRange) renderAll(currentRange[0], currentRange[1]);
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

async function unlock() {
  const password = document.getElementById('password-input').value;
  const errorEl = document.getElementById('gate-error');
  errorEl.textContent = '';

  // 分成兩段 try/catch：資料載入失敗（網路、檔案不存在）跟密碼錯誤是
  // 完全不同的問題，混在同一個訊息裡會誤導——尤其本機測試時
  // data.enc.json 可能還沒產生，這時顯示「密碼錯誤」會讓人誤以為自己
  // 打錯密碼，跑去重打，但真正的問題是檔案根本不存在。
  let encBlob;
  try {
    encBlob = await loadEncryptedData();
  } catch (e) {
    errorEl.textContent = '無法載入資料，請確認網路連線或稍後再試';
    return;
  }

  try {
    ALL_DATA = await decryptData(encBlob, password);
  } catch (e) {
    errorEl.textContent = '密碼錯誤，請重新輸入';
    return;
  }

  // 密碼正確、資料也解密成功了，理論上不該再失敗——但畫面切換與
  // 圖表渲染若真的出錯（例如未來資料結構意外跟預期不一致），
  // 不能讓使用者卡在一個沒有任何錯誤訊息的空白畫面。抓到就退回
  // 密碼輸入畫面並顯示清楚的錯誤，而不是留著半渲染的狀態。
  try {
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').classList.add('visible');
    // 只在第一次成功解鎖時掛監聽器：若這個 try 區塊之後失敗、使用者
    // 退回密碼畫面重新輸入一次，第二次成功不能再掛一組——否則頁籤
    // 按鈕、日期篩選按鈕都會疊加重複的 listener，每點一次觸發兩次
    // （甚至更多次）renderAll()，一路把圖表銷毀重建好幾遍。
    if (!listenersInitialized) {
      setupTabs();
      setupDateFilter();
      setupFeedbackControls();
      listenersInitialized = true;
    }
    const [start, end] = presetRange('all', ALL_DATA.meta.rollout_start);
    renderAll(start, end);
  } catch (e) {
    document.getElementById('app').classList.remove('visible');
    document.getElementById('gate').classList.remove('hidden');
    errorEl.textContent = '資料顯示時發生問題，請重新整理頁面再試';
  }
}

document.getElementById('unlock-btn').addEventListener('click', unlock);
document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlock();
});
