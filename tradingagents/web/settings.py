"""Persistent settings for the local web workstation.

Only the worker gets credential values. The browser gets presence flags and sends
only replacements or explicit removals. CLI and SDK defaults are read as usual.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from tradingagents.dataflows.files import locked
from tradingagents.default_config import build_default_config
from tradingagents.llm_clients.api_key_env import PROVIDER_API_KEY_ENV
from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS

SETTINGS_PATH = Path.home() / ".tradingagents" / "web" / "settings.json"

CREDENTIALS = sorted({item for item in PROVIDER_API_KEY_ENV.values() if item} | {
    "ALPHA_VANTAGE_API_KEY", "FRED_API_KEY", "TYPESAFE_API_KEY", "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GEMINI_API_KEY",
})
ENVIRONMENT = (
    "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT_NAME", "OPENAI_API_VERSION",
    "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "OLLAMA_BASE_URL",
    "SEC_EDGAR_USER_AGENT", "TYPESAFE_DEFAULT_MODEL", "TYPESAFE_BASE_URL",
)
INTEGER_MIN = {
    "max_debate_rounds": 1, "max_risk_discuss_rounds": 1, "max_tool_rounds": 1,
    "max_recur_limit": 1, "llm_max_retries": 0, "max_tokens": 1, "holding_period_days": 1,
    "memory_log_max_entries": 1, "news_article_limit": 1, "global_news_article_limit": 1,
    "global_news_lookback_days": 1,
}
OPTIONAL = {
    "quick_think_provider", "deep_think_provider", "backend_url", "quick_think_backend_url",
    "deep_think_backend_url", "openai_reasoning_effort", "google_thinking_level",
    "anthropic_effort", "temperature", "llm_max_retries", "max_tokens",
    "benchmark_ticker", "memory_log_max_entries",
}
PATHS = {"results_dir", "data_cache_dir", "memory_log_path"}


@lru_cache(maxsize=1)
def _routes():
    from tradingagents.dataflows.router import TOOLS_CATEGORIES, VENDOR_METHODS
    tools = {tool: list(vendors) for tool, vendors in VENDOR_METHODS.items()}
    categories = {
        key: sorted({vendor for tool in entry["tools"] for vendor in tools[tool]})
        for key, entry in TOOLS_CATEGORIES.items()
    }
    return tools, categories


def _read():
    try:
        value = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(value, dict):
        raise ValueError("本地 Web 配置文件格式有误")
    return value


def _text(value, key):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        raise ValueError(f"{key} 需要填写单行文本")
    return value.strip()


def _url(value, key):
    url = urlsplit(value)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError(f"{key} 需要填写 HTTP(S) 服务地址；密钥请填入凭证栏")
    return value


def _vendor_map(values, allowed):
    result = {}
    if not isinstance(values, dict) or set(values) - allowed.keys():
        raise ValueError("数据路由中包含未知的分类或工具")
    for name, value in values.items():
        chain = [part.strip() for part in _text(value, name).split(",")]
        if chain != ["default"] and (set(chain) - set(allowed[name]) or len(set(chain)) != len(chain)):
            raise ValueError(f"{name} 可使用 {', '.join(allowed[name])} 或 default")
        result[name] = ",".join(chain)
    return result


def _config_value(key, value):
    if value is None or value == "":
        if key in OPTIONAL:
            return None
        raise ValueError(f"{key} 不能为空")
    if key in INTEGER_MIN:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError(f"{key} 需要填写整数")
        try:
            number = int(value)
        except ValueError:
            raise ValueError(f"{key} 需要填写整数") from None
        if number < INTEGER_MIN[key]:
            raise ValueError(f"{key} 最小为 {INTEGER_MIN[key]}")
        return number
    if key == "temperature":
        try:
            number = float(value)
        except (ValueError, TypeError):
            raise ValueError("采样温度需要填写数字") from None
        if isinstance(value, bool) or not math.isfinite(number) or not 0 <= number <= 2:
            raise ValueError("采样温度范围为 0 至 2")
        return number
    if key == "checkpoint_enabled":
        if not isinstance(value, bool):
            raise ValueError("断点续跑应为开关值")
        return value
    if key in {"data_vendors", "tool_vendors"}:
        tools, categories = _routes()
        return _vendor_map(value, tools if key == "tool_vendors" else categories)
    if key == "benchmark_map":
        if not isinstance(value, dict) or not all(isinstance(k, str) and _text(v, key) for k, v in value.items()):
            raise ValueError("基准映射需为后缀与代码组成的 JSON 对象")
        return {k.strip().upper(): v.strip() for k, v in value.items()}
    if key == "global_news_queries":
        if not isinstance(value, list) or not value or not all(_text(v, key) for v in value):
            raise ValueError("请至少保留一条有效的新闻检索词")
        return [item.strip() for item in value]
    value = _text(value, key)
    if not value:
        if key in OPTIONAL:
            return None
        raise ValueError(f"{key} 不能为空")
    if key.endswith("_provider") and value not in PROVIDER_API_KEY_ENV:
        raise ValueError("请选择支持的模型服务商")
    if key.endswith("backend_url"):
        return _url(value, key)
    if key in PATHS:
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise ValueError(f"{key} 需要填写本机绝对路径")
        if key == "memory_log_path" and path.suffix.lower() != ".md":
            raise ValueError("交易记忆路径应指向 Markdown 文件（.md）")
        if path.exists() and (path.is_dir() if key == "memory_log_path" else not path.is_dir()):
            raise ValueError(f"{key} 的路径类型不匹配")
        return str(path)
    return value


def _runtime(stored):
    config = build_default_config()
    config.update(stored.get("config", {}))
    # Environment overrides of defaults that are None arrive as strings.
    for key in (*INTEGER_MIN, "temperature"):
        if config.get(key) is not None:
            config[key] = _config_value(key, config[key])
    env = {k: os.environ[k] for k in (*CREDENTIALS, *ENVIRONMENT) if k in os.environ}
    env.update(stored.get("environment", {}))
    env.update(stored.get("credentials", {}))
    return config, env


def runtime_settings():
    """Snapshot suitable for one job. Never serialize the environment to a browser."""
    return _runtime(_read())


def _public(stored):
    config, env = _runtime(stored)
    tools, categories = _routes()
    environment = {key: env.get(key, "") for key in ENVIRONMENT}
    # Older .env files may embed API keys in an endpoint's query or userinfo.
    # Keep the endpoint intact for the worker, and keep it off the public wire.
    hidden = []
    for mapping in (config, environment):
        for key, value in mapping.items():
            if value and key.lower().endswith(("url", "endpoint")):
                try:
                    _url(value, key)
                except ValueError:
                    mapping[key] = ""
                    hidden.append(key)
    return {
        "config": config,
        "credentials": {k: bool(env.get(k)) for k in CREDENTIALS},
        "environment": environment,
        "hidden_endpoints": hidden,
        "schema": {
            "providers": list(PROVIDER_API_KEY_ENV),
            "provider_keys": PROVIDER_API_KEY_ENV,
            "models": {p: {tier: [m for _, m in options if m != "custom"]
                           for tier, options in tiers.items()} for p, tiers in MODEL_OPTIONS.items()},
            "categories": categories,
            "tools": tools,
        },
    }


def get_settings():
    return _public(_read())


def save_settings(payload):
    if not isinstance(payload, dict) or set(payload) - {"config", "environment", "credentials"}:
        raise ValueError("配置请求格式有误")
    defaults = build_default_config()
    updates = {}
    for group, fields in payload.items():
        allowed = {"config": defaults, "environment": ENVIRONMENT, "credentials": CREDENTIALS}[group]
        if not isinstance(fields, dict) or set(fields) - set(allowed):
            raise ValueError("含有未知配置项")
        updates[group] = {}
        for key, value in fields.items():
            if group == "config":
                value = _config_value(key, value)
            else:
                value = _text(value, key)
                if value and group == "environment" and key.endswith(("URL", "ENDPOINT")):
                    _url(value, key)
            updates[group][key] = value

    SETTINGS_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with locked(SETTINGS_PATH):
        stored = _read()
        for group, fields in updates.items():
            stored.setdefault(group, {}).update(fields)
        result = _public(stored)
        # Each tool must have at least one usable vendor after category fallback.
        from tradingagents.dataflows.router import TOOLS_CATEGORIES
        cfg = result["config"]
        for category, info in TOOLS_CATEGORIES.items():
            for tool in info["tools"]:
                chain = cfg["tool_vendors"].get(tool, cfg["data_vendors"].get(category, "default"))
                if chain != "default" and not set(chain.split(",")) & set(result["schema"]["tools"][tool]):
                    raise ValueError(f"{tool} 在当前分类的数据源中没有可用来源")
        fd, tmp = tempfile.mkstemp(dir=SETTINGS_PATH.parent, prefix=".settings-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(stored, handle, ensure_ascii=False, indent=2, allow_nan=False)
            os.replace(tmp, SETTINGS_PATH)
        finally:
            Path(tmp).unlink(missing_ok=True)
    return result
