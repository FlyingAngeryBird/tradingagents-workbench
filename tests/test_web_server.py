"""Verify the workstation HTTP boundary without using the person's model or settings."""
import json
from email.message import Message
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tradingagents.web import server


@pytest.fixture
def workstation(tmp_path, monkeypatch):
    monkeypatch.setattr(server.settings, "SETTINGS_PATH", tmp_path / "settings.json")
    monkeypatch.setenv("TRADINGAGENTS_RESULTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("TRADINGAGENTS_MEMORY_LOG_PATH", str(tmp_path / "memory.md"))
    manager = server.jobs.JobManager(tmp_path / "jobs")
    try:
        def request(method, path, body=None, **headers):
            handler = object.__new__(server.Handler)
            handler.server = SimpleNamespace(server_port=8765, jobs=manager)
            handler.command, handler.path = method, path
            content = json.dumps(body).encode() if body is not None else b""
            handler.rfile = BytesIO(content)
            handler.headers = Message()
            for key, value in {"Host": "127.0.0.1:8765", "Content-Type": "application/json",
                               "Content-Length": str(len(content)), **headers}.items():
                handler.headers[key] = value
            handler.reply = Mock()
            handler.handle_request()
            args, kwargs = handler.reply.call_args
            return kwargs.get("status", 200), args[0]

        yield request
    finally:
        manager.close()


def test_saved_settings_reach_overview_without_disclosing_credential(workstation):
    secret = "example-private-value"
    status, public = workstation("PUT", "/api/settings", {
        "config": {"quick_think_llm": "desk-test"},
        "credentials": {"OPENAI_API_KEY": secret},
    })
    assert status == 200 and public["credentials"]["OPENAI_API_KEY"] is True
    assert secret not in json.dumps(public)
    status, overview = workstation("GET", "/api/overview")
    assert status == 200 and overview["config"]["quick_think_llm"] == "desk-test"
    assert overview["memory_count"] == 0 and overview["report_count"] == 0
    assert secret not in json.dumps(overview)


def test_local_writes_require_same_origin_json(workstation):
    assert workstation("POST", "/api/jobs", {}, Origin="https://elsewhere.invalid")[0] == 403
    assert workstation("GET", "/api/settings", Host="elsewhere.invalid")[0] == 403
    assert workstation("POST", "/api/jobs", {}, **{"Content-Type": "text/plain"})[0] == 415
    assert workstation("POST", "/api/jobs", [])[0] == 400
    assert workstation("GET", "/api/jobs") == (200, [])


def test_homepage_progress_view_omits_full_documents_and_portfolio(workstation, monkeypatch):
    snapshot = {"id": "archive", "status": "completed",
                "events": [{"text": "已提交", "detail": "分析师原文"}],
                "result": {"rating": "Hold", "report_id": "saved", "report": "Markdown", "html": "<main/>"},
                "parameters": {"analysts": ["news"], "portfolio": {"cash": 125}}}
    monkeypatch.setattr(server.jobs.JobManager, "get", lambda self, key: dict(snapshot))
    status, compact = workstation("GET", "/api/jobs/archive?view=progress")
    assert status == 200 and compact["result"] == {"rating": "Hold", "report_id": "saved"}
    assert compact["parameters"] == {"analysts": ["news"]}
    assert compact["events"] == snapshot["events"]
    assert workstation("GET", "/api/jobs/archive")[1] == snapshot
