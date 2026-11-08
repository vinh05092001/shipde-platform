# FEAT-CAR-01 Slice B review repairs

All changes are confined to Slice B: request feedback and independent taxonomy recovery,
read-only account presentation, validated search and filters, dialog keyboard focus,
carrier detail wiring, interaction assertions and the browser journey.

Search accepts up to 200 characters and rejects control characters. Invalid input
is associated with an inline error and leaves the last valid filter in effect.

The component suite runs real React effects and Chromium DOM interactions against
controlled transport fixtures. These fixtures are test-only; production rows and
services still come exclusively from Slice A APIs.

## Failing assertions before repair

Ran the new interaction suite against the original HEAD production components,
restoring the repaired files afterward. Exit code: 1.

```text
FAIL interaction: detail 500, loading and retry: Error: expect(locator).toBeVisible() failed
FAIL interaction: detail 403, loading and retry: Error: expect(locator).toBeVisible() failed
FAIL interaction: partial taxonomy and reference retry: Error: expect(locator).toContainText(expected) failed
FAIL interaction: accounts expose no unfinished operations: Error: expect(locator).toHaveCount(expected) failed
FAIL interaction: inline validation and filtered empty recovery: Error: expect(locator).toHaveAttribute(expected) failed
FAIL interaction: focus contract: Trạng thái Canonical: Error: expect(received).toBe(expected) // Object.is equality
FAIL interaction: focus contract: Hệ thống Phí: Error: expect(received).toBe(expected) // Object.is equality
FAIL interaction: focus contract: Xem dịch vụ (GHN): Error: expect(received).toBe(expected) // Object.is equality
FAIL interaction: carrier detail action opens real detail: Error: expect(locator).toContainText(expected) failed
PASS interaction: list failure retry preserves filters and calls API
PASS interaction: real list 403 envelope
```

## Retry mutation proof

Temporarily replaced only the catalog error banner's retry handler with a no-op.
The updated suite exited 1 with this regression; the real handler was restored:

```text
FAIL interaction: list failure retry preserves filters and calls API: Error: expect(locator).toBeVisible() failed
```

## Browser acceptance scope

`apps/web/e2e/carrier-catalog.spec.ts` covers a live catalog journey and dialog axe
checks without intercepted catalog responses. Execution requires a built web app,
seeded Slice A API and an authenticated shop browser context granting
`iam:carrier_catalog:read`. The live journey was not executed in this repair session;
Chromium component interactions were executed. No credentials or .env files were read.

## Final requested TypeScript and component check

From `apps/web`:

```sh
npx tsc --noEmit -p . && npx tsx src/tests/carrier-catalog.test.ts
```

Exit code: 0. Exact combined output:

```text
npm warn Unknown user config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown global config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown user config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown global config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
--- Running FEAT-CAR-01 Slice B Carrier Catalog UI States Proving Test ---

1. Testing UI State Resolution Helpers...
✅ UI State helpers verified

2. Testing LOADING State...
✅ LOADING state verified

3. Testing FORBIDDEN State...
✅ FORBIDDEN state verified

4. Testing ERROR State...
✅ ERROR state verified

5. Testing EMPTY State...
✅ EMPTY state verified

6. Testing SUCCESS State...
✅ SUCCESS state with PARTIAL badges verified

7. Testing CarrierCard Component...
✅ CarrierCard component verified

8. Testing CarrierGrid Component...
✅ CarrierGrid component verified

9. Testing CarrierServiceList Component...
✅ CarrierServiceList component verified

10. Testing CanonicalStatusReferenceModal...
✅ CanonicalStatusReferenceModal verified

11. Testing FeeTaxonomyReferenceModal...
✅ FeeTaxonomyReferenceModal verified

12. Testing Filter Constants...
✅ Filter constants verified
PASS interaction: detail 500, loading and retry
PASS interaction: detail 403, loading and retry
PASS interaction: partial taxonomy and reference retry
PASS interaction: status reference 500, partial success and retry
PASS interaction: status reference 403, partial success and retry
PASS interaction: accounts expose no unfinished operations
PASS interaction: inline validation and filtered empty recovery
PASS interaction: focus contract: Trạng thái Canonical
PASS interaction: focus contract: Hệ thống Phí
PASS interaction: focus contract: Xem dịch vụ (GHN)
PASS interaction: carrier detail action opens real detail
PASS interaction: list failure retry preserves filters and calls API
PASS interaction: real list 403 envelope

✅ ALL FEAT-CAR-01 SLICE B CARRIER CATALOG UI STATE AND COMPONENT TESTS PASSED
```

## Final formatting and additional checks

From repository root, passed every modified or newly added file to the installed
Prettier executable (repository ignore rules remain unchanged):

```powershell
$catalogChangedFiles = @(git ls-files --modified --others --exclude-standard)
& node_modules/.bin/prettier.cmd --check @catalogChangedFiles
```

Exit code: 0. Exact formatter output:

```text
Checking formatting...
All matched files use Prettier code style!
```

`git diff --check`: exit 0 (no whitespace errors).

`node scripts/ai/check-no-hardcode.mjs`: exit 0; this Controller-specific guard
reported 0 applicable files scanned, so it makes no carrier UI coverage claim.

`npx playwright test e2e/carrier-catalog.spec.ts --list`: exit 0, discovered the
single Chromium live acceptance journey. This is discovery, not a live pass.

PowerShell blocks `npx.ps1` under the host execution policy; the checks used
Windows `cmd /d /c` to invoke the same npx commands without changing that policy.

## Commit attempt

Attempted the requested normal commit without bypassing hooks:

```sh
git commit -m "[FEAT-CAR-01] Slice B: fix review findings"
```

Both staging and commit failed because Git metadata is outside the sandbox's
writable root. Exact error:

```text
fatal: Unable to create 'C:/Users/gumac/AI/shipde-platform/.git/worktrees/w-car01b/index.lock': Permission denied
```

No commit was created. Changes remain in the working tree. No push, merge or PR
operation was attempted.
