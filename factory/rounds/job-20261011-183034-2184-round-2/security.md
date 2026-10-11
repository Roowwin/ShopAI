VERDICT: PASS

Job job-20261011-183034-2184 round 2. Delta reviewed: `8bb3fde..50d7869` (3 files). Every round-1 blocker is cleared.

## 1. Fix landed at the source; render invariant restored
The chat block is in the template (`templates/rfo.conf.template:57-62`) **and** in the re-rendered `conf.d/rfo.conf:61-62`. Rebuilt empirically: a throwaway `nginx:1.27-alpine` with the compose defaults and the worktree's templates bind-mounted, then `diff` of the rendered output against the committed `conf.d/rfo.conf` -> **byte-identical**. So a container start now regenerates exactly the committed conf; the entrypoint's overwrite (the round-1 finding) is now harmless instead of destructive.
Minor, non-blocking: `conf.d/rfo.conf` remains a snapshot of the compose-default env values; the template is now the single source, so a future env change needs the same re-render step.

## 2. Cap is chat-only; multipart upload uncapped
`client_max_body_size` appears only on `^/staff/ai/chat$` in both files; the general block carries `limit_req` only, and the storefront precedent (`^/store/assistant/chat$`) is untouched at 2k. Reproduced live against the real config on `rfo_edge`: an **8206-byte multipart** `POST /staff/ai/intake-draft` reaches the app (401 unauthenticated) on **both** the 16k-chat config and a 2k-chat variant - the cap never touches the upload path.

## 3. Cap table is honest - reproduced
16k config: 2113 B Confirm-shape -> reaches app; 12058 B CJK -> reaches app. 2k config: the same bodies -> **413** both. Direction matches the claim exactly (edge 413 at 2k -> app at 16k). The reasoning holds: nginx counts bytes, `ChatIn.message` allows 2000 *characters*.

## 4. No authorisation surface moved
`git diff --stat 8bb3fde..50d7869 -- apps/backend/app/api/v1/staff_ai.py apps/backend/tests/` is empty; the `staff_ops.py` delta is three comment lines only. Round-1 posture stands unchanged: `TOOL_ROLES["test"]`/`["list"]` = `ROLES_SET_STATUS`, all seven in-body `_require_role` guards and all seven `Depends(require_roles(*CONST))` route gates intact, nothing widened. The new comment is accurate and worth having.

## 5. The stray lot - leaving it is right, but hand the CLASS to hygiene
Confirmed in the dev DB: `LOT-2026-00971` (id 999, notes "edge cap probe") and `LOT-2026-00700` (id 728, notes "pytest role-claim probe"), both 0 assets, both `intake`. Deleting is not required: an empty intake lot is invisible to the storefront (the catalog needs listed assets in an active lot), carries no authorization effect, and is the evidence the report cites. Disclosing rather than quietly deleting is correct.
**But the disclosure understates it.** The dev DB has **994 lots, 100 of them empty-intake, 94 with notes exactly `pytest`** (plus 1 empty `active` lot). These two are instances of a **systematic leak from the test harness**, not two one-offs. Recommendation: route the whole class to a data-hygiene step - a sweeper for empty `intake` lots with test/probe notes, plus fixture cleanup in the suite so it stops accreting - and keep this job unblocked. Do not single out the pair; do not let the sweeper touch `completed`/`active` lots or any lot with assets.

Nothing else in the delta weakens a wall: no guard changed to `return`, no status-code flip, no constant widened, no test assertion relaxed.
