from config import (
    PROPERTY_ID, UNIT_LABELS, TOOL_LABELS, DEVICE_LABELS, ROLLOUT_START,
    unit_label, tool_label, device_label,
)


def test_property_id_is_numeric_string():
    assert PROPERTY_ID == "538937948"


def test_rollout_start():
    assert ROLLOUT_START == "2026-07-01"


def test_unit_label_maps_known_units():
    assert unit_label("taian") == "台安"
    assert unit_label("feiang") == "飛昂"
    assert unit_label("changqing") == "長青"
    assert unit_label("yisheng") == "益盛"


def test_unit_label_direct_traffic():
    assert unit_label("(direct)") == "直接進入／未帶追蹤連結"


def test_unit_label_passes_through_unknown():
    assert unit_label("m.facebook.com") == "m.facebook.com"


def test_tool_label_maps_paths():
    assert tool_label("/tool/behavior-disc") == "行為模式 DISC"
    assert tool_label("/tool/career-needs") == "收入需求試算"
    assert tool_label("/tool/career-motivation") == "動力分析"
    assert tool_label("/tool/work-satisfaction") == "工作滿意度"
    assert tool_label("/tool/career-placement") == "職業落點"


def test_tool_label_marks_retired_tool():
    assert tool_label("/tool/career-unlock") == "圓夢起點（已下架）"


def test_device_label_translates():
    assert device_label("desktop") == "桌機"
    assert device_label("mobile") == "手機"
    assert device_label("tablet") == "平板"
