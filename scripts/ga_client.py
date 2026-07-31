"""GA4 Data API 的認證與查詢封裝。回傳原始 rows，不做任何轉換。"""

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange, Dimension, Metric, RunReportRequest,
)
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from config import PROPERTY_ID, SCOPES, TOKEN_PATH


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
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json())
        self._client = BetaAnalyticsDataClient(credentials=creds)

    def run(self, dimensions, metrics, start_date, end_date, limit=10000):
        request = RunReportRequest(
            property=f"properties/{PROPERTY_ID}",
            date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
            dimensions=[Dimension(name=d) for d in dimensions],
            metrics=[Metric(name=m) for m in metrics],
            limit=limit,
        )
        response = self._client.run_report(request)
        return [
            {
                "dims": [v.value for v in row.dimension_values],
                "metrics": [v.value for v in row.metric_values],
            }
            for row in response.rows
        ]
