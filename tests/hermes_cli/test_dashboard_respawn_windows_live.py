"""Native capture/stop/respawn coverage for manual backends (#131864)."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest

from hermes_cli import dashboard_procs, main_dashboard

pytestmark = pytest.mark.platforms("windows")

_BACKEND = """
import json, os, pathlib, sys, time
ready = pathlib.Path(sys.argv[sys.argv.index('--ready') + 1])
with ready.open('a', encoding='utf-8') as stream:
    stream.write(json.dumps({'pid': os.getpid(), 'argv': sys.argv}) + '\\n')
time.sleep(300)
"""


def _wait_for_launches(path, count):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if path.exists():
            lines = path.read_text(encoding="utf-8-sig").splitlines()
            try:
                rows = [json.loads(line) for line in lines]
            except json.JSONDecodeError:
                rows = []
            if len(rows) >= count:
                return rows
        time.sleep(0.05)
    raise AssertionError(f"backend did not record {count} launches")


def _cleanup(ready):
    if ready.exists():
        for line in ready.read_text(encoding="utf-8-sig").splitlines():
            row = json.loads(line)
            try:
                proc = psutil.Process(row["pid"])
                if proc.cmdline()[1:] == row["argv"]:
                    proc.kill()
                    proc.wait(timeout=10)
            except psutil.NoSuchProcess:
                pass


def test_manual_backends_keep_argv_and_are_recovered_after_update(tmp_path, monkeypatch):
    script = tmp_path / "backend fixture.py"
    script.write_text(_BACKEND, encoding="utf-8")
    for kind in ("serve", "dashboard", "serve"):
        home = tmp_path / kind
        home.mkdir(exist_ok=True)
        monkeypatch.setenv("HERMES_HOME", str(home))
        ready = home / "launches.jsonl"
        ready.unlink(missing_ok=True)
        command = [sys.executable, str(script), "-m", "hermes_cli.main", kind,
                   "--host", "127.0.0.1", "--port", "9119", "--ready", str(ready)]
        original = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            backend_pid = _wait_for_launches(ready, 1)[0]["pid"]
            # Bound discovery to our real child; capture, environment ownership,
            # identity checks, taskkill and detached respawn all run for real.
            monkeypatch.setattr(main_dashboard, "_find_stale_dashboard_pids", lambda **_kw: [backend_pid])
            assert main_dashboard._dashboard_cmdline_for_pid(backend_pid)[1:] == command[1:]
            assert dashboard_procs._hermes_home_for_pid(backend_pid) == str(home)

            result = dashboard_procs._kill_stale_dashboard_processes(restart_managed=True)

            assert result["killed"] == [backend_pid]
            assert result["failed"] == result["unrecovered"] == []
            original.wait(timeout=10)
            relaunched = _wait_for_launches(ready, 2)[-1]
            assert relaunched["pid"] != backend_pid
            expected = command[1:] + (["--no-open"] if kind == "dashboard" else [])
            assert relaunched["argv"] == expected
            assert psutil.Process(relaunched["pid"]).is_running()
        finally:
            _cleanup(ready)
            if original.poll() is None:
                original.kill()
            original.wait(timeout=10)


def test_detached_respawn_survives_parent_exit_and_reports_startup_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    script = tmp_path / "backend fixture.py"
    script.write_text(_BACKEND, encoding="utf-8")
    dead = tmp_path / "failed backend.py"
    dead.write_text("raise SystemExit(7)\n", encoding="utf-8")
    ready = tmp_path / "launches.jsonl"
    good = [sys.executable, str(script), "-m", "hermes_cli.main", "serve", "--port", "9119",
            "--ready", str(ready)]
    bad = [sys.executable, str(dead), "-m", "hermes_cli.main", "serve", "--port", "9120"]
    request, result = tmp_path / "request.json", tmp_path / "result.json"
    request.write_text(json.dumps([good, bad]), encoding="utf-8")
    parent = tmp_path / "updater fixture.py"
    parent.write_text(
        "import json, pathlib, sys\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parents[2])!r})\n"
        "from hermes_cli.main_dashboard import _respawn_dashboard_processes\n"
        "commands = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig'))\n"
        "failed = _respawn_dashboard_processes(commands)\n"
        "pathlib.Path(sys.argv[2]).write_text(json.dumps(failed), encoding='utf-8')\n",
        encoding="utf-8",
    )
    try:
        completed = subprocess.run(
            [sys.executable, str(parent), str(request), str(result)], check=True,
            stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
            timeout=30,
        )
        child = _wait_for_launches(ready, 1)[0]
        assert psutil.Process(child["pid"]).is_running()
        assert json.loads(result.read_text(encoding="utf-8-sig")) == [bad]
        assert "code 7" in completed.stdout
    finally:
        _cleanup(ready)
