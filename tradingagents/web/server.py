"""Serve the research workstation on the local loopback interface."""
import argparse
import json
import logging
import re
import threading
import webbrowser
from contextlib import suppress
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import urlopen

from tradingagents import __version__
from tradingagents.graph.checkpointer import clear_all_checkpoints
from tradingagents.memory.log import TradingMemoryLog
from tradingagents.web import jobs, settings
from tradingagents.web.auth import WebLogin

STATIC = Path(__file__).parent / "static"
MEDIA = {".js": "application/javascript", ".html": "text/html", ".css": "text/css",
         ".svg": "image/svg+xml"}
MAX_BODY = 512 * 1024


class Workstation(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port):
        super().__init__(("127.0.0.1", port), Handler)
        self.jobs = jobs.JobManager()
        self.auth = WebLogin()
        self.operations = threading.Lock()

    def server_close(self):
        if hasattr(self, "jobs"):
            self.jobs.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server: Workstation
    timeout = 15

    def log_message(self, *args):
        # Callback URLs and report identifiers should stay out of the access log.
        pass

    def reply(self, data, media="application/json", status=200, *, report=False):
        if media == "application/json":
            data = json.dumps(data, ensure_ascii=False, allow_nan=False)
        content = data if isinstance(data, bytes) else data.encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", f"{media}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "sandbox; default-src 'none'; style-src 'unsafe-inline'" if report else
                         "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; "
                         "form-action 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(content)

    def dispatch(self):
        host = self.headers.get("Host")
        port = self.server.server_port
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if host not in allowed or self.headers.get("Origin") not in (None, f"http://{host}"):
            return self.reply({"error": "仅允许本机工作台访问。"}, status=403)
        url = urlsplit(self.path)
        path = unquote(url.path)
        method = self.command
        if method == "GET" and not path.startswith("/api/"):
            name = "index.html" if path == "/" else path.removeprefix("/static/")
            if not re.fullmatch(r"[a-zA-Z0-9_-]+\.(html|css|js|svg)", name) or not (STATIC / name).is_file():
                raise KeyError
            return self.reply((STATIC / name).read_bytes(), MEDIA[Path(name).suffix])
        body = {}
        if method in ("POST", "PUT"):
            if self.headers.get_content_type() != "application/json":
                return self.reply({"error": "需要 JSON 请求。"}, status=415)
            length = int(self.headers.get("Content-Length", -1))
            if not 0 <= length <= MAX_BODY:
                return self.reply({"error": "请求长度超出限制。"}, status=413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求必须是对象。")
        if method == "GET" and path == "/api/health":
            return self.reply({"app": "TradingAgents Web", "version": __version__})
        if method == "GET" and path == "/api/asset-type":
            from cli.prompts import detect_asset_type, parse_ticker
            ticker = parse_ticker(parse_qs(url.query).get("ticker", [""])[0])
            return self.reply({"asset_type": detect_asset_type(ticker).value})
        if path == "/api/settings":
            if method == "GET":
                return self.reply(settings.get_settings())
            if method == "PUT":
                return self.reply(settings.save_settings(body))
        if path == "/api/auth" and method == "GET":
            return self.reply(self.server.auth.state())
        if method == "GET" and path == "/api/openrouter/models":
            from cli.prompts import _fetch_openrouter_models
            models = _fetch_openrouter_models()
            if not models:
                return self.reply({"error": "无法读取 OpenRouter 模型列表，可手动填写模型 ID。"}, status=502)
            return self.reply({"models": models})
        if method == "GET" and path == "/api/auth/models":
            from tradingagents.llm_clients.chatgpt_auth import list_models
            return self.reply({"models": list_models()})
        if method == "POST" and path == "/api/auth/login":
            return self.reply(self.server.auth.login())
        if method == "POST" and path == "/api/auth/logout":
            return self.reply(self.server.auth.logout())
        if method == "POST" and path == "/api/auth/callback":
            return self.reply(self.server.auth.callback(body.get("url")))
        manager = self.server.jobs
        if path == "/api/jobs" and method == "GET":
            return self.reply(manager.list())
        job_route = re.fullmatch(r"/api/jobs/([a-zA-Z0-9_-]+)(/cancel)?", path)
        if job_route:
            job_id, cancel = job_route.groups()
            if method == "GET" and not cancel:
                job = manager.get(job_id)
                if parse_qs(url.query).get("view") == ["progress"]:
                    # The dashboard needs stage evidence, not the archived documents or holdings.
                    params = job.get("parameters") or {}
                    job["parameters"] = {key: value for key, value in params.items() if key != "portfolio"}
                    if result := job.get("result"):
                        job["result"] = {key: result[key] for key in
                                         ("rating", "report_id", "cells_run", "skipped", "summary") if key in result}
                return self.reply(job)
            if method == "POST" and cancel:
                return self.reply(manager.cancel(job_id))
        config, env = settings.runtime_settings()
        if path == "/api/jobs" and method == "POST":
            with self.server.operations:
                return self.reply(manager.start(body, config, env), status=201)
        if path == "/api/checkpoints/clear" and method == "POST":
            with self.server.operations:
                if any(j["status"] in ("queued", "running") for j in manager.list()):
                    raise RuntimeError("请在当前任务结束后清理断点。")
                return self.reply({"count": clear_all_checkpoints(config["data_cache_dir"])})
        if method == "GET" and path == "/api/reports":
            return self.reply(jobs.list_reports(config))
        if method == "GET" and path.startswith("/api/reports/"):
            fmt = parse_qs(url.query).get("format", ["md"])[0]
            if fmt not in ("md", "html"):
                raise ValueError("报告格式无效。")
            report = jobs.read_report(config, path.removeprefix("/api/reports/"), fmt)
            return self.reply(report, "text/html" if fmt == "html" else "text/plain", report=True)
        if path == "/api/memory" and method == "GET":
            entries = TradingMemoryLog(config).load_entries()
            return self.reply({"entries": entries, "text": "\n\n".join(
                f"[{e['date']} | {e['ticker']} | {e['rating']}]\n{e['decision']}\n{e['reflection']}"
                for e in entries)})
        if path == "/api/overview" and method == "GET":
            reports = jobs.list_reports(config)
            entries = TradingMemoryLog(config).load_entries()
            keys = ("llm_provider", "quick_think_llm", "deep_think_llm", "quick_think_provider",
                    "deep_think_provider", "output_language", "checkpoint_enabled")
            return self.reply({"reports": reports[:4], "report_count": len(reports),
                               "jobs": manager.list(), "memory_count": len(entries),
                               "config": {k: config.get(k) for k in keys}, "version": __version__})
        raise KeyError

    def handle_request(self):
        try:
            self.dispatch()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (KeyError, FileNotFoundError):
            self.reply({"error": "找不到该资源。"}, status=404)
        except (TypeError, ValueError) as exc:
            self.reply({"error": str(exc)}, status=400)
        except RuntimeError as exc:
            self.reply({"error": str(exc)}, status=409)
        except Exception:
            logging.exception("Workstation request failed")
            self.reply({"error": "读取或保存失败，请查看启动窗口的错误信息。"},
                       status=HTTPStatus.INTERNAL_SERVER_ERROR)

    do_GET = do_POST = do_PUT = handle_request


def main():
    parser = argparse.ArgumentParser(description="TradingAgents 本机研究工作台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="在浏览器中打开")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    try:
        server = Workstation(args.port)
    except RuntimeError as exc:
        parser.exit(1, f"{exc}\n")
    except OSError as exc:
        try:
            with urlopen(url + "/api/health", timeout=2) as response:
                existing = json.load(response)["app"] == "TradingAgents Web"
        except (URLError, OSError, KeyError, ValueError):
            existing = False
        if existing and args.open:
            webbrowser.open(url)
            return
        parser.exit(1, f"无法启动 {url}，请检查端口或使用 --port 指定其他端口。{exc}\n")
    with server:
        url = f"http://127.0.0.1:{server.server_port}"
        print(f"TradingAgents 研究工作台已启动  {url}\n按 Ctrl+C 停止。", flush=True)
        if args.open:
            webbrowser.open(url)
        with suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == "__main__":
    main()
