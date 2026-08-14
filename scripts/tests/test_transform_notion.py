from transform_notion import build_feedback_records


def _prop_title(text):
    return {"title": [{"plain_text": text}]}


def _prop_text(text):
    return {"rich_text": [{"plain_text": text}] if text else []}


def _prop_select(name):
    return {"select": {"name": name} if name else None}


def _prop_multi_select(names):
    return {"multi_select": [{"name": n} for n in names]}


def _prop_number(value):
    return {"number": value}


def _prop_checkbox(value):
    return {"checkbox": value}


def _prop_date(iso_string):
    return {"date": {"start": iso_string} if iso_string else None}


def _full_page(page_id="page-1", submitted_at="2026-08-12T09:00:00.000+08:00"):
    return {
        "id": page_id,
        "properties": {
            "名稱": _prop_title("王曉萱 - 行為模式DISC"),
            "工具名稱": _prop_select("行為模式DISC"),
            "主管姓名": _prop_text("陳建宏"),
            "主管區域": _prop_select("北二"),
            "主管單位": _prop_select("信義通訊處"),
            "受測者姓名": _prop_text("王曉萱"),
            "受測者性別": _prop_select("女"),
            "受測者年齡": _prop_number(28),
            "受測者職業": _prop_text("門市人員"),
            "整體體驗星等": _prop_number(5),
            "流程體驗星等": _prop_number(4),
            "是否推薦": _prop_checkbox(True),
            "留言": _prop_text("解說很清楚。"),
            "Q1 更了解工作現況": _prop_select("非常同意"),
            "Q2 開始思考轉變": _prop_select("同意"),
            "Q3 願意了解機會": _prop_select("同意"),
            "Q4 最希望改善項目": _prop_multi_select(["結果解讀說明", "介面速度"]),
            "Q4 其他文字": _prop_text(""),
            "Q5 希望提供資訊": _prop_multi_select(["薪資制度", "教育訓練"]),
            "提交時間": _prop_date(submitted_at),
        },
    }


def test_build_feedback_records_maps_all_fields():
    records = build_feedback_records([_full_page()])
    assert len(records) == 1
    r = records[0]
    assert r["id"] == "page-1"
    assert r["submitted_at"] == "2026-08-12T09:00:00.000+08:00"
    assert r["tool_title"] == "行為模式DISC"
    assert r["mgr_name"] == "陳建宏"
    assert r["mgr_region"] == "北二"
    assert r["mgr_office"] == "信義通訊處"
    assert r["cand_name"] == "王曉萱"
    assert r["cand_gender"] == "女"
    assert r["cand_age"] == 28
    assert r["cand_occupation"] == "門市人員"
    assert r["cand_overall"] == 5
    assert r["cand_process"] == 4
    assert r["cand_recommend"] is True
    assert r["cand_comment"] == "解說很清楚。"
    assert r["adv_q1"] == "非常同意"
    assert r["adv_q2"] == "同意"
    assert r["adv_q3"] == "同意"
    assert r["adv_q4"] == ["結果解讀說明", "介面速度"]
    assert r["adv_q4_other"] == ""
    assert r["adv_q5"] == ["薪資制度", "教育訓練"]


def test_build_feedback_records_handles_empty_optional_fields():
    page = _full_page(page_id="page-2")
    page["properties"]["Q1 更了解工作現況"] = _prop_select(None)
    page["properties"]["Q4 最希望改善項目"] = _prop_multi_select([])
    page["properties"]["留言"] = _prop_text("")
    # Test null number fields
    page["properties"]["受測者年齡"] = _prop_number(None)
    page["properties"]["整體體驗星等"] = _prop_number(None)
    page["properties"]["流程體驗星等"] = _prop_number(None)
    # Test null date field
    page["properties"]["提交時間"] = _prop_date(None)

    records = build_feedback_records([page])

    r = records[0]
    assert r["adv_q1"] is None, "未填的 select 要是 None，不能報錯或變成空字串跟'未填'混淆"
    assert r["adv_q4"] == []
    assert r["cand_comment"] == ""
    assert r["cand_age"] is None, "未填的 number 要是 None"
    assert r["cand_overall"] is None, "未填的 number 要是 None"
    assert r["cand_process"] is None, "未填的 number 要是 None"
    assert r["submitted_at"] is None, "未填的 date 要是 None，即使它是排序鍵"


def test_build_feedback_records_sorts_newest_first():
    older = _full_page(page_id="old", submitted_at="2026-08-01T00:00:00.000+08:00")
    newer = _full_page(page_id="new", submitted_at="2026-08-12T00:00:00.000+08:00")

    records = build_feedback_records([older, newer])

    assert [r["id"] for r in records] == ["new", "old"]
