"""Local job lifecycle and access to the reports produced by TradingAgents."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
import uuid
from contextlib import suppress
from datetime import datetime
from pathlib import Path

from tradingagents.dataflows.files import locked
from tradingagents.dataflows.symbols import safe_ticker_component
from tradingagents.web.progress import finish_progress, initial_progress


def _now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def _validate(payload):
    from cli.models import AnalystType, AssetType
    from cli.prompts import (
        detect_asset_type,
        filter_analysts_for_asset_type,
        parse_analysis_date,
        parse_analysts,
        parse_ticker,
    )
    from tradingagents.portfolio import PortfolioContext

    if not isinstance(payload, dict):
        raise ValueError("任务参数必须是对象")
    kind = payload.get("kind")
    if kind not in ("analysis", "backtest"):
        raise ValueError("请选择单标的分析或历史回测")
    tickers = [payload.get("ticker")] if kind == "analysis" else payload.get("tickers")
    if isinstance(tickers, str):
        tickers = tickers.split(",")
    if not isinstance(tickers, list) or not tickers or not all(isinstance(t, str) for t in tickers):
        raise ValueError("请输入交易代码")
    tickers = list(dict.fromkeys(parse_ticker(t) for t in tickers))
    asset = payload.get("asset_type") or "auto"
    if asset == "auto":
        detected = {detect_asset_type(t) for t in tickers}
        if len(detected) != 1:
            raise ValueError("股票和加密资产请分别回测")
        asset = detected.pop()
    else:
        asset = AssetType(asset)
    requested = payload.get("analysts")
    if requested is None:
        analysts = filter_analysts_for_asset_type(list(AnalystType), asset)
    else:
        if not isinstance(requested, list) or not all(isinstance(a, str) for a in requested):
            raise ValueError("请选择参与研究的分析师")
        analysts = parse_analysts(",".join(requested), asset)
    book = payload.get("portfolio")
    if book is not None:
        book = PortfolioContext.model_validate(book).model_dump()
    args = {"kind": kind, "tickers": tickers, "asset_type": asset.value,
            "analysts": [a.value for a in analysts], "portfolio": book}

    def date(key):
        if not isinstance(payload.get(key), str):
            raise ValueError("请输入分析日期")
        return parse_analysis_date(payload[key])

    if kind == "analysis":
        args["date"] = date("date")
    else:
        args.update(start=date("start"), end=date("end"))
        if args["end"] < args["start"]:
            raise ValueError("结束日期早于开始日期")
        every = payload.get("every", 7)
        if type(every) is not int or every < 1:
            raise ValueError("采样间隔必须为正整数")
        args["every"] = every
        args["run_id"] = safe_ticker_component(payload.get("run_id") or uuid.uuid4().hex)
    return args


def _summary(job):
    return {k: v for k, v in job.items() if k not in ("events", "result", "parameters", "progress")}


def _append_event(events, event):
    events.append(event)
    if len(events) <= 350:
        return
    # Retain every analyst/manager report and as much debate as space allows.
    # A busy tool loop should evict older operational events before findings.
    for i, old in enumerate(events[:-1]):
        if old.get("kind") not in ("report", "debate"):
            del events[i]
            return
    for i, old in enumerate(events[:-1]):
        if old.get("kind") != "report":
            del events[i]
            return
    del events[0]


class JobManager:
    """One cancellable worker per local workbench, with metadata retained across restarts."""

    def __init__(self, directory=None):
        directory = Path(directory or Path.home() / ".tradingagents" / "web")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._owner = locked(directory / "jobs", wait=False)
        if not self._owner.__enter__():
            self._owner.__exit__(None, None, None)
            raise RuntimeError("另一个 Web 工作台已启动")
        self._lock = threading.RLock()
        db_path = directory / "jobs.sqlite3"
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        db_path.chmod(0o600)
        self._db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, summary TEXT, detail TEXT)")
        self._active = self._process = self._reader = None
        self._closed = False
        for job in self.list():
            if job["status"] == "running":
                self._finish(self.get(job["id"]), "failed", "工作台已关闭，任务中断")

    def _save(self, job):
        with self._db:
            self._db.execute(
                "INSERT OR REPLACE INTO jobs (id,summary,detail) VALUES (?,?,?)",
                (job["id"], json.dumps(_summary(job), ensure_ascii=False), json.dumps(job, ensure_ascii=False)),
            )

    def list(self):
        with self._lock:
            return [json.loads(row[0]) for row in self._db.execute("SELECT summary FROM jobs ORDER BY rowid DESC")]

    def get(self, job_id):
        with self._lock:
            row = self._db.execute("SELECT detail FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError("任务不存在")
            return json.loads(row[0])

    def start(self, payload, config, env=None):
        args = _validate(payload)
        with self._lock:
            if self._closed or self._process:
                raise RuntimeError("当前工作台正在运行任务，请在任务结束后再启动")
            job = {"id": uuid.uuid4().hex, "kind": args["kind"], "ticker": ", ".join(args["tickers"]),
                   "date": args.get("date") or f"{args['start']} ~ {args['end']}",
                   "run_id": args.get("run_id"), "status": "running", "started_at": _now(),
                   "finished_at": None, "stage": "正在启动", "error": None, "events": [], "result": None}
            job["progress"] = initial_progress(args)
            job["parameters"] = {**args}
            if args["kind"] == "analysis":
                job["parameters"]["ticker"] = job["parameters"].pop("tickers")[0]
            packet = json.dumps({"args": args, "config": config, "job_id": job["id"]}, ensure_ascii=False)
            self._save(job)
            try:
                process = subprocess.Popen(
                    [sys.executable, "-m", "tradingagents.web.worker"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    text=True, encoding="utf-8", env={**os.environ, **(env or {})},
                )
                self._process = process
                process.stdin.write(packet + "\n")
                process.stdin.flush()
                self._active = job
                self._reader = threading.Thread(target=self._watch, args=(process, job), daemon=True)
                self._reader.start()
            except (OSError, RuntimeError):
                if self._process:
                    self._process.kill()
                    self._process.wait()
                    self._process.stdin.close()
                    self._process.stdout.close()
                self._active = self._process = None
                self._finish(job, "failed", "无法启动分析进程")
                raise
            return self.get(job["id"])

    def _finish(self, job, status, error=None):
        job.update(status=status, finished_at=_now(), error=error,
                   stage={"completed": "已完成", "failed": "运行失败", "cancelled": "已取消"}[status])
        finish_progress(job)
        self._save(job)

    def _watch(self, process, job):
        result, error = None, None
        try:
            for line in process.stdout:
                message = json.loads(line)
                with self._lock:
                    if "stage" in message:
                        job["stage"] = message["stage"]
                        event = {"time": message.get("time") or _now(), "text": message["stage"]}
                        for key in ("agent_id", "kind", "phase", "round", "restored"):
                            if message.get(key) is not None:
                                event[key] = message[key]
                        if "progress" in message:
                            job["progress"] = message["progress"]
                        detail = message.get("detail")
                        if isinstance(detail, str) and detail:
                            event["detail"] = detail if len(detail) <= 6000 else detail[:5999] + "…"
                        _append_event(job["events"], event)
                        if "stats" in message:
                            job["stats"] = message["stats"]
                        self._save(job)
                    elif "result" in message:
                        result = message["result"]
                    elif "error" in message:
                        error = message["error"]
            process.wait()
        except (OSError, ValueError):
            error = "任务进程返回了无法读取的数据"
            process.kill()
            process.wait()
        finally:
            with self._lock:
                process.stdin.close()
                process.stdout.close()
                if job["status"] == "cancelled":
                    self._finish(job, "cancelled")
                elif result is not None:
                    job["result"] = result
                    if result.get("failures") and not (result.get("cells_run") or result.get("skipped")):
                        self._finish(job, "failed", "所有回测样本均失败，请查看回测结果")
                    else:
                        self._finish(job, "completed")
                else:
                    self._finish(job, "failed", error or "分析进程意外退出")
                self._process = self._active = None

    def cancel(self, job_id):
        with self._lock:
            if not self._active or self._active["id"] != job_id:
                return self.get(job_id)
            reader = self._reader
            if self._process.poll() is None:
                self._active["status"] = "cancelled"
                self._process.kill()
        reader.join()
        return self.get(job_id)

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            active = self._active
        if active:
            self.cancel(active["id"])
        with self._lock:
            self._db.close()
            self._owner.__exit__(None, None, None)


def _report_path(config, report_id, fmt):
    if fmt not in ("md", "html"):
        raise ValueError("报告格式应为 Markdown 或 HTML")
    root = (Path(config["results_dir"]) / "reports").resolve()
    if not isinstance(report_id, str) or not report_id or Path(report_id).name != report_id:
        raise KeyError("报告不存在")
    path = root / report_id / f"complete_report.{fmt}"
    if path.is_symlink() or path.parent.is_symlink() or path.resolve().parent.parent != root or not path.is_file():
        raise KeyError("报告不存在")
    return path


def read_report(config, report_id, format="md"):
    return _report_path(config, report_id, format).read_text(encoding="utf-8")


def list_reports(config):
    root = Path(config["results_dir"]) / "reports"
    reports = []
    for child in root.glob("*/complete_report.md"):
        with suppress(OSError, KeyError, UnicodeError):
            path = _report_path(config, child.parent.name, "md")
            with path.open(encoding="utf-8") as source:
                header = source.read(4096).split("\n## ", 1)[0].splitlines()
            values = {key: value for line in header if line.startswith("- ") and ": " in line
                      for key, value in [line[2:].split(": ", 1)]}
            ticker = header[0].removeprefix("# Trading Analysis Report: ").strip() if header else child.parent.name
            reports.append({"id": child.parent.name, "ticker": ticker, "title": f"{ticker} 分析报告",
                            "date": values.get("Analysis date", ""), "rating": values.get("Rating", ""),
                            "modified_at": datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(),
                            "has_html": (path.parent / "complete_report.html").is_file()})
    return sorted(reports, key=lambda item: item["modified_at"], reverse=True)
