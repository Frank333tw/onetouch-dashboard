import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRange, buildKpi, buildUnits, buildTools, buildFunnel,
  buildFeedbackFunnel, buildDevices, buildTrend,
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
