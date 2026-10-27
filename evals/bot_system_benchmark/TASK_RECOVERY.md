# Completion and recovery fault contracts

This protocol compares the previous draft, `789ac877`, with the completion and
recovery changes. It is separate from the OpenBot discovery/queue comparison and
does not provide an OpenBot task-completion score or an overall agent ranking.

The fixtures are written by the contributor, small, targeted, and unblinded.
Scripted responses deliberately exercise failure paths; this is not a measurement
of a real model's ability or probability of solving normal user tasks.

## Fixed cases and acceptance criteria

| Case | Actual execution and acceptance check |
|---|---|
| Premature final | Real AIAgent, HTTP client and file tools; both requested files must contain their exact specified bytes before the next user turn. The provider deliberately returns an early final, with a fixed continuation available. |
| Already complete | Both files have exact contents; a satisfied checklist adds no continuation. |
| Blocked | The response explains missing user input; no output files are fabricated. |
| Cancelled | Both items are cancelled at the user's request; exactly two ordinary requests, no continuation. |
| Historical list | A status-only turn with old pending work takes one request and performs no writes. |
| Exhausted budget | Two allowed iterations, no files produced; the final explicitly reports unfinished work and unverified completion. |
| Invalid MCP reply | An owned stdio server commits a SQLite row, then returns malformed MCP content; the real SDK and production handler must report unknown outcome plus required reconciliation, with exactly one committed effect. |
| Successful MCP reply | Same server returns valid content; exactly one effect, success, no uncertainty flag. |

Every completion case also checks that previously sent message rows stay byte
equivalent in later requests, and tool schemas stay unchanged. The premature-final
case resumes for a status-only user turn to check reset behavior. Deferred
`todo_list` is invoked through the advertised `tool_call` bridge in both arms.
Artifact acceptance is captured before the resumed turn.

Run three fresh subprocess repetitions per case and arm, in a fixed shuffled
order (seed `20261027`), with a 45-second deadline per launch. Keep failed cases,
exceptions and deadlines in the receipt; no file retry or best-of selection.
The runner verifies every tracked baseline blob against the old Git commit
(normalizing the declared PowerShell CRLF exports back to Git's LF storage) and
requires a clean measured after tree. Added harness/test files in the baseline
archive do not change its production implementation. No inference is paid for.

```sh
python evals/bot_system_benchmark/run_task_recovery.py \
  --before /path/to/unchanged-789ac877-archive \
  --after /path/to/clean-measured-checkout \
  --output /path/to/raw-receipts.json
```

Additional canonical regression probes inject timeout, interruption, invalid
reply, and an OAuth recovery followed by a committed write and lost reply. They
use a real SQLite effect oracle and a controlled in-process RPC boundary.
Read-only timeouts, pre-dispatch failures, successful replies and application
errors are negative controls. Shared-budget tests use atomic reservations across
ten ordinary threads, real child construction with a constructor double, local
caps, owned refunds, an inherited old pool and a fresh root-turn pool. These do
not run model subagents or measure task quality/cost savings.

## Scope of the changes

The default completion continuation is bounded to one per turn and never grants
permission or extends the iteration allowance. Checklist status is a self-report,
not an acceptance oracle. A model can still mark a task complete incorrectly.
Unknown MCP outcomes require inspecting external state; the change provides no
exactly-once ledger or cross-process crash recovery. Existing annotated read-only
retry and pre-dispatch OAuth recovery semantics are retained. The optional shared
iteration pool is not a cap on physical model attempts, paid tools or dollars.
