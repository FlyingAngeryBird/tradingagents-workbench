"""Observed graph-node and provider activity for a single isolated Web run."""
from __future__ import annotations

import copy
import threading
import time
from datetime import datetime

from cli.stats_handler import StatsCallbackHandler

# The graph node names are wire identifiers from GraphSetup. The stable IDs let
# the UI render distinct concurrent analysts and regroup repeated debate turns.
NODES = {
    "Market Analyst": ("market", "市场分析师", "analysts"),
    "Sentiment Analyst": ("social", "情绪分析师", "analysts"),
    "News Analyst": ("news", "新闻分析师", "analysts"),
    "Fundamentals Analyst": ("fundamentals", "基本面分析师", "analysts"),
    "Memory Log": ("memory", "历史记忆", "analysts"),
    "Bull Researcher": ("bull", "看多研究员", "research"),
    "Bear Researcher": ("bear", "看空研究员", "research"),
    "Research Manager": ("research_manager", "研究主管", "research"),
    "Trader": ("trader", "交易员", "trading"),
    "Aggressive Analyst": ("aggressive", "进取风控员", "risk"),
    "Conservative Analyst": ("conservative", "审慎风控员", "risk"),
    "Neutral Analyst": ("neutral", "中立风控员", "risk"),
    "Portfolio Manager": ("portfolio_manager", "组合经理", "decision"),
}
REPORTS = {
    "market_report": ("market", "市场技术报告已提交"), "sentiment_report": ("social", "情绪分析报告已提交"),
    "news_report": ("news", "新闻分析报告已提交"), "fundamentals_report": ("fundamentals", "基本面报告已提交"),
    "investment_plan": ("research_manager", "研究主管已汇总投资论点"),
    "trader_investment_plan": ("trader", "交易员已提交交易计划"),
    "final_trade_decision": ("portfolio_manager", "组合经理已提交最终决策"),
}
SIGNATURES = {
    "bull": ("investment_debate_state", "bull_history", 2, 0),
    "bear": ("investment_debate_state", "bear_history", 2, 1),
    "aggressive": ("risk_debate_state", "aggressive_history", 3, 0),
    "conservative": ("risk_debate_state", "conservative_history", 3, 1),
    "neutral": ("risk_debate_state", "neutral_history", 3, 2),
}


def now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def initial_progress(args):
    if args["kind"] == "backtest":
        return {"mode": "grid", "updated_at": now(), "grid": None, "agents": []}
    return {"mode": "agents", "updated_at": now(), "agents": [
        {"id": aid, "label": label, "phase": phase, "status": "pending", "round": 0,
         "started_at": None, "first_started_at": None, "finished_at": None, "elapsed_seconds": 0,
         "activity": "", "active_calls": [], "llm_calls": 0, "tool_calls": 0}
        for aid, label, phase in NODES.values()
        if phase != "analysts" or aid == "memory" or aid in args["analysts"]
    ]}


def finish_progress(job):
    progress = job.get("progress")
    if not progress:
        return
    for agent in progress["agents"]:
        if agent["status"] == "running":
            agent["status"] = {"failed": "interrupted", "cancelled": "cancelled"}.get(job["status"], "interrupted")
            agent.update(finished_at=job["finished_at"], active_calls=[], activity="")
            if agent["started_at"]:
                segment = datetime.fromisoformat(job["finished_at"]) - datetime.fromisoformat(agent["started_at"])
                agent["elapsed_seconds"] += max(0, segment.total_seconds())
    progress["updated_at"] = job["finished_at"]


