"""Regression coverage for the local workstation's write-only credentials."""
import json
import os
from concurrent.futures import ThreadPoolExecutor

import pytest

from tradingagents.web import settings


@pytest.fixture
def local_path(tmp_path, monkeypatch):
    path = tmp_path / "web" / "settings.json"
    monkeypatch.setattr(settings, "SETTINGS_PATH", path)
    return path


def test_secret_round_trip_preserves_inherited_settings(local_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "inherited-test-key")
    public = settings.save_settings({"credentials": {"OPENAI_API_KEY": "private-test-key"}})
    assert public["credentials"]["OPENAI_API_KEY"]
    assert public["credentials"]["FRED_API_KEY"]
    assert "private-test-key" not in json.dumps(public)
    assert "inherited-test-key" not in json.dumps(public)
    assert "inherited-test-key" not in local_path.read_text()
    if os.name != "nt":
        assert local_path.stat().st_mode & 0o777 == 0o600
    settings.save_settings({"config": {"temperature": 0.75}})
    assert settings.runtime_settings()[1]["OPENAI_API_KEY"] == "private-test-key"
    settings.save_settings({"credentials": {"FRED_API_KEY": ""}})
    assert not settings.get_settings()["credentials"]["FRED_API_KEY"]
    assert settings.runtime_settings()[1]["FRED_API_KEY"] == ""
    assert os.environ["FRED_API_KEY"] == "inherited-test-key"


def test_private_endpoint_in_env_stays_out_of_public_view(local_path, monkeypatch):
    url = "https://example.invalid/v1?token=test-secret"
    monkeypatch.setenv("TRADINGAGENTS_LLM_BACKEND_URL", url)
    public = settings.get_settings()
    assert url not in json.dumps(public)
    assert "backend_url" in public["hidden_endpoints"]
    assert settings.runtime_settings()[0]["backend_url"] == url


def test_failed_change_preserves_entire_previous_snapshot(local_path):
    settings.save_settings({"config": {"max_debate_rounds": 3}})
    before = local_path.read_bytes()
    with pytest.raises(ValueError, match="get_fundamentals"):
        settings.save_settings({"config": {"data_vendors": {"fundamental_data": "sec_edgar"}},
                                "credentials": {"FRED_API_KEY": "discard-me"}})
    assert local_path.read_bytes() == before


def test_concurrent_disjoint_patches_survive(local_path):
    changes = [{"config": {"quick_think_llm": "model-a"}},
               {"config": {"deep_think_llm": "model-b"}},
               {"environment": {"AWS_REGION": "us-east-1"}}]
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(settings.save_settings, changes))
    cfg, env = settings.runtime_settings()
    assert (cfg["quick_think_llm"], cfg["deep_think_llm"], env["AWS_REGION"]) == (
        "model-a", "model-b", "us-east-1",
    )
