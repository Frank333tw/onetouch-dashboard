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
