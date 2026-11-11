"""Real LangGraph trace ownership, parallel waits, tool results and resumption."""
import threading
from dataclasses import replace
from types import SimpleNamespace

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph import analyst_execution, trading_graph
from tradingagents.web import jobs, worker
from tradingagents.web.progress import finish_progress, initial_progress


def agents(event):
    return {a["id"]: a for a in event["progress"]["agents"]}


def test_parallel_model_waits_tool_output_and_restored_completed_agents(tmp_path, monkeypatch):
    @tool
    def sample_prices() -> str:
        """Return an offline price observation."""
        return "本地测试行情 100"

    market = analyst_execution.ANALYST_NODE_SPECS["market"]
    monkeypatch.setitem(analyst_execution.ANALYST_NODE_SPECS, "market", replace(market, tools=(sample_prices,)))
    from tradingagents.agents.analysts import market_analyst
    monkeypatch.setattr(market_analyst, "TOOLS", (sample_prices,))
    barrier = threading.Barrier(2)
    fail_at_manager = [True]

    class OfflineModel(FakeMessagesListChatModel):
        def bind_tools(self, tools, **_):
            return self.bind(test_tools=[t.name for t in tools])

        def with_structured_output(self, *_, **__):
            raise NotImplementedError

        def _generate(self, messages, stop=None, run_manager=None, *, test_tools=None, **kwargs):
            reply = AIMessage(content="Final Rating: Hold")
            if test_tools and not any(isinstance(m, ToolMessage) for m in messages):
                barrier.wait(timeout=5)
                if "sample_prices" in test_tools:
                    reply = AIMessage(content="", tool_calls=[{"name": "sample_prices", "args": {}, "id": "p1"}])
            if fail_at_manager[0] and "As the Research Manager" in str(messages[0].content):
                fail_at_manager[0] = False
                raise RuntimeError("offline model unavailable")
            return ChatResult(generations=[ChatGeneration(message=reply)])

    def client(config, tier, **kwargs):
        return SimpleNamespace(get_llm=lambda: OfflineModel(responses=[], callbacks=kwargs.get("callbacks")))

    monkeypatch.setattr(trading_graph, "create_tier_client", client)
    monkeypatch.setattr(trading_graph.TradingAgentsGraph, "resolve_instrument_context", lambda *a, **kw: "fixture")
    config = {**DEFAULT_CONFIG, "results_dir": str(tmp_path), "data_cache_dir": str(tmp_path / "cache"),
              "memory_log_path": str(tmp_path / "memory.md"), "checkpoint_enabled": True,
              "max_debate_rounds": 2, "max_risk_discuss_rounds": 2}
    args = jobs._validate({"kind": "analysis", "ticker": "TEST", "date": "2025-01-03", "analysts": ["news", "market"]})
    events = []
    with pytest.raises(RuntimeError, match="offline model unavailable"):
        worker._run_analysis(args, config, None, "failed", events.append)
    simultaneous = [e for e in events if all(agents(e)[a]["active_calls"] for a in ("market", "news"))]
    assert simultaneous
    for a in ("market", "news"):
        call = agents(simultaneous[0])[a]["active_calls"][0]
        assert call["kind"] == "model" and call["started_at"] and call["name"]
    tool_events = [e for e in events if e.get("kind") == "tool"]
    assert [e["phase"] for e in tool_events] == ["started", "completed"]
    assert tool_events[-1]["agent_id"] == "market" and "行情 100" in tool_events[-1]["detail"]
    for a in ("bull", "bear"):
        starts = [e for e in events if e.get("agent_id") == a and e.get("kind") == "agent" and e.get("phase") == "started"]
        assert [e["round"] for e in starts] == [1, 2]
    assert agents(events[-1])["research_manager"]["status"] == "failed"
    assert agents(events[-1])["trader"]["status"] == "pending"
    assert agents(events[-1])["market"]["tool_calls"] == 1
    assert agents(events[-1])["market"]["llm_calls"] == 2

    events.clear()
    result = worker._run_analysis(args, config, None, "resumed", events.append)
    assert result["rating"] == "Hold"
    restored = next(e for e in events if e["kind"] == "checkpoint")
    for aid in ("news", "market", "bull", "bear", "memory"):
        assert agents(restored)[aid]["restored"] and agents(restored)[aid]["started_at"] is None
    restored_report = next(e for e in events if e.get("restored") and e["agent_id"] == "market")
    restored_debate = next(e for e in events if e.get("restored") and e["agent_id"] == "bull")
    assert "Final Rating: Hold" in restored_report["detail"] and "Bull" in restored_debate["detail"]
    for aid in ("aggressive", "conservative", "neutral"):
        assert agents(events[-1])[aid]["round"] == 2
    assert all(a["status"] == "completed" for a in agents(events[-1]).values())


@pytest.mark.parametrize(("status","expected"), [("cancelled","cancelled"),("failed","interrupted")])
def test_interrupt_only_changes_inflight_agents(status, expected):
    progress = initial_progress({"kind": "analysis", "analysts": ["news"]})
    first = progress["agents"][0]
    first.update(status="running", started_at="2025-01-01T10:00:00+08:00", active_calls=[{"name": "mock"}])
    job = {"status": status, "finished_at": "2025-01-01T10:00:04+08:00", "progress": progress}
    finish_progress(job)
    assert first["status"] == expected and first["active_calls"] == [] and first["elapsed_seconds"] == 4
    assert progress["agents"][-1]["status"] == "pending"
    assert "progress" not in jobs._summary(job)



def test_progress_retains_findings_and_the_latest_activity():
    early = {"kind": "report", "detail": "Market report"}
    debate = {"kind": "debate", "detail": "First turn"}
    history = [early, debate]
    for n in range(1000):
        jobs._append_event(history, {"kind": "tool", "text": f"Request {n}"})
    assert history[:2] == [early, debate] and len(history) == 350
    assert history[-1]["text"] == "Request 999"
    for n in range(500):
        jobs._append_event(history, {"kind": "debate", "detail": f"Turn {n}"})
    assert early in history and len(history) == 350 and history[-1]["detail"] == "Turn 499"
