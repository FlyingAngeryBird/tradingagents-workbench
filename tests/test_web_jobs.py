"""Worker lifecycle, credential isolation and CLI/Web report interoperability."""
import json
import subprocess
import sys
import time
from contextlib import nullcontext
from unittest.mock import MagicMock

import pytest

from tradingagents.web import jobs, worker


def test_job_cancel_and_restart_keep_result_and_continuation_id(tmp_path, monkeypatch):
    real_popen = subprocess.Popen

    def start_worker(command, **kwargs):
        # Exercise real process startup, stdin, stdout and cancellation without a model.
        grid = {"index": 1, "total": 2, "ticker": "AAPL", "date": "2025-01-01"}
        packet = json.dumps({"stage": "首个回测样本", "kind": "grid", "phase": "started",
                             "detail": "回测已启动", "progress": {"mode": "grid", "agents": [], "grid": grid}})
        code = (
            "import sys, time\n"
            "sys.stdin.readline()\n"
            f"print({packet!r}, flush=True)\n"
            "time.sleep(30)\n"
        )
        return real_popen([sys.executable, "-c", code], **kwargs)

    monkeypatch.setattr(jobs.subprocess, "Popen", start_worker)
    payload = {"kind": "backtest", "tickers": ["AAPL"], "start": "2025-01-01", "end": "2025-01-10"}
    manager = jobs.JobManager(tmp_path)
    try:
        job = manager.start(payload, {}, {"WEB_TEST_SECRET": "test"})
        assert job["run_id"]
        until = time.monotonic() + 10
        while not manager.get(job["id"])["events"] and time.monotonic() < until:
            time.sleep(.02)
        detail = manager.get(job["id"])
        assert detail["events"][0]["detail"] == "回测已启动"
        assert detail["events"][0]["kind"] == "grid" and detail["events"][0]["phase"] == "started"
        assert detail["progress"]["grid"]["total"] == 2
        assert "progress" not in manager.list()[0]
        with pytest.raises(RuntimeError):
            manager.start(payload, {})
        assert manager.cancel(job["id"])["status"] == "cancelled"
    finally:
        manager.close()
    manager = jobs.JobManager(tmp_path)
    try:
        assert manager.list()[0]["status"] == "cancelled"
        detail = manager.get(job["id"])
        assert detail["parameters"]["run_id"] == job["run_id"]
        assert "WEB_TEST_SECRET" not in json.dumps(detail)
    finally:
        manager.close()


def test_graph_validation_error_from_real_subprocess_is_visible(tmp_path):
    from tradingagents.default_config import DEFAULT_CONFIG

    manager = jobs.JobManager(tmp_path / "web")
    try:
        config = {**DEFAULT_CONFIG, "quick_think_provider": None, "deep_think_provider": None,
                  "llm_provider": "absent-test-provider", "results_dir": str(tmp_path / "logs"),
                  "data_cache_dir": str(tmp_path / "cache")}
        job = manager.start({"kind": "analysis", "ticker": "AAPL", "date": "2025-01-01"}, config)
        until = time.monotonic() + 35
        while time.monotonic() < until:
            detail = manager.get(job["id"])
            if detail["status"] != "running":
                break
            time.sleep(.05)
        assert detail["status"] == "failed"
        assert "absent-test-provider" in detail["error"]
    finally:
        manager.close()


def test_streamed_analysis_writes_readable_complete_reports(tmp_path, monkeypatch):
    from tradingagents.graph import trading_graph
    from tradingagents.reporting import write_report_tree

    graph = MagicMock()
    graph.checkpoint_scope.return_value = nullcontext("checkpoint-thread")
    graph.propagator.get_graph_args.return_value = {"config": {}}
    graph.default_report_path.return_value = tmp_path / "reports" / "AAPL_20250102_140000"
    graph.save_reports.side_effect = write_report_tree
    graph.stream_run.return_value = [
        ([], {"trade_date": "2025-01-01", "market_report": "行情数据"}),
        ([], {"investment_debate_state": {"count": 1, "current_response": "多头发言"}}),
        ([], {"risk_debate_state": {"count": 1, "latest_speaker": "Conservative",
                                    "current_conservative_response": "谨慎观点"}}),
        ([], {"final_rating": "Hold", "final_trade_decision": "维持当前仓位"}),
    ]
    monkeypatch.setattr(trading_graph, "TradingAgentsGraph", lambda *a, **k: graph)
    args = jobs._validate({"kind": "analysis", "ticker": "aapl", "date": "2025-01-01", "analysts": ["market"]})
    config = {"results_dir": str(tmp_path)}
    emitted = []
    result = worker._run_analysis(args, config, None, "job", emitted.append)
    assert graph.stream_run.call_args.kwargs["config"]["configurable"] == {"thread_id": "checkpoint-thread"}
    graph.clear_checkpoint_on_success.assert_called_once()
    assert result["rating"] == "Hold"
    detail = [event.get("detail") for event in emitted]
    assert all(text in detail for text in ["行情数据", "多头发言", "谨慎观点", "维持当前仓位"])
    assert "行情数据" in result["report"] and "维持当前仓位" in result["html"]
    report = jobs.list_reports(config)[0]
    assert report["ticker"] == "AAPL" and report["date"] == "2025-01-01" and report["has_html"]
    assert jobs.read_report(config, report["id"], "md") == result["report"]
    with pytest.raises(KeyError):
        jobs.read_report(config, "../reports")
    with pytest.raises(ValueError):
        jobs.read_report(config, report["id"], "../json")


def test_rejects_mixed_backtest_asset_type_and_bad_portfolio():
    with pytest.raises(ValueError):
        jobs._validate({"kind": "backtest", "tickers": ["AAPL", "BTCUSD"]})
    with pytest.raises(ValueError):
        jobs._validate({"kind": "analysis", "ticker": "AAPL", "date": "2025-01-01", "portfolio": {"cash": "bad"}})
