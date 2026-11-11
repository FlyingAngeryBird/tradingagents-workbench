"""Bridge the existing ChatGPT loopback login to the settings page."""
from queue import Queue
from threading import RLock, Thread

from tradingagents.llm_clients import chatgpt_auth


class WebLogin:
    def __init__(self):
        self._lock = RLock()
        self._status = "idle"
        self._url = ""
        self._error = ""
        self._lines = None

    def state(self):
        with self._lock:
            return {"account": chatgpt_auth.signed_in_as(), "url": self._url,
                    "status": self._status, "error": self._error}

    def login(self):
        with self._lock:
            if self._status != "pending":
                self._status, self._url, self._error = "pending", "", ""
                self._lines = Queue()
                Thread(target=self._sign_in, args=(self._lines,), daemon=True).start()
            return self.state()

    def _sign_in(self, lines):
        def say(message):
            with self._lock:
                if message.startswith(chatgpt_auth.AUTHORIZE_URL + "?"):
                    self._url = message
                elif message.startswith("That is not"):
                    self._error = "回调地址不匹配，请粘贴本次授权后的完整地址。"

        def read_line():
            line = lines.get()
            if line is None:
                raise EOFError
            return line

        status, error = "error", "登录未能完成，请重试。"
        try:
            chatgpt_auth.sign_in(say=say, read_line=read_line)
            status, error = "success", ""
        except (RuntimeError, OSError, ValueError) as exc:
            status, error = "error", str(exc)
        finally:
            lines.put(None)
            with self._lock:
                self._url, self._lines = "", None
                self._status, self._error = status, error

    def callback(self, url):
        with self._lock:
            if not self._lines or not isinstance(url, str) or not url:
                raise ValueError("请先开始登录，再粘贴回调地址。")
            self._lines.put(url)
            return self.state()

    def logout(self):
        with self._lock:
            if self._status == "pending":
                raise ValueError("请先完成本次登录。")
            result = chatgpt_auth.sign_out()
            self._status, self._error = "idle", ""
            response = self.state()
            response["outcome"] = result
            return response
