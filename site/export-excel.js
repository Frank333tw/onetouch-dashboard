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
