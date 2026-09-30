# TASK-AI-59 - Design OS-level isolation for live E2E worker CLOSED mode

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-59` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `185` |
| Dependencies | `TASK-AI-49; TASK-AI-58; P0 guard branch origin/feat/e2e-sandbox-remote-isolation at 8786643` |
| Assigned author | `Codex - design only` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-59.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex - fresh independent task` |
| Branch | `docs/task-ai-59-os-isolation` |
| Pull Request | `N/A` |

## Business outcome

Ship De needs a live E2E dispatch path where a real AI worker can operate on a real checkout without being able to publish to GitHub, mutate protected refs, read host credentials, or reach the operator's real user profile. This design defines the OS-level boundary required before the live E2E isolation level may be called `CLOSED`.

This Work Item is design-only. It creates no Windows users, ACLs, firewall rules, containers, accounts, credentials, or live agent runs.

## Source references

- `AGENTS.md` - role separation, one writer per Work Item, no merge by agents, CI and review gates, and no production implementation outside the assigned Work Item.
- `origin/feat/e2e-sandbox-remote-isolation` at `8786643bab5de1dc91aecd42e821b6cd7f3e00d1` - P0 command/credential guard branch read via `git show`; implements default sandboxing, PATH stubs, credential/profile stripping, GitHub remote canonicalization, `gh api` write blocking, Node HTTPS guardrails for guarded Node children, and lifecycle-aware cleanup.
- `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/p0-sandbox-report.md` - P0 verdict is `command/credential guard - PARTIAL isolation`; arbitrary binary outbound network access remains why it is not `CLOSED`.
- `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/reviews/da509d6c9d357ad348f83923350fac227df0414c.md` - independent review findings for the earlier guard: background cleanup, opt-in sandboxing, Windows `.exe` bypasses, SSH/Git URL bypasses, direct HTTPS/API calls, inherited credentials, inherited `GIT_*`, hook bypasses, cleanup path validation, and unrealistic empty worktree.
- `tools/ai-brain/cli.js` on `origin/main` - dispatch execution path and default `dispatch --execute` behavior.
- `tools/ai-brain/harness.js` on `origin/main` - Paseo launch uses `--mode full-access`, worktree branch creation, and `--background --json`.
- `tools/ai-brain/executor.js` on `origin/main` - turns a dispatch plan into one harness launch/resume and records writer decisions.

## Preconditions and dependencies

- `TASK-AI-49` or equivalent Paseo dispatch adapter behavior exists so a worker can be launched by the controller.
- `TASK-AI-58` or equivalent controller selection/checkpoint behavior exists so the live E2E exercises real source selection and fallback.
- The P0 command/credential guard remains useful as defense-in-depth but is not sufficient for `CLOSED`.
- Operator has a Windows host with 16 GB RAM and must explicitly approve any later admin action in a separate implementation Work Item.
- No live E2E may claim `CLOSED` until the verification tests in this design pass from inside the isolated worker boundary.

## Author boundary

Codex authors only this design because it is a security architecture Work Item and must not mutate the host. A later implementation must be split into one or more human-approved Work Items with explicit admin steps and rollback instructions. Gemini or a human-operated admin session may implement after approval; 9Router is not appropriate because the scope includes OS isolation, credential boundaries, process lifetime, and network policy.

## Threat model

Today, a live worker process can potentially do all of the following unless an OS/container boundary prevents it:

1. Execute direct `gh`, `gh.exe`, `git`, `git.exe`, `git-credential`, `git-credential-manager.exe`, `ssh`, `curl`, `powershell`, `node`, package-manager, or arbitrary downloaded/native binaries.
2. Push with raw `git push`, create or update PRs with `gh pr`/`gh api`, call GitHub REST/GraphQL over raw HTTPS, or use SSH transport.
3. Bypass wrapper hooks with `--no-verify`, `git -c`, inherited `GIT_*` variables, direct executable paths, copied binaries, shell launch forms, or alternate protocols.
4. Read credential stores from the real user profile, including GitHub CLI config, Git Credential Manager, SSH keys/agent sockets, npm/pnpm tokens, cloud credentials, browser/app profiles, environment variables, and project-local secret files.
5. Use the real user profile as `HOME`/`USERPROFILE`, observe unrelated files under `C:/Users/gumac`, and inherit host identity metadata.
6. Reach the host network directly, including `github.com`, `api.github.com`, model providers, package registries, arbitrary HTTPS endpoints, and localhost services.
7. Keep background child processes alive after the controller exits unless teardown tracks process trees and daemon sessions.

