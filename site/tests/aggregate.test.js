import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
  buildFeedbackKpi, buildAdvocacyDistribution, buildImprovementRanking,
  filterFeedbackRecords, distinctSorted, paginate,
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

test('buildFeedbackFunnel 前一階段為 0 時，留存率回 null 不是 0 或 NaN', () => {
  const zeroFirstStage = [
    { date: '2026-07-01', feedback_opened: 0, feedback_page2: 0,
      feedback_submitted: 0, feedback_pdf: 0 },
  ];
  const funnel = buildFeedbackFunnel(zeroFirstStage);
  assert.equal(funnel[0].retention_from_prev, null, '第一階段沒有前一階段');
  assert.equal(funnel[1].retention_from_prev, null, '前一階段是 0，不能除以 0');
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

test('buildDevices 總數為 0 時，佔比回 null 不是 0 或 NaN', () => {
  const devices = buildDevices([{ date: '2026-07-01', category: 'desktop', sessions: 0 }]);
  assert.equal(devices[0].share, null);
});

test('buildTrend 回傳每日序列供折線圖使用', () => {
  const trend = buildTrend(DAYS);
  assert.deepEqual(trend.map((t) => t.date), ['2026-07-01', '2026-07-02']);
  assert.deepEqual(trend.map((t) => t.sessions), [10, 6]);
});

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

test('buildFeedbackKpi 包含 null 評分時只計算非 null 的平均值', () => {
  const records = [
    { cand_overall: 5, cand_process: 4, cand_recommend: true },
    { cand_overall: null, cand_process: 3, cand_recommend: false },
    { cand_overall: 4, cand_process: null, cand_recommend: true },
  ];
  const kpi = buildFeedbackKpi(records);
  assert.equal(kpi.count, 3);
  assert.equal(kpi.avg_overall, 4.5, '(5 + 4) / 2，null 不計入');
  assert.equal(kpi.avg_process, 3.5, '(4 + 3) / 2，null 不計入');
  assert.equal(kpi.recommend_rate, 2/3, '兩筆推薦/三筆共');
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

test('filterFeedbackRecords 當 submitted_at 為 null 時應排除', () => {
  const records = [
    { submitted_at: '2026-08-01T00:00:00.000+08:00', mgr_office: 'A', tool_title: 'DISC' },
    { submitted_at: null, mgr_office: 'B', tool_title: 'DISC' },
    { submitted_at: '2026-08-05T00:00:00.000+08:00', mgr_office: 'C', tool_title: 'DISC' },
  ];
  const result = filterFeedbackRecords(records, {
    start: '2026-08-01', end: '2026-08-31', office: 'all', tool: 'all', recommend: 'all',
  });
  assert.equal(result.length, 2);
  assert.equal(result.map((r) => r.mgr_office).join(','), 'A,C');
});

test('distinctSorted 取不重複值並排序', () => {
  const offices = distinctSorted(FEEDBACK_RECORDS, 'mgr_office');
  assert.deepEqual(offices, ['信義通訊處', '大墩通訊處']);
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
