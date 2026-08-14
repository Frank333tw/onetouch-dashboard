"""Notion API page 物件 → 逐筆問卷回饋紀錄。純函式，無網路、無檔案 IO。"""


def _rich_text(prop):
    return "".join(p["plain_text"] for p in prop.get("rich_text", []))


def _select(prop):
    value = prop.get("select")
    return value["name"] if value else None


def _multi_select(prop):
    return [item["name"] for item in prop.get("multi_select", [])]


def _number(prop):
    return prop.get("number")


def _checkbox(prop):
    return bool(prop.get("checkbox"))


def _date(prop):
    value = prop.get("date")
    return value["start"] if value else None


def build_feedback_records(pages):
    """pages: Notion database query 回傳的 results 陣列（原始 page 物件）。
    依提交時間新到舊排序，供前端逐筆列表預設顯示最新的在最上面。
    """
    records = []
    for page in pages:
        props = page["properties"]
        records.append({
            "id": page["id"],
            "submitted_at": _date(props["提交時間"]),
            "tool_title": _select(props["工具名稱"]),
            "mgr_name": _rich_text(props["主管姓名"]),
            "mgr_region": _select(props["主管區域"]),
            "mgr_office": _select(props["主管單位"]),
            "cand_name": _rich_text(props["受測者姓名"]),
            "cand_gender": _select(props["受測者性別"]),
            "cand_age": _number(props["受測者年齡"]),
            "cand_occupation": _rich_text(props["受測者職業"]),
            "cand_overall": _number(props["整體體驗星等"]),
            "cand_process": _number(props["流程體驗星等"]),
            "cand_recommend": _checkbox(props["是否推薦"]),
            "cand_comment": _rich_text(props["留言"]),
            "adv_q1": _select(props["Q1 更了解工作現況"]),
            "adv_q2": _select(props["Q2 開始思考轉變"]),
            "adv_q3": _select(props["Q3 願意了解機會"]),
            "adv_q4": _multi_select(props["Q4 最希望改善項目"]),
            "adv_q4_other": _rich_text(props["Q4 其他文字"]),
            "adv_q5": _multi_select(props["Q5 希望提供資訊"]),
        })
    records.sort(key=lambda r: r["submitted_at"] or "", reverse=True)
    return records