The P0 guard reduces accidental and common deliberate publish paths, but it is still a process-level command/credential guard. `CLOSED` requires the worker to be unable to publish even when it intentionally avoids the wrappers.

## CLOSED requirement

`CLOSED` means all of the following are simultaneously true for the worker boundary:

1. The worker cannot push, create PRs, update PRs, comment, approve, merge, open releases, write workflow runs, or otherwise GitHub-write, even if it runs arbitrary code or direct binaries.
2. Network egress is denied by default. Allowed egress is only:
   - `127.0.0.1:20128` for the local model gateway.
   - Explicit model-provider endpoints required by the selected worker route, preferably reached through that gateway rather than direct public internet.
   - Optional package/cache endpoints only if the run design pre-seeds dependencies cannot satisfy the worker; any such exception must be named, temporary, and logged.
3. The worker has no access to publish credentials: GitHub tokens, GitHub CLI auth, Git Credential Manager secrets, SSH keys, SSH agent sockets, browser profiles, npm/pnpm publish tokens, cloud credentials, or operator API keys outside the model route.
4. The worker does not run under the real operator profile and cannot read `C:/Users/gumac` except the explicitly mounted worktree and read-only tool/runtime paths approved for execution.
5. The worker may write only its assigned worktree and disposable temp/profile locations.
6. The publisher is outside the worker boundary. Worker output is a patch, branch in an internal bare repository, artifact, or reviewed handoff; a separate publisher with real credentials performs GitHub writes only after deterministic gates.
7. Cleanup removes or disables the worker profile, temp directories, container/VM/user session, network policy, and process tree. No worker-owned process may survive teardown.

WSL is not `CLOSED` by default. A normal WSL distro can read host drives through `/mnt/c`, shares the host network by default, and commonly sees user-mounted paths. WSL would need its own explicit mount, user, credential, and egress design before it could satisfy this Work Item.

## Options compared

| Option | Boundary | RAM/CPU cost on 16 GB host | Paseo/OpenCode/Hermes/agy/Codex inside? | Cleanup | Admin rights needed | Rollback |
|---|---|---:|---|---|---|---|
| A. Local Windows user without credentials + ACLs | Separate local user, denied ACLs to real profile, dedicated temp/profile, no inherited secrets | Low: roughly one extra agent process plus shell/Node; best fit for 16 GB | Likely if tools are installed per-machine or copied into an allowed tools directory; GUI/browser-dependent tools may need extra profile setup | Delete/disable user, remove profile/worktree/temp, kill processes owned by that SID | Yes: create user, ACL directories, possibly configure per-user firewall rules | Re-enable ACL inheritance, remove firewall rules, delete local user/profile |
| B. Container without real profile mounts, worktree-only mount | Container filesystem with only worktree mounted; no real profile mount | Medium to high: container runtime plus agent; acceptable for one worker but tight if model tooling is heavy | Possible for CLI tools that run headless and have Linux/Windows container support; host-native Paseo/Hermes/agy/Codex may need container install and credentials to model gateway only | Stop/remove container, delete volume/network | Usually yes for Docker/Hyper-V/WSL2 runtime installation; less admin once runtime exists | Remove container, image, volume and network; no host profile state should exist |
| C. Container/internal network with egress only to gateway | Same as B plus isolated container network and allowlist to `127.0.0.1:20128`/model endpoints | Medium to high: best security/cost balance for one live E2E on 16 GB; avoid multiple concurrent workers | Possible if CLIs can run in the image and talk to gateway. GUI-dependent flows or tools needing host keychains are unsuitable | Stop/remove container, delete network, verify no process/namespace remains | Yes to install/configure runtime and network policy; routine run can be scripted | Remove network, firewall/NAT rules, container, image, volume |
| D. Separate publisher outside the worker | Not an isolation boundary by itself; separates GitHub-write capability from worker | Very low: publisher is short-lived and can run on host | N/A inside worker; complements A/B/C | Clear publisher temp/auth after publish | No new admin if publisher already has host credentials; yes if creating a service account or credential store | Disable publisher token/account, remove credential and job |

