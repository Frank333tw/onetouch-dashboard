import pytest
from unittest.mock import MagicMock, patch

from notion_client import NotionClient


def test_raises_when_token_missing(monkeypatch):
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    monkeypatch.setenv("NOTION_DATABASE_ID", "test-db-id")
    with pytest.raises(SystemExit):
        NotionClient()


def test_raises_when_database_id_missing(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    monkeypatch.delenv("NOTION_DATABASE_ID", raising=False)
    with pytest.raises(SystemExit):
        NotionClient()


def _client(monkeypatch):
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    monkeypatch.setenv("NOTION_DATABASE_ID", "test-db-id")
    return NotionClient()


@patch("notion_client.requests.post")
def test_query_database_follows_pagination_cursor(mock_post, monkeypatch):
    client = _client(monkeypatch)

    page1 = MagicMock()
    page1.json.return_value = {
        "results": [{"id": "a"}, {"id": "b"}],
        "has_more": True,
        "next_cursor": "cursor-1",
    }
    page2 = MagicMock()
    page2.json.return_value = {
        "results": [{"id": "c"}],
        "has_more": False,
        "next_cursor": None,
    }
    mock_post.side_effect = [page1, page2]

    pages = client.query_database()

    assert [p["id"] for p in pages] == ["a", "b", "c"]
    assert mock_post.call_count == 2
    second_call_body = mock_post.call_args_list[1].kwargs["json"]
    assert second_call_body["start_cursor"] == "cursor-1"


@patch("notion_client.requests.post")
def test_query_database_stops_when_has_more_is_false(mock_post, monkeypatch):
    client = _client(monkeypatch)
    single_page = MagicMock()
    single_page.json.return_value = {"results": [{"id": "x"}], "has_more": False, "next_cursor": None}
    mock_post.return_value = single_page

    pages = client.query_database()

    assert len(pages) == 1
    assert mock_post.call_count == 1
