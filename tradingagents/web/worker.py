"""A single Web workbench run, isolated from other jobs' provider credentials."""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from dataclasses import asdict


def _run_analysis(args, config, book, job_id, emit):
    from tradingagents.agents.rating import run_rating
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.web.progress import REPORTS, RunProgress

    stats = RunProgress(args, config, emit, _clean_error)
    stats.note("正在初始化研究团队")
    graph = TradingAgentsGraph(args["analysts"], config=config, callbacks=[stats])
    ticker, day, asset = args["tickers"][0], args["date"], args["asset_type"]
    stats.note("正在识别标的并准备研究资料")
    initial = graph.create_run_state(ticker, day, asset, book)
    run_args = graph.propagator.get_graph_args(callbacks=[stats])
    state, filed = {}, set()
    debate_counts = {}
    with graph.checkpoint_scope(ticker, day, asset, book) as tid:
        if tid is not None:
            run_args["config"]["configurable"] = {"thread_id": tid}
        graph_input = graph.checkpoint_input(initial)
        resuming = graph_input is None
        stats.note("正在读取已保存的分析断点" if resuming else "启动分析师与记忆检索")
        for _, update in graph.stream_run(graph_input, **run_args):
            if not update:
                continue
            state.update(update)
            if resuming and "company_of_interest" in update:
                stats.restore(update)
                for key in REPORTS:
                    if update.get(key):
                        filed.add(key)
                for key in ("investment_debate_state", "risk_debate_state"):
                    debate_counts[key] = (update.get(key) or {}).get("count", 0)
                resuming = False
            for key, (aid, label) in REPORTS.items():
                if update.get(key) and key not in filed:
                    filed.add(key)
                    stats.note(label, aid, "report", detail=update[key])
            for key, label in (("investment_debate_state", "多空论证"), ("risk_debate_state", "风险评议")):
                debate = update.get(key) or {}
                count = debate.get("count", 0)
                if count > debate_counts.get(key, 0):
                    debate_counts[key] = count
                    aid = "bull" if count % 2 else "bear"
                    response_key = "current_response"
                    if key == "risk_debate_state":
                        aid = str(debate.get("latest_speaker") or "").lower()
                        response_key = f"current_{aid}_response"
                    detail = debate.get(response_key)
                    stats.note(f"{label} · 第 {count} 次发言", aid, "debate", detail=detail)

        if not state.get("final_trade_decision"):
            raise RuntimeError("本次研究未生成最终决策")
        stats.note("正在保存决策和研究报告")
        graph.record_decision(ticker, day, state)
        report_dir = graph.default_report_path(ticker)
        if report_dir.exists():
            report_dir = report_dir.with_name(f"{report_dir.name}_{job_id[:8]}")
        report = graph.save_reports(state, ticker, report_dir)
        graph.clear_checkpoint_on_success(ticker, day, asset, book)

    return {"rating": run_rating(state), "report_id": report.parent.name, "stats": stats.get_stats(),
            "report": report.read_text(encoding="utf-8"), "html": report.with_suffix(".html").read_text(encoding="utf-8")}


def _run_backtest(args, config, book, emit):
    from tradingagents.backtest import iter_grid, run_backtest, summarize
    from tradingagents.web.progress import initial_progress, now

    progress = initial_progress(args)
    dates = iter_grid(args["start"], args["end"], args["every"])
    emit({"stage": f"准备回测 · {len(args['tickers'])} 个标的 × {len(dates)} 个日期", "progress": progress})

    def cell(index, total, ticker, day):
        grid = {"index": index, "total": total, "ticker": ticker, "date": day}
        emit({"stage": f"{index}/{total} · {ticker} · {day}", "kind": "grid", "phase": "started",
              "progress": {**progress, "updated_at": now(), "grid": grid}})

    result = run_backtest(
        args["tickers"], dates, config, asset_type=args["asset_type"], portfolio=book,
        selected_analysts=args["analysts"], run_id=args["run_id"],
        progress=cell,
    )
    summary = summarize(result)
    return {"run_id": result.run_id, "cells_run": result.cells_run, "skipped": result.skipped,
            "failures": [(ticker, day, _clean_error(reason)) for ticker, day, reason in result.failures],
            "settlement_failures": [(ticker, _clean_error(reason)) for ticker, reason in result.settlement_failures],
            "summary": asdict(summary), "report": summary.render()}


def _clean_error(error):
    # Provider errors occasionally include a URL with credentials or a copy of a key.
    message = str(error)
    for key, value in os.environ.items():
        if value and len(value) > 3 and any(token in key.upper() for token in ("KEY", "SECRET", "TOKEN", "PASSWORD")):
            message = message.replace(value, "[已隐藏]")
    message = re.sub(r"https?://\S+", "[服务地址]", message)
    return message[:1800]


def main():
    from tradingagents.portfolio import PortfolioContext

    # Keep the protocol on a dedicated descriptor. Even native vendor libraries
    # writing to fd 1 cannot inject protocol records into the parent process.
    channel = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

    write_lock = threading.Lock()

    def emit(message):
        with write_lock:
            channel.write(json.dumps(message, ensure_ascii=False) + "\n")
            channel.flush()

    def on_disconnect():
        # The server keeps stdin open for this worker's lifetime. A hard server
        # exit must also stop ongoing remote calls, even between progress events.
        os.read(sys.stdin.fileno(), 1)
        os._exit(1)

    try:
        packet = json.loads(sys.stdin.buffer.readline())
        threading.Thread(target=on_disconnect, daemon=True).start()
        args = packet["args"]
        book = PortfolioContext.model_validate(args["portfolio"]) if args["portfolio"] is not None else None
        if args["kind"] == "analysis":
            result = _run_analysis(args, packet["config"], book, packet["job_id"], emit)
        else:
            result = _run_backtest(args, packet["config"], book, emit)
        emit({"result": result})
    except Exception as exc:
        emit({"error": _clean_error(exc)})
    finally:
        channel.close()


if __name__ == "__main__":
    main()