## Recommended option

Use Option C plus Option D:

1. Run the real worker in a container or equivalent OS-isolated environment with no real profile mounts and only the assigned worktree mounted.
2. Place the worker on an internal network with default-deny egress. Allow only the local model gateway at `127.0.0.1:20128` through an explicit host mapping/proxy and any approved model endpoints required for that route.
3. Keep GitHub credentials entirely outside the worker. The worker may write commits to its mounted checkout or an internal bare repository, but it cannot contact GitHub for writes.
4. Use a separate publisher process outside the worker boundary to push/open/update PRs after the worker exits and after gates validate the artifact.
5. Keep the P0 command/credential guard inside the worker as defense-in-depth, not as the primary isolation claim.

This recommendation costs more setup than a local-user-only design, but it directly addresses raw HTTPS, arbitrary binaries, inherited profiles, and process cleanup. On a 16 GB machine, keep concurrency at one live worker and avoid running a second containerized worker or heavyweight browser unless the operator explicitly accepts the RAM pressure.

## Operator actions that need admin approval

These are future implementation actions, not performed by this Work Item:

1. Install or enable the selected container/OS isolation runtime if not already present.
2. Create the isolated container network or Windows firewall/NAT policy with default-deny egress.
3. Add explicit egress allow rules for the model gateway and approved model endpoints only.
4. Create any local service user or publisher identity if the final implementation chooses one.
5. Set ACLs so the worker cannot read the real user profile, credential stores, SSH keys, GitHub CLI config, browser profiles, or host secrets.
6. Configure the publisher credential store outside the worker boundary.
7. Approve teardown scripts that can remove the isolated network, user/profile, containers, volumes and process trees.

## Step-by-step implementation outline

1. Preflight: record current origin refs, current process tree, current relevant firewall/container/network state, and absence/presence of the worker isolation resources.
2. Prepare a minimal worker image or isolated user filesystem containing Node, pnpm if needed, Git, the harness CLI, and the P0 guard.
3. Mount only the assigned worktree and disposable temp/profile paths. Do not mount `C:/Users/gumac`, `.ssh`, `.git-credentials`, GitHub CLI config, browser profiles, or host package-manager auth files.
4. Route model access through `127.0.0.1:20128` or a named model endpoint allowlist. Deny `github.com`, `api.github.com`, SSH, and all unknown outbound destinations.
5. Launch the worker through the existing controller dispatch path, but with `cwd`, `HOME`, `USERPROFILE`, `GH_CONFIG_DIR`, `SSH_AUTH_SOCK`, and proxy/network variables pointing inside the isolated boundary.
6. Allow the worker to produce commits, patches, logs, screenshots, and verification artifacts in the mounted worktree or internal artifact directory.
7. Stop the worker and prove no worker process remains.
8. Run verification from the host against the worktree/artifact.
9. Run the separate publisher outside the worker boundary only after gates pass. The publisher performs GitHub push/PR operations with its own audited credentials.
10. Teardown the worker environment and compare origin refs before/after any run that is expected not to publish.

## In scope

- Threat model and `CLOSED` definition for live E2E workers.
- Comparison of local Windows user, container, internal network, and separate publisher designs.
- Recommendation for the isolation architecture.
- Admin-action separation.
- Verification tests required before any future implementation may claim `CLOSED`.
- Explicit statement that WSL is not `CLOSED` by default.

## Out of scope

- Creating users, groups, ACLs, firewall rules, routes, containers, images, networks, volumes, service accounts, or credentials.
- Running a live agent, live E2E, Paseo/OpenCode/Hermes/agy/Codex worker, GitHub write, or model-provider request.
- Changing `tools/ai-brain`, controller behavior, scheduler behavior, harness behavior, CI, secrets, package scripts, or application code.
- Implementing the publisher.
- Merging, approving, pushing, or opening a Pull Request.
- Claiming that the existing P0 command/credential guard is `CLOSED`.

## Business rules and edge cases

