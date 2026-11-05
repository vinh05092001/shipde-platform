REVIEW CONTRACT (follow exactly):
- Work Item: {{WORK_ITEM}}
- First state in 2-4 lines what this change was supposed to do: the Work Item goal and the acceptance rows it touches (from the Work Item / task given). Judge the delta against that goal only.
- Scope: verify each previous finding; NEW findings only if introduced or exposed by this delta, P0/P1 only. Other edge cases: one "Follow-up (non-blocking)" line. Read only delta files and direct imports.
- Every finding MUST have exactly these 4 fields, no prose beyond them:
  WHERE: file:line (function name)
  WRONG: the concrete input/state -> wrong output (one scenario, reproducible)
  GOAL: the correct behaviour required (what "fixed" means, tied to the Work Item/AC)
  VERIFY: the test to add (name + assertion) that fails now and passes when fixed
- No vague findings ("consider", "might", "improve"). If you cannot give WHERE+WRONG, drop it.
