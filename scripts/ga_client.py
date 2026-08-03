"""GA4 Data API 的認證與查詢封裝。回傳原始 rows，不做任何轉換。"""

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, FilterExpression, Filter, Metric, RunReportRequest,
)
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials

from config import PROPERTY_ID, SCOPES, TOKEN_PATH


class RowLimitExceededError(Exception):
    """GA4 回應被截斷（實際筆數大於 limit）。資料量已經大到不能再假設
    一次查詢拿得回全部資料，需要加篩選條件縮小範圍或做分頁。"""


class GAClient:
    def __init__(self):
        if not TOKEN_PATH.exists():
            raise SystemExit(
                f"找不到憑證 {TOKEN_PATH}。\n"
                "本專案沿用 recruitment-web 已設定好的 OAuth 憑證，"
                "若本機不存在，先參考該專案 SPEC/analytics/04_ 的認證章節。"
            )
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
        if not creds.valid:
            try:
                creds.refresh(Request())
            except RefreshError as exc:
                raise SystemExit(
                    "GA4 憑證 refresh token 失效或被撤銷，需要重新走一次 OAuth\n"
                    "授權流程並更新 token.json（本機）／GA_TOKEN_JSON Secret（CI）。\n"
                    f"原始錯誤：{exc}"
                ) from exc
            TOKEN_PATH.write_text(creds.to_json())
        self._client = BetaAnalyticsDataClient(credentials=creds)

    def run(self, dimensions, metrics, start_date, end_date, limit=10000, event_names=None):
        """執行一次查詢，回傳 [{"dims": [...], "metrics": [...]}]。

        event_names: 若指定，只篩選這些事件名稱（透過 eventName 維度過濾），
        避免 GA4 內建自動事件（page_view／scroll／session_start 等未使用
        的事件）灌爆回應筆數。None 表示不篩選。
        """
        dim_filter = None
        if event_names is not None:
            dim_filter = FilterExpression(
                filter=Filter(
                    field_name="eventName",
                    in_list_filter=Filter.InListFilter(values=list(event_names)),
                )
            )

        request = RunReportRequest(
            property=f"properties/{PROPERTY_ID}",
            date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
            dimensions=[Dimension(name=d) for d in dimensions],
            metrics=[Metric(name=m) for m in metrics],
            dimension_filter=dim_filter,
            limit=limit,
        )
        response = self._client.run_report(request)

        # GA4 在筆數超過 limit 時會靜默截斷（回傳前 limit 筆，排序不保證），
        # 不會報錯——如果沒有這個檢查，資料量長大到超過上限時，圖表會開始
        # 顯示錯誤但看起來合理的數字，且沒有任何警訊。
        if response.row_count > len(response.rows):
            raise RowLimitExceededError(
                f"查詢實際有 {response.row_count} 筆，但只拿回 {len(response.rows)} 筆"
                f"（limit={limit}）。dimensions={dimensions} metrics={metrics} "
                f"range={start_date}~{end_date}。需要加篩選條件縮小範圍或做分頁，"
                "不能假設目前的 limit 永遠夠用。"
            )

        return [
            {
                "dims": [v.value for v in row.dimension_values],
                "metrics": [v.value for v in row.metric_values],
            }
            for row in response.rows
        ]