1. A worker boundary that allows raw outbound HTTPS to GitHub is not `CLOSED`, even if `gh` and `git` wrappers are blocked.
2. A worker boundary that can read the real operator profile or credential stores is not `CLOSED`, even if no credential environment variables are present.
3. A worker boundary that depends on Git hooks, PATH ordering, proxy environment variables, or Node monkey-patching alone is not `CLOSED`.
4. A worker boundary that mounts WSL `/mnt/c` or a real Windows profile path is not `CLOSED`.
5. Package installation during the run must be avoided or routed through a named read-only cache. Broad package-registry egress weakens the claim and must be explicitly accepted.
6. Publisher credentials must never be present in the worker environment, filesystem, mounted paths, logs, or artifacts.
7. Background sessions must be tied to teardown. Unknown session state fails closed until an operator can prove the session is gone.

## UI states

No user-facing product screen is changed. Loading, empty, validation, error, forbidden, partial, success and recovery UI states are not affected by this design-only Work Item.

## API, event and data impact

No application API, database, migration, queue, carrier adapter, tenant data, event schema, or production data change. Future implementation may add controller events for isolation preflight, worker launch, network-deny verification, publisher handoff, and teardown, but this Work Item only defines the design.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-59-01` | Worker runs `git push https://github.com/vinh05092001/shipde-platform.git HEAD:refs/heads/e2e-should-not-exist` | Command fails from inside the boundary before reaching GitHub; no credential prompt or fallback path succeeds | Worker log plus before/after sorted `git ls-remote` hash unchanged |
| `AC-AI-59-02` | Worker runs `gh api repos/vinh05092001/shipde-platform/issues -f title=x -f body=y` and equivalent raw HTTPS/GraphQL mutation attempts | All GitHub write attempts fail by network/credential boundary, not only by wrapper classification | Worker log showing denied egress or missing credentials; no new issue/PR/comment/ref |
| `AC-AI-59-03` | Worker attempts to read GitHub CLI, GCM, SSH, npm/pnpm and cloud credential locations from the real user profile | Files are absent or permission denied; `HOME`/`USERPROFILE` resolve to isolated profile | `whoami`, profile path evidence, failed read attempts without printing secret values |
| `AC-AI-59-04` | Worker attempts `curl https://api.github.com`, `ssh git@github.com`, and a custom binary HTTPS call to GitHub | Egress is denied regardless of executable | Firewall/container-network logs or command output proving denial |
| `AC-AI-59-05` | Worker reaches the allowed model path | Calls to `127.0.0.1:20128` or approved model endpoint succeed enough for the agent to run | Worker log with endpoint names only; no credential values |
| `AC-AI-59-06` | Worker exits or is cancelled | No worker process, child process, shell, daemon session, container, or temp profile survives teardown | Process-tree/container inspection after teardown |
| `AC-AI-59-07` | Live E2E run is expected not to publish | Origin refs before and after are identical | Sorted `git ls-remote` SHA-256 before/after unchanged |
| `AC-AI-59-08` | Publisher runs after worker handoff | Only the publisher process has GitHub credentials and records the exact artifact/commit it published | Publisher log, reviewed artifact hash, and credential absence from worker logs |

## Verification commands

Design-only validation for this Work Item:

- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`

Future implementation verification for `CLOSED` must include:

- `git ls-remote https://github.com/vinh05092001/shipde-platform.git` before and after, sorted and SHA-256 hashed.
- Inside-worker `git push` to GitHub HTTPS, SSH, SCP-like, and `git://` forms; all fail.
- Inside-worker `gh api` writes and raw HTTPS writes; all fail.
- Inside-worker credential-read probes; all fail without printing secret values.
- Inside-worker allowed model-gateway probe; succeeds only for approved model path.
- Host teardown inspection; no worker-owned process, container, network namespace, temp profile, or session remains.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `N/A` | `N/A` | Design Work Item authored; independent review pending |

## Residual limitations

- This Work Item does not implement the isolation boundary.
- The exact container runtime, image contents, endpoint allowlist, publisher command surface, and Windows admin runbook remain future implementation decisions.
- `CLOSED` cannot be claimed until live verification passes inside the selected OS/container boundary.
