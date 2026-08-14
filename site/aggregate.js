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
