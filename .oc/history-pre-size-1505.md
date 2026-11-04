
## Round 69 review (pl-task-ai-160-69, writer was agy04:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 3c8fca4a360b12ec3ac2be15141976e03be482c0

TASK-AI-160 should provide pinned, anonymous, public read-only research with isolated execution, safe refusals and redacted, bounded output.
AC-AI-160-01–05 cover executable behavior; AC-AI-160-06–07 cover documentation and truthful handoff evidence.

Phase 1 checklist:

- **(a) Tenant scope:** N/A — no product data reads or writes.
- **(b) Endpoint authorization/RBAC, empty scope:** N/A — no product endpoints. The CLI credential boundary has P1 finding 3 at `scripts/ai/research.mjs:168`.
- **(c) Negative tests:** N/A for tenant 403/404 and RBAC. CLI refusal tests are present at `scripts/ai/test/research.test.mjs:155`. The changed-redirect test changes the second validation response at `scripts/ai/test/research.test.mjs:983`; it never exercises a redirect during child retrieval. The proxy test uses the mocked transport through `invoke` at `scripts/ai/test/research.test.mjs:1032`.
- **(d) Work Item/specification behavior:** P1 findings 1–3 at `scripts/ai/research.mjs:852`, `:364`, and `:168`.
- **(e) Integer VND:** N/A — no money operations.
- **(f) External-effect idempotency/timeouts/reconciliation:** N/A for mutations and reconciliation. Child execution has a timeout at `scripts/ai/research.mjs:817`; public-destination enforcement remains incomplete in finding 1.
- **(g) Audit and PII/secret masking:** Audit N/A. P1 findings 2 and 4–6 at `scripts/ai/research.mjs:364`, `:781`, `:734`, and `:731`.
- **(h) UI states:** N/A — no UI changes.
- **(i) Previous review findings:**
  - **Previous 1 — FIXED as the CI blocker:** supplied exact-head `secret-scan`, `current-application`, and `application-gate` results are `SUCCESS`. The literal fixture is neutralized at `scripts/ai/test/fixtures/agent-reach.mjs:83`; this does not establish that history was rewritten.
  - **Previous 2 — FIXED for the wrapper’s direct transport:** connection-time lookup validates and supplies the actual destination addresses at `scripts/ai/research.mjs:368`.
  - **Previous 3 — NOT FIXED:** another validation at `scripts/ai/research.mjs:841` still precedes an independently retrieving child at `:852`. Finding 1.
  - **Previous 4 — NOT FIXED:** `client.request` at `scripts/ai/research.mjs:364` still uses the parent’s default global agent. Finding 2.
  - **Previous 5 — FIXED:** bare GitHub PAT masking is added at `scripts/ai/research.mjs:734`.
  - **Previous 6 — FIXED:** IPv6 URL matching preserves brackets at `scripts/ai/research.mjs:664`.
  - **Previous 7 — FIXED:** tolerant decoding at `scripts/ai/research.mjs:643` is used during parameter masking at `:672`.
  - **Previous 8 — FIXED:** validation diagnostics pass through environment-value redaction at `scripts/ai/research.mjs:794`.
  - **Previous IPv6 P2 — FIXED:** literal addresses bypass DNS at `scripts/ai/research.mjs:483`.

Phase 2 open sweep: NEW P0: none. NEW P1: findings 3–6. All blocking findings follow.

1. WHERE: scripts/ai/research.mjs:852 (runResearch); P1; previous finding 3 NOT FIXED  
   WRONG: A target returns public responses during both wrapper validations, then redirects to loopback during the child’s read; the child retrieves private content and a successful payload retaining the original public item URL is emitted.  
   GOAL: R02 and AC-AI-160-02/05 require destination enforcement before every connection made by the actual research retrieval, including redirects.  
   VERIFY: `cli_redirect_after_both_preflights_never_contacts_private_destination` — use separate-process servers and an executable retrieval fixture that redirects only during child retrieval; assert zero private requests, nonzero exit and no private content emitted.

2. WHERE: scripts/ai/research.mjs:364 (defaultRetrieve); P1; previous finding 4 NOT FIXED  
   WRONG: Start a Node 24 version supporting environment proxies with `NODE_USE_ENV_PROXY=1` and an authenticated `HTTP_PROXY`; a public HTTP read uses the inherited global agent and sends its preflight through that proxy with operator credentials.  
   GOAL: R02 and AC-AI-160-05 require the parent retrieval transport to explicitly exclude inherited proxies and credentials.  
   VERIFY: `default_transport_ignores_startup_authenticated_proxy` — start a fresh Node process with those variables, the real default transport and an instrumented proxy; assert zero proxy requests and no proxy authorization.

