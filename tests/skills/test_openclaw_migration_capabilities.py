"""Migration must disclose capabilities it cannot carry over (#131863)."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = (
    Path(__file__).resolve().parents[2]
    / "optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("openclaw_capabilities", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_channel_secret_references_respect_consent_and_source_authority(tmp_path):
    mod = _load()
    source = tmp_path / "openclaw source#1"
    source.mkdir()
    config = {
        "secrets": {"providers": {"teamstore": {"source": "store"}}},
        "channels": {
            "telegram": {"botToken": {"source": "store", "provider": "default", "id": "TG_TOKEN"}},
            "discord": {"accounts": {"default": {
                "token": {"source": "env", "id": "DISCORD_TOKEN"}, "allowFrom": ["100"],
            }}},
            "slack": {
                "botToken": {"source": "store", "provider": "teamstore", "id": "SLACK_TOKEN"},
                "appToken": "${SLACK_APP_TOKEN}", "allowFrom": ["U100"],
            },
        },
    }
    config_path = source / "openclaw.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    env_path = source / ".env"
    env_path.write_text(
        "TG_TOKEN=wrong-env-value\nDISCORD_TOKEN=discord-value\nSLACK_APP_TOKEN=slack-app-value\n",
        encoding="utf-8",
    )
    database = source / "state" / "openclaw.sqlite"
    database.parent.mkdir()
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE secret_store_entries (scope_kind TEXT, scope_id TEXT, "
                   "name TEXT, value TEXT, deleted_at_ms INTEGER)")
        db.executemany("INSERT INTO secret_store_entries VALUES (?, ?, ?, ?, ?)", [
            ("team", "", "TG_TOKEN", "telegram-value", None),
            ("identity", "other", "TG_TOKEN", "wrong-identity-value", None),
            ("team", "", "SLACK_TOKEN", "slack-bot-value", None),
            ("team", "", "DELETED_TOKEN", "deleted-value", 1),
        ])
    originals = {p: p.read_bytes() for p in (config_path, env_path, database)}
    expected = {
        "TELEGRAM_BOT_TOKEN": "telegram-value", "DISCORD_BOT_TOKEN": "discord-value",
        "SLACK_BOT_TOKEN": "slack-bot-value", "SLACK_APP_TOKEN": "slack-app-value",
    }
    for execute, consent in ((False, True), (True, False), (True, True)):
        target = tmp_path / f"target-{execute}-{consent}"
        target.mkdir()
        migrator = mod.Migrator(
            source_root=source, target_root=target, execute=execute,
            workspace_target=None, overwrite=False, migrate_secrets=consent, output_dir=None,
            selected_options={"secret-settings", "discord-settings", "slack-settings"},
        )
        report = migrator.migrate()
        added = {key for item in report["items"] for key in item["details"].get("added_keys", [])}
        assert set(expected).issubset(added) if consent else not set(expected).intersection(added)
        if execute:
            migrated = mod.parse_env_file(target / ".env")
            for key, value in expected.items():
                assert migrated.get(key) == (value if consent else None)
            assert migrated["DISCORD_ALLOWED_USERS"] == "100"
            assert migrated["SLACK_ALLOWED_USERS"] == "U100"
        else:
            assert not (target / ".env").exists()
        assert all(p.read_bytes() == before for p, before in originals.items())
        assert all(value not in json.dumps(report) for value in expected.values())

    # Plain channel tokens have the same consent boundary as references.
    config["channels"]["telegram"]["botToken"] = expected["TELEGRAM_BOT_TOKEN"]
    config["channels"]["discord"]["accounts"]["default"]["token"] = expected["DISCORD_BOT_TOKEN"]
    config["channels"]["slack"]["botToken"] = expected["SLACK_BOT_TOKEN"]
    config["channels"]["slack"]["appToken"] = expected["SLACK_APP_TOKEN"]
    config_path.write_text(json.dumps(config), encoding="utf-8")
    target = tmp_path / "plaintext-without-consent"
    report = mod.Migrator(
        source_root=source, target_root=target, execute=True, workspace_target=None,
        overwrite=False, migrate_secrets=False, output_dir=None,
        selected_options={"secret-settings", "discord-settings", "slack-settings"},
    ).migrate()
    assert not set(expected).intersection(mod.parse_env_file(target / ".env"))
    assert all(value not in json.dumps(report) for value in expected.values())

    # An explicit unresolved reference must never become a literal or fall back
    # to an unrelated .env/identity value, and the loss must be reported.
    config["channels"]["telegram"]["botToken"] = {"source": "store", "id": "DELETED_TOKEN"}
    config["channels"]["discord"]["accounts"]["default"]["token"] = {"source": "env", "id": "MISSING_TOKEN"}
    config["channels"]["slack"]["appToken"] = "${MISSING_TOKEN}"
    config["channels"]["slack"]["botToken"] = {"source": "exec", "id": "SLACK_TOKEN"}
    config_path.write_text(json.dumps(config), encoding="utf-8")
    target = tmp_path / "unresolved"
    report = mod.Migrator(
        source_root=source, target_root=target, execute=True, workspace_target=None,
        overwrite=False, migrate_secrets=True, output_dir=None,
        selected_options={"secret-settings", "discord-settings", "slack-settings"},
    ).migrate()
    assert not set(expected).intersection(mod.parse_env_file(target / ".env"))
    assert all(any(key in warning for warning in report["warnings"]) for key in expected)


@pytest.mark.parametrize("storage", ["json", "sqlite", "config", "mixed"])
def test_cron_archive_is_disclosed_in_cli_json_and_saved_report(tmp_path, storage):
    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    jobs = [{"id": f"job-{i}", "enabled": i < 15, "payload": {"message": f"task {i}"}}
            for i in range(24)]
    config = {"cron": {"enabled": True}}
    if storage == "config":
        config["cron"]["jobs"] = jobs
    elif storage in {"json", "mixed"}:
        store = source / "cron" / "jobs.json"
        store.parent.mkdir()
        store.write_text(json.dumps({"version": 1, "jobs": jobs}), encoding="utf-8")
        if storage == "mixed":
            config["cron"]["jobs"] = jobs[:2]
            database = source / "state" / "openclaw.sqlite"
            database.parent.mkdir()
            with sqlite3.connect(database) as db:
                db.execute("CREATE TABLE cron_jobs (job_id TEXT, enabled INTEGER, job_json TEXT)")
    else:
        database = source / "state" / "openclaw.sqlite"
        database.parent.mkdir()
        with sqlite3.connect(database) as db:
            db.execute("CREATE TABLE cron_jobs (job_id TEXT, enabled INTEGER, job_json TEXT)")
            db.executemany("INSERT INTO cron_jobs VALUES (?, ?, ?)",
                           [(job["id"], job["enabled"], json.dumps(job)) for job in jobs])
    (source / "openclaw.json").write_text(json.dumps(config), encoding="utf-8")
    originals = {p: p.read_bytes() for p in source.rglob("*") if p.is_file()}
    command = [sys.executable, str(SCRIPT_PATH), "--source", str(source), "--target", str(target),
               "--include", "cron-jobs"]
    dry = subprocess.run([*command, "--json"], capture_output=True, text=True, encoding="utf-8", check=True)
    preview = json.loads(dry.stdout)
    assert any("24" in w and "15" in w and "NOT migrated" in w for w in preview["warnings"])
    assert not target.exists()

    result = subprocess.run([*command, "--execute"], capture_output=True, text=True, encoding="utf-8", check=True)
    assert "NOT migrated" in result.stdout and "24" in result.stdout
    report_path = next(target.glob("migration/openclaw/*/report.json"))
    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    assert any("24" in w and "15" in w and "hermes cron" in w for w in report["warnings"])
    assert "NOT migrated" in report_path.with_name("summary.md").read_text(encoding="utf-8-sig")
    assert not (target / "cron" / "jobs.json").exists()
    assert all(p.read_bytes() == before for p, before in originals.items())
