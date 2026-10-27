"""One completion review for Bot Chat file work that has no authored checklist."""

from __future__ import annotations


def artifact_completion_nudge(agent) -> str | None:
    if getattr(agent, "_artifact_completion_reviewed", False) is True or not getattr(
        agent, "_turn_file_mutation_paths", None
    ):
        return None
    from tools.bot_mode_dm import message_agent_authorized

    if not message_agent_authorized(agent):
        return None
    from hermes_cli.config import load_config_readonly

    if (load_config_readonly().get("bot_mode") or {}).get(
        "completion_review", True
    ) is not True:
        return None
    agent._artifact_completion_reviewed = True
    return (
        "[System note: Before finishing this Bot Chat task, review the original user's request against "
        "the actual tool results and outputs you created. Check every requested deliverable, including "
        "supporting files and delivery steps; a successful edit alone does not prove the entire task is complete. "
        "If something requested is missing, finish it within the existing permissions and iteration budget. "
        "If blocked, explain the blocker and what remains. Do not invent verification, create unnecessary work, "
        "or repeat external actions whose outcomes are unknown. If everything is already satisfied, give the "
        "final answer now. This is the only file-completion review reminder for this turn.]"
    )
