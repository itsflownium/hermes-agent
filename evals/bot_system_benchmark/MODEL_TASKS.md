# Actual model task protocol

Use the user's authorized DeepSeek V4.1 Flash model (`deepseek/deepseek-v4.1-flash`)
through Nous Portal for original Hermes `c714c424`, updated Hermes and unchanged
OpenBot `f91535fb` with its real AgentService/Pi runtime. The total authorized model
spending cap is $5, shared across attempts. No separate provider account is used.

`model_tasks.py` fixes the prompts, input files and acceptance checks before runs:

| Task | Required outcome |
|---|---|
| Data summary | Deduplicate paid orders; correct JSON totals and CSV rows; preserve input |
| Config migration | Correct schema migration, preserve unrelated values/original file, migration note |
| Code repair | Independent five-test suite passes, test source unchanged, saved test output |
| Transient recovery | Retry exit 75 exactly once, correct report/status, helper unchanged |
| User correction | Two actual user turns; update 17 to 43 and record the change |
| Missing input | Explain the missing source/columns, no fabricated source/report |

Run six tasks, three variants and two fresh-process repetitions: 36 planned
launches in a fixed shuffle (seed 20261027). Keep every admission, timeout, transport
error and failure. A passing artifact is insufficient if the runtime ends in a
failure. These authored cases are unblinded and small; repeated runs are not
independent estimates of general task success probability.

Both native loops use a local proxy to the same actual Nous model. It sets
temperature 0, disables reasoning, caps each response at 2,048 tokens and buffers
the same upstream nonstreaming response into SSE when required by a native client.
The proxy never scripts model decisions. System prompts, tool schemas and native
tools differ. Every variant has a common cap of 16 model requests per launch
(shared by both turns in the correction task); Hermes also retains its ordinary
16-iteration limit. The existing 150-second per-turn deadline applies to both.
Hermes enables file, terminal and checklist tools in actual managed
Bot Chats, without preloaded checklists. OpenBot runs its native Pi tools. Memory,
project context and delegation are excluded from these task fixtures. Work stays
inside temporary local workspaces; no external task action or package install is
requested. This does not test the desktop UI or every product capability.

The proxy stores no credentials in the task workers. It rejects oversized requests
and disallows other upstream hosts/models. Before each billable request, it reserves
a conservative amount against the shared persistent ledger: UTF-8 body bytes plus
8,192 overhead tokens and the output cap, using doubled current/original advertised
catalog prices. Reservations are never refunded. It stops at $4.50 reserved, leaving
headroom below the $5 authority, or 400 requests. Usage and any returned cost are
retained; advertised-price estimates are not invoices. The same ledger must be used
for any diagnostic/repeated attempts. A budget stop stays visible and does not count
as a passing task.

Capture all output artifacts/hashes, independent check output, native final/queue
states, model responses, usage, model IDs, tool calls/results and request hashes.
Omit authorization headers and production system-prompt text. Retain every failed
task when fixing a real defect. Do not change prompts, grading rules or select a
best attempt to claim a win. Report individual task results and gaps. Elapsed times
include different native setup work and proxy buffering; no product speed ranking
or weighted overall bot score follows.
