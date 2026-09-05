"""Persist wire context without changing another turn's cached prefix."""

from types import SimpleNamespace

import pytest

from agent.session_persistence import SessionPersistenceMixin
from agent.turn_context import _stamp_api_content_sidecar, compose_user_api_content
from hermes_state import SessionDB


@pytest.mark.parametrize("compacted", [False, True])
def test_early_persist_replays_exact_context_without_rewriting_identical_turn(
    tmp_path, compacted
):
    path = tmp_path / "state.db"
    db = SessionDB(db_path=path)
    try:
        db.create_session("session", source="cli")
        old = "ok\n\nprevious context"
        db.append_message("session", "user", content="ok", api_content=old)
        db.append_message("session", "assistant", content="done")
        current = {"role": "user", "content": "ok"}
        agent = SessionPersistenceMixin()
        agent._session_db = db
        agent._session_db_created = True
        agent.session_id = "session"
        agent._last_compaction_in_place = compacted
        if compacted:
            db.archive_and_compact(
                "session",
                [
                    {"role": "user", "content": "ok", "api_content": old},
                    {"role": "assistant", "content": "done"},
                    current,
                ],
            )
        else:
            # Exercise the same flush used by the CLI close safety net. The real
            # batch writer must stamp the committed row identity onto this dict.
            assert agent._flush_messages_to_session_db([current]) is True
            assert current["_db_persisted"] is True
            assert current["_row_id"] == db.get_messages("session")[-1]["id"]
        _stamp_api_content_sidecar(
            agent,
            [current],
            0,
            "remember this",
            "plugin context",
            preflight_compressed=compacted,
        )
    finally:
        db.close()
    reopened = SessionDB(db_path=path)
    try:
        users = [
            m
            for m in reopened.get_messages_as_conversation("session")
            if m["role"] == "user"
        ]
        assert users[0]["api_content"] == old
        assert users[-1]["content"] == "ok"
        assert users[-1]["api_content"] == compose_user_api_content(
            "ok", "remember this", "plugin context"
        )
    finally:
        reopened.close()


def test_backfill_guards_preserve_other_rows_and_accept_safe_unicode(tmp_path):
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session("session", source="cli")
        old = "ok\n\nprevious context"
        archived_id = db.append_message("session", "user", content="ok", api_content=old)
        agent = SimpleNamespace(_session_db=db, session_id="session")
        for marker in ({}, {"_db_persisted": True}, {"_row_id": True}, {"_row_id": -1}):
            current = {"role": "user", "content": "ok", **marker}
            _stamp_api_content_sidecar(
                agent, [current], 0, "new context", "", preflight_compressed=False
            )
            assert db.get_messages_as_conversation("session")[0]["api_content"] == old

        db.archive_and_compact("session", [{"role": "user", "content": "ok", "api_content": old}])
        active_id = db.get_messages("session")[-1]["id"]
        assistant_id = db.append_message("session", "assistant", content="ok")
        db.create_session("other", source="cli")
        other_id = db.append_message("other", "user", content="ok", api_content=old)
        before = db.get_messages("session", include_inactive=True)
        other_before = db.get_messages("other")
        for session_id, row_id, content in (
            ("other", active_id, "ok"), ("session", other_id, "ok"),
            ("session", active_id, "changed"), ("session", assistant_id, "ok"),
            ("session", archived_id, "ok"), ("session", other_id + 1000, "ok"),
            ("session", True, "ok"), ("session", -1, "ok"),
            ("session", str(active_id), "ok"), ("", active_id, "ok"),
        ):
            assert db.set_message_api_content(session_id, row_id, content, "wrong context") == 0
        assert db.get_messages("session", include_inactive=True) == before
        assert db.get_messages("other") == other_before

        # sqlite cannot encode a lone surrogate: the successful write must scrub
        # it without altering the display content or another row's sidecar.
        assert db.set_message_api_content("session", active_id, "ok", "prefix\ud800suffix") == 1
        after = db.get_messages("session", include_inactive=True)
        changed = next(row for row in after if row["id"] == active_id)
        assert changed["api_content"].startswith("prefix")
        assert changed["api_content"].endswith("suffix")
        changed["api_content"].encode("utf-8", errors="strict")
        changed["api_content"] = old
        assert after == before
    finally:
        db.close()