class RunProgress(StatsCallbackHandler):
    """LangChain propagates graph metadata to child models and tools, including
    the outer analyst namespace when a nested node is only named 'agent'/'tools'.
    Callbacks run on concurrent worker threads. Record, snapshot and send under
    one lock so the reader never sees a delayed snapshot roll another agent back.
    """

    def __init__(self, args, config, emit, scrub):
        super().__init__()
        self.progress = initial_progress(args)
        self.agents = {a["id"]: a for a in self.progress["agents"]}
        for aid, agent in self.agents.items():
            agent["completed_rounds"] = 0
            agent["rounds_total"] = 1
            if aid in SIGNATURES:
                cfg_key = "max_debate_rounds" if agent["phase"] == "research" else "max_risk_discuss_rounds"
                agent["rounds_total"] = int(config.get(cfg_key, 1))
        self.emit = emit
        self.config = config
        self.scrub = scrub
        self._activity_lock = threading.RLock()
        self._nodes = {}
        self._calls = {}
        self._started = {}

    def _publish(self, text, aid=None, kind="agent", phase="progress", detail=None):
        stamp = now()
        self.progress["updated_at"] = stamp
        event = {"stage": text, "time": stamp, "kind": kind, "phase": phase, "agent_id": aid,
                 "progress": copy.deepcopy(self.progress), "stats": self.get_stats()}
        if aid:
            event["round"] = self.agents[aid]["round"]
        if detail:
            event["detail"] = detail
        if phase == "restored":
            event["restored"] = True
        self.emit(event)

    def note(self, text, aid=None, kind="agent", detail=None):
        with self._activity_lock:
            self._publish(text, aid if aid in self.agents else None, kind, detail=detail)

    def on_chain_start(self, serialized, inputs, *, run_id, metadata=None, name=None, **kwargs):
        node = NODES.get(name)
        if not node or node[0] not in self.agents or (metadata or {}).get("langgraph_node") != name:
            return
        aid = node[0]
        with self._activity_lock:
            agent = self.agents[aid]
            stamp = now()
            agent.pop("restored", None)
            round_no = agent["round"] + 1
            if aid in SIGNATURES and isinstance(inputs, dict):
                state_key, _, speakers, _ = SIGNATURES[aid]
                count = (inputs.get(state_key) or {}).get("count")
                if isinstance(count, int):
                    round_no = count // speakers + 1
            agent.update(round=round_no, status="running", started_at=stamp, finished_at=None,
                         first_started_at=agent["first_started_at"] or stamp, active_calls=[],
                         activity="正在整理研究资料" if aid == "social" else "正在执行")
            self._nodes[run_id] = aid
            self._started[aid] = time.monotonic()
            self._publish(f"{agent['label']}开始工作", aid, phase="started")

    def _end_node(self, run_id, error=None):
        with self._activity_lock:
            aid = self._nodes.pop(run_id, None)
            if not aid:
                return
            agent = self.agents[aid]
            if error is None:
                status, text = "completed", "已完成"
            elif type(error).__name__ in ("CancelledError", "GraphInterrupt", "GraphBubbleUp"):
                status, text = "interrupted", "已中断"
            else:
                status, text = "failed", "执行失败"
            agent.update(status=status, finished_at=now(), activity="", active_calls=[])
            elapsed = time.monotonic() - self._started.pop(aid)
            agent["elapsed_seconds"] = round(agent["elapsed_seconds"] + elapsed, 3)
            if status == "completed":
                agent["completed_rounds"] = agent["round"]
                if agent["round"] < agent["rounds_total"]:
                    agent.update(status="pending", activity=f"等待第 {agent['round'] + 1} 轮发言")
            self._publish(agent["label"] + text, aid, phase=status,
                          detail=self.scrub(error) if error is not None else None)

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        self._end_node(run_id)

    def on_chain_error(self, error, *, run_id, **kwargs):
        self._end_node(run_id, error)

    def _start_call(self, kind, run_id, metadata, name=None):
        metadata = metadata or {}
        namespace = (metadata.get("langgraph_checkpoint_ns") or "").split("|")[0].split(":")[0]
        node = NODES.get(namespace) or NODES.get(metadata.get("langgraph_node"))
        aid = node[0] if node else None
        with self._activity_lock:
            if aid not in self.agents or run_id in self._calls:
                return
            agent = self.agents[aid]
            if not name:
                tier = "deep" if aid in ("research_manager", "portfolio_manager") else "quick"
                name = metadata.get("ls_model_name") or self.config.get(f"{tier}_think_llm") or "模型"
            call = {"kind": kind, "name": name, "started_at": now(), "id": str(run_id)}
            self._calls[run_id] = (aid, call)
            agent["active_calls"].append(call)
            agent["llm_calls" if kind == "model" else "tool_calls"] += 1
            agent["activity"] = ("等待模型响应 · " if kind == "model" else "正在调用工具 · ") + name
            self._publish(f"{agent['label']} · {agent['activity']}", aid, kind, "started")

    def _end_call(self, run_id, detail=None, error=False):
        with self._activity_lock:
            entry = self._calls.pop(run_id, None)
            if not entry:
                return
            aid, call = entry
            agent = self.agents[aid]
            agent["active_calls"] = [c for c in agent["active_calls"] if c["id"] != str(run_id)]
            remaining = agent["active_calls"]
            if remaining:
                agent["activity"] = "等待返回 · " + "、".join(c["name"] for c in remaining)
            elif agent["status"] == "running":
                agent["activity"] = "正在处理结果"
            label = ("模型" if call["kind"] == "model" else "工具") + ("调用失败" if error else "已返回")
            self._publish(f"{agent['label']} · {label} · {call['name']}", aid, call["kind"],
                          "failed" if error else "completed", detail)

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kwargs):
        super().on_chat_model_start(serialized, messages)
        self._start_call("model", run_id, metadata)

    def on_llm_start(self, serialized, prompts, *, run_id, metadata=None, **kwargs):
        super().on_llm_start(serialized, prompts)
        self._start_call("model", run_id, metadata)

    def on_llm_end(self, response, *, run_id, **kwargs):
        super().on_llm_end(response)
        self._end_call(run_id)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._end_call(run_id, self.scrub(error), error=True)

    def on_tool_start(self, serialized, input_str, *, run_id, metadata=None, **kwargs):
        super().on_tool_start(serialized, input_str)
        self._start_call("tool", run_id, metadata, (serialized or {}).get("name") or "数据工具")

    def on_tool_end(self, output, *, run_id, **kwargs):
        content = getattr(output, "content", output)
        if isinstance(content, list):
            content = "\n".join(item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text")
        detail = self.scrub(content) if isinstance(content, str) else None
        self._end_call(run_id, detail, error=getattr(output, "status", None) == "error")

    def on_tool_error(self, error, *, run_id, **kwargs):
        self._end_call(run_id, self.scrub(error), error=True)

    def restore(self, state):
        """Recover filed work from checkpoint values without inventing times or calls."""
        with self._activity_lock:
            restored = []
            for key, (aid, _) in REPORTS.items():
                if state.get(key):
                    restored.append((aid, 1))
            for aid, (state_key, history, speakers, offset) in SIGNATURES.items():
                debate = state.get(state_key) or {}
                if debate.get(history):
                    restored.append((aid, max(1, (debate.get("count", 0) + speakers - 1 - offset) // speakers)))
            # Past context can be empty even after a completed memory step. A
            # research debate is downstream of every analyst AND the memory step.
            if (state.get("investment_debate_state") or {}).get("count"):
                restored.append(("memory", 1))
            changed = False
            for aid, n in restored:
                agent = self.agents.get(aid)
                if agent and agent["status"] == "pending":
                    status = "completed" if n >= agent["rounds_total"] else "pending"
                    agent.update(status=status, round=n, completed_rounds=n, restored=True)
                    changed = True
            if changed:
                self._publish("已载入断点中完成的研究", kind="checkpoint")
            # Record the observation now. The original report/speech time is
            # unknown. A resumed job can still inspect its upstream evidence.
            for key, (aid, label) in REPORTS.items():
                if aid in self.agents and state.get(key):
                    self._publish(f"从断点恢复 · {label}", aid, "report", "restored", state[key])
            for aid, (state_key, history, _, _) in SIGNATURES.items():
                speeches = (state.get(state_key) or {}).get(history)
                if speeches:
                    self._publish(f"从断点恢复 · {self.agents[aid]['label']}的发言",
                                  aid, "debate", "restored", speeches)
