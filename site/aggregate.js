// 純函式：每日粒度陣列 + 日期區間 → 六區塊需要的彙總資料。無 DOM、無網路。

const UNIT_LABELS = {
  taian: '台安', feiang: '飛昂',
  '(direct)': '直接進入／未帶追蹤連結',
};

const TOOL_LABELS = {
  '/tool/behavior-disc': '行為模式 DISC',
  '/tool/career-needs': '收入需求試算',
  '/tool/career-motivation': '動力分析',
  '/tool/work-satisfaction': '工作滿意度',
  '/tool/career-placement': '職業落點',
};

const DEVICE_LABELS = { desktop: '桌機', mobile: '手機', tablet: '平板' };
// 長青、益盛討論後最終沒有參與測試，不再追蹤；圓夢起點已下架。
const TRACKED_UNITS = ['taian', 'feiang'];
// GA4 無法歸因來源時歸到這裡，可能是跨網域/App 內建瀏覽器丟失 referrer、
// 隱私設定阻擋，或處理延遲等原因——來源不明確、量也小，不追蹤顯示。
const EXCLUDED_UNIT_SOURCES = ['(not set)'];
// 已下架的工具，歷史資料仍在 GA 但不再顯示於比較圖。
const EXCLUDED_TOOL_PATHS = ['/tool/career-unlock'];

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
    if (EXCLUDED_UNIT_SOURCES.includes(r.source)) continue;
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
    if (EXCLUDED_TOOL_PATHS.includes(r.path)) continue;
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
  const avg = (field) => {
    const answered = records.filter((r) => r[field] !== null && r[field] !== undefined);
    return answered.length ? answered.reduce((acc, r) => acc + r[field], 0) / answered.length : null;
  };
  const recommendCount = records.filter((r) => r.cand_recommend).length;
  return {
    count,
    avg_overall: avg('cand_overall'),
    avg_process: avg('cand_process'),
    recommend_rate: count ? recommendCount / count : null,
  };
}

// 三題的選項文字彼此不同、不是同一套「同意／不同意」量表——來自
// recruitment-web「Recruitment Interview Tool Design System/ui_kits/recruitment_tool/
// ResultActions.jsx」的 ADV_QUESTIONS 常數（受測者實際看到的題目與選項），
// 2026-08-14 已跟 Frank 核對過是正確的真實文字，不是假設值。
// 「算正向」的判斷邏輯每題不同：
//   Q1（這次測驗，讓你更了解自己的工作現況嗎？）：「很有幫助」「有些幫助」算正向
//   Q2（測驗後，你開始思考工作上的轉變了嗎？）：除了「目前沒有」，其餘三個選項
//     （想了解更多機會／想增加收入／想改善現況）都代表受測者「有在想轉變」，算正向
//   Q3（願意花 30 分鐘，先了解看看機會嗎？）：「很願意」「可以了解看看」算正向
const ADVOCACY_QUESTIONS = [
  { field: 'adv_q1', label: 'Q1 更了解工作現況', positiveOptions: new Set(['很有幫助', '有些幫助']) },
  { field: 'adv_q2', label: 'Q2 開始思考轉變', positiveOptions: new Set(['想了解更多機會', '想增加收入', '想改善現況']) },
  { field: 'adv_q3', label: 'Q3 願意了解機會', positiveOptions: new Set(['很願意', '可以了解看看']) },
];

export function buildAdvocacyDistribution(records) {
  return ADVOCACY_QUESTIONS.map(({ field, label, positiveOptions }) => {
    const answered = records.filter((r) => r[field] !== null && r[field] !== undefined);
    const agreeCount = answered.filter((r) => positiveOptions.has(r[field])).length;
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
    if (!r.submitted_at) return false;
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