3. WHERE: scripts/ai/research.mjs:168 (validatePublicUrl); P1 NEW  
   WRONG: `web read https://docs.example.com/?apiKey=fixture-account-key` passes validation because `SENSITIVE` does not match `apiKey`; the credential-bearing URL is fetched and forwarded to the CLI.  
   GOAL: R02 and AC-AI-160-02 require API-key-bearing targets to be refused before retrieval or CLI launch, including camelCase credential parameter names.  
   VERIFY: `camel_case_api_key_target_is_refused_before_launch` — submit that URL with transport and executable markers; assert nonzero exit, zero transport calls, no executable launch and no credential echo.

4. WHERE: scripts/ai/research.mjs:781 (runResearch); P1 NEW  
   WRONG: With `SESSION_ID=fixture-private-env-value`, a successful payload whose text contains that value emits it unchanged because `SESSION_ID` is excluded from `envValues`.  
   GOAL: R04 and AC-AI-160-04 require inherited sensitive environment values, including session credentials, to be masked before truncation.  
   VERIFY: `inherited_session_value_is_redacted` — invoke the existing secrets fixture with that value supplied only through `SESSION_ID`; assert success and absence of the value from both output streams.

5. WHERE: scripts/ai/research.mjs:734 (redact); P1 NEW  
   WRONG: Successful research text containing a bare legacy OpenAI-key-shaped value constructed as `'sk-' + 'A'.repeat(48)` emits the entire value; the bare credential patterns cover only GitHub tokens.  
   GOAL: R04 and AC-AI-160-04 require recognizable credential patterns to be masked without needing a field name, authorization prefix or matching environment value.  
   VERIFY: `bare_openai_credential_is_redacted_before_truncation` — emit the constructed value as ordinary text at full and truncated budgets; assert `[REDACTED]` replacement and no credential substring.

6. WHERE: scripts/ai/research.mjs:731 (redact); P1 NEW  
   WRONG: A successful payload with `items[0].text` equal to `{"client_secret":"fixture-oauth-secret"}` emits the OAuth secret because the textual assignment matcher does not recognize the prefixed `client_secret` name.  
   GOAL: R04 and AC-AI-160-04 require sensitive fields inside returned textual JSON to be masked, as well as fields represented directly in the payload object.  
   VERIFY: `serialized_client_secret_is_redacted` — emit that JSON inside a nonsensitive text field; assert the secret is absent and its value is replaced with `[REDACTED]` before truncation.

Follow-up (non-blocking): None.
## Round 70 review (pl-task-ai-160-70, writer was agy06:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 50d4b3c1e9ab940ea6f51bb70937b34068d8f83e

TASK-AI-160 should provide pinned, anonymous, public read-only research through seven allowed Agent-Reach actions.
AC-AI-160-01–05 require correct arguments, safe refusals, version verification, redacted bounded output and isolated execution; AC-AI-160-06–07 require documented guidance and truthful handoff evidence.

Phase 1 checklist:

- **(a) Tenant scope:** N/A — no product data reads or writes.
- **(b) Authorization/RBAC, empty scope denies:** N/A — no product endpoints. The public-only retrieval boundary has P1 finding 1 at `scripts/ai/research.mjs:857`.
- **(c) Negative tests:** N/A for cross-tenant 403/404 and product permissions. CLI refusal tests are present. The child-redirect regression remains untested: `scripts/ai/test/research.test.mjs:1020` returns a private redirect during wrapper validation, preventing child launch. Finding 1.
- **(d) Work Item/specification behavior:** P1 findings 1 and 2 violate AC-AI-160-02/05 and AC-AI-160-04 respectively.
- **(e) Integer VND:** N/A — no money calculations.
- **(f) External-effect idempotency/timeouts/reconciliation:** N/A for mutations and reconciliation. Child execution has a timeout; actual retrieval destination enforcement remains incomplete in finding 1.
- **(g) Audit and PII/secret masking:** Audit N/A. P1 finding 2 at `scripts/ai/research.mjs:737`.
- **(h) UI states:** N/A — no UI changes.
- **(i) Previous review findings:**
  - **1 — NOT FIXED:** validations at `scripts/ai/research.mjs:609` and `:846` still precede independent child retrieval at `:857`.
  - **2 — FIXED:** dedicated agents at `scripts/ai/research.mjs:364`, explicitly selected at `:372`, exclude the inherited global proxy agent.
  - **3 — FIXED:** the credential matcher at `scripts/ai/research.mjs:26` recognizes `apiKey`; URL validation applies it at `:168`.
  - **4 — FIXED:** `session` is included at `scripts/ai/research.mjs:30`; sensitive environment values are collected at `:786`.
  - **5 — FIXED:** bare OpenAI credential masking is present at `scripts/ai/research.mjs:742`.
  - **6 — FIXED:** serialized `client_secret` assignments are covered at `scripts/ai/research.mjs:737`.
  - **Previously closed findings remain FIXED:** connection-time DNS enforcement (`:373`), bare PAT masking (`:740`), IPv6 URL matching (`:670`), tolerant parameter decoding (`:678`), diagnostic masking (`:799`) and literal-address DNS bypass (`:487`). The supplied exact-SHA CI confirms the previous secret-scan gate blocker is FIXED.

Phase 2 open sweep: NEW P0: none. NEW P1: finding 2.

1. WHERE: scripts/ai/research.mjs:857 (runResearch); P1; previous finding 1 NOT FIXED  
   WRONG: Both wrapper validations return public HTTP 200 responses; the independently retrieving child then follows a redirect to loopback and returns private text with the original public item URL. The wrapper emits that text successfully.  
   GOAL: R02 and AC-AI-160-02/05 require public destination enforcement on every actual retrieval connection, including child redirects, before private content is accessed.  
   VERIFY: `cli_redirect_after_both_preflights_never_contacts_private_destination` — make both wrapper preflights return 200, then have the executable fixture follow a late redirect using separate-process servers and retain the original public item URL; assert zero private requests, nonzero exit and no private content emitted.

2. WHERE: scripts/ai/research.mjs:737 (redact); P1 NEW  
   WRONG: A successful payload containing `items[0].text = '{"session_id":"fixture-session-secret"}'`, with that value absent from the environment, emits the session credential unchanged because the textual assignment matcher excludes session fields.  
   GOAL: R04 and AC-AI-160-04 require sensitive fields inside returned textual JSON to be redacted before truncation, consistently with structured session-field masking.  
   VERIFY: `serialized_session_id_is_redacted` — return that JSON inside the text field; assert success, absence of `fixture-session-secret` and replacement of its value with `[REDACTED]` before truncation.

Follow-up (non-blocking): The proxy tests at `scripts/ai/test/research.test.mjs:1238` and `:1276` block their in-process listeners with `spawnSync` and terminate the child after 200 ms; use separate-process listeners and verify child completion so zero-request assertions establish transport behavior.
## Round 71 review (pl-task-ai-160-71, writer was agy07:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 4126ff1c6020a328fa5b4edd61aa8d98fb388934

TASK-AI-160 should provide pinned, anonymous, public read-only research through seven allowed Agent-Reach actions.
AC-AI-160-01–05 cover correct retrieval, safe refusals, version verification, redacted bounded output and isolated execution; AC-AI-160-06–07 cover documented guidance and truthful handoff evidence.

Phase 1 checklist:

