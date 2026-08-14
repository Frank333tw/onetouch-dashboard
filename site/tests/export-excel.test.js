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