- **(a) Tenant scope:** N/A — no product data reads or writes.
- **(b) Authorization/RBAC, empty scope denies:** Product endpoints N/A. Public-only access remains violated by P1 finding 1 at `scripts/ai/research.mjs:927`.
- **(c) Negative tests:** Cross-tenant and product-forbidden tests N/A. CLI refusal tests exist. The child-redirect fixture at `scripts/ai/test/fixtures/agent-reach.mjs:19` performs no retrieval, leaving finding 1 untested. Offline execution is broken by P1 finding 4 at `scripts/ai/research.mjs:917`.
- **(d) Work Item/specification behavior:** P1 findings 1–4 violate AC-AI-160-01/02/05 and the required offline evidence.
- **(e) Integer VND:** N/A — no money calculations.
- **(f) External-effect idempotency/timeouts/reconciliation:** Mutations and reconciliation N/A. Child execution has a timeout; actual child destination enforcement remains incomplete in finding 1.
- **(g) Audit and PII/secret masking:** Audit N/A. Previous serialized-session masking finding is FIXED at `scripts/ai/research.mjs:788`.
- **(h) UI states:** N/A — no UI changes.
- **(i) Prior-review findings:**
  - **Open finding 1 — NOT FIXED:** `scripts/ai/research.mjs:927` still invokes the original retrieval command after wrapper fetching.
  - **Open finding 2 — FIXED:** `scripts/ai/research.mjs:788` now matches serialized `session_id` assignments; the supplied regression exercises returned text without an inherited session value.
  - **Earlier proxy finding — FIXED:** dedicated request agents at `scripts/ai/research.mjs:411`.
  - **Earlier apiKey finding — FIXED:** credential matcher at `scripts/ai/research.mjs:26`.
  - **Earlier inherited-session finding — FIXED:** sensitive environment matcher at `scripts/ai/research.mjs:30`, collected at `:835`.
  - **Earlier bare OpenAI finding — FIXED:** masking at `scripts/ai/research.mjs:793`.
  - **Earlier serialized client_secret finding — FIXED:** assignment masking at `scripts/ai/research.mjs:788`.
  - **Previously closed code findings remain FIXED:** pinned connection lookup (`:421`), bare PAT masking (`:791`), IPv6 URL matching (`:721`), tolerant decoding (`:701`), diagnostic masking (`:853`) and literal-address DNS bypass (`:364`).

Phase 2 open sweep: **NEW P0: none. NEW P1: findings 2–4.**

1. **WHERE:** scripts/ai/research.mjs:927 (runResearch); P1; previous finding 1 NOT FIXED  
   **WRONG:** Both preflights and the additional in-process fetch return public HTTP 200; the subsequently invoked read CLI follows a late redirect to loopback and contacts the private destination. Replacing its returned text happens after that access.  
   **GOAL:** R02 and AC-AI-160-02/05 require public destination enforcement before every actual retrieval connection, including child redirects. Discarding retrieved content does not prevent private access.  
   **VERIFY:** `cli_late_redirect_after_all_wrapper_fetches_never_contacts_private_destination` — use a genuinely retrieving executable fixture and separate-process listeners; return 200 for every wrapper fetch, then redirect the child retrieval to loopback; assert zero private requests and no private content emitted.

2. **WHERE:** scripts/ai/research.mjs:950 (runResearch); P1 NEW  
   **WRONG:** `youtube transcript https://www.youtube.com/watch?v=jNQXAC9IVRw` retrieves HTTP 200 webpage HTML, and the CLI returns public subtitle text; the wrapper replaces those subtitles with the webpage HTML and reports success.  
   **GOAL:** R01 and AC-AI-160-01 require transcript to map to subtitle retrieval and return caption evidence, preserving the selected action’s result.  
   **VERIFY:** `url_transcript_preserves_subtitle_result` — serve a public watch-page HTML response and have the executable fixture return distinctive captions; assert emitted research contains the captions and excludes the webpage HTML.

3. **WHERE:** scripts/ai/research.mjs:945 (runResearch); P1 NEW  
   **WRONG:** A read fetch returns HTTP 200, while the CLI exits zero with `{"ok":false,"error":{"code":"TIMEOUT"}}`; assigning `ok: true` converts that failure into successful research output.  
   **GOAL:** R05 and AC-AI-160-05 require upstream failures and timeouts to remain failures, independently of the child’s exit status.  
   **VERIFY:** `read_preserves_failed_payload_with_zero_exit` — return HTTP 200 from retrieval and an executable-fixture payload with `ok:false`, `TIMEOUT` and exit zero; assert nonzero wrapper exit, empty stdout and a sanitized failure.

4. **WHERE:** scripts/ai/research.mjs:917 (runResearch); P1 NEW  
   **WRONG:** The allowed-web-read test injects an executable fixture, a public resolver and an HTTP-200 fixture transport, but this call bypasses that transport and connects to `93.184.216.34`. With networking disabled, the test returns a refusal instead of its required successful fixture result.  
   **GOAL:** T02 and AC-AI-160-01–05 require executable-fixture verification without network access; injected retrieval evidence must cover the actual retrieval path.  
   **VERIFY:** `read_fixture_execution_requires_no_network` — disable external socket connections and execute an allowed read using the fixture transport; assert zero external connection attempts, successful completion and the expected fixture content.

Follow-up (non-blocking): Reconcile the Work Item’s conflicting 37/66-test claims; the supplied CI section contains no check results to verify current remote gates.