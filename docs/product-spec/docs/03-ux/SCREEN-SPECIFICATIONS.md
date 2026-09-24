# Screen Specifications

## Shared screen contract

Every list/detail/form implements:

- Loading skeleton, empty state, recoverable error, forbidden and not-found.
- Stable URL for list filters/detail where safe.
- Form-level and field-level validation.
- Dirty-form navigation warning and draft recovery.
- Submit lock/idempotency for commands.
- Permission-aware controls.
- Activity history for business-critical entities.

## SCR-AUTH-01 Login

Fields/actions:

- Email or phone.
- Password with show/hide.
- Remember trusted device.
- Login, OTP alternative if configured, forgot password.
- MFA challenge and recovery code.
  Success routes to organization selection or role dashboard.

State coverage:

- **Loading**: Submit button disabled with spinning indicator; fields set to read-only during in-flight network submission.
- **Empty**: Initial clean form with helpful placeholders; zero production-like pre-filled sample text.
- **Validation**: Per-field inline error messages sourced from `ErrorResponse.error.fields`; highlight fields with errors.
- **Error (forbidden)**: Distinct screens for:
  - `INVALID_CREDENTIALS`: "Email/số điện thoại hoặc mật khẩu không chính xác"
  - `AUTH_PENDING_VERIFICATION`: "Tài khoản chưa được xác thực. Vui lòng xác thực qua liên kết email hoặc mã OTP đã gửi."
  - `AUTH_ACCOUNT_SUSPENDED`: "Tài khoản đã bị tạm ngưng. Vui lòng liên hệ bộ phận hỗ trợ Ship Dễ."
  - `AUTH_ACCOUNT_DISABLED`: "Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ bộ phận hỗ trợ Ship Dễ."
  - `RATE_LIMITED`: Actionable warning with cooldown countdown window hint.
- **Success**: Confirmation screen celebrating successful login, leading into session start or organization selection.
## SCR-AUTH-02 Self-registration

Route: `/register`

Fields/actions:

- Shop/merchant name (text, required).
- Owner full name (text, required).
- Owner email (email format, required if phone not provided).
- Owner phone (Vietnamese phone regex `^(0|\+84)[3|5|7|8|9][0-9]{8}$`, required if email not provided).
- Password (min 8 chars, with show/hide toggle).
- Terms of service & Privacy policy acceptance (checkbox with link, mandatory).
- "Đăng Ký Cửa Hàng" submit button.
- Link to `/login` ("Đã có tài khoản? Đăng nhập").

State coverage:

- **Loading**: Submit button disabled with spinning indicator; fields set to read-only during in-flight network submission.
- **Empty**: Initial clean form with helpful placeholders; zero production-like pre-filled sample text.
- **Validation**: Per-field inline error messages sourced from `ErrorResponse.error.fields`; terms checkbox highlight if unchecked upon submit.
- **Duplicate error**: Explicit notice ("Email hoặc Số điện thoại đã được sử dụng") with direct link to login (`/login`).
- **Rate-limited error**: Actionable warning with cooldown countdown window hint (`BR-AUTH-07`).
- **Pending verification**: Success transition displaying "Xác thực tài khoản" instructions with active verification channel details, OTP/link input, and "Gửi lại mã" (Resend) button with 60s cooldown.
- **Verification error**: Distinct screens for expired token ("Mã xác thực đã hết hạn") and consumed token ("Mã xác thực đã được sử dụng") with single-click resend option.
- **Verification success**: Confirmation screen celebrating account activation, leading into session start or login.
- **Recovery**: Unsaved form warning on navigation; network interruptions preserve entered values.

## SCR-ONB-01 Onboarding

Steps:

1. Shop/legal and billing profile.
2. First warehouse/pickup/return address.
3. Invite users and roles.
4. Connect carrier account and test capability.
5. Operating defaults/notifications.
6. Test order → serviceability → quote → approved test create.

The checklist is resumable. A skipped required dependency remains visibly blocking.

## SCR-CAR-01 Carrier accounts

List columns:

- Carrier, account alias/code, shop/warehouse scope.
- Observe/action permission.
- Environment.
- Health and last successful call.
- Token expiry/rotation status.
- Verified capabilities/evidence.

Actions: connect, test, edit scope, rotate/revoke, view sanitized logs, disable.

## SCR-ORD-02 Source order form

Sections:

- Source reference/channel.
- Sender/warehouse.
- Recipient/address normalization.
- Items/restricted-goods acknowledgment.
- Parcel count, weight, dimensions and declared value.
- COD, payer, insurance and delivery notes.

Primary action: Save and find shipping options. Validation never clears entered data.

## SCR-QUOTE-01 Shipping options

Top area shows normalized origin/destination and parcel. Candidate table:

- Carrier/account/service.
- Availability state and reason.
- Base fee, COD, insurance, VAT, surcharge and total.
- Pickup window, SLA/EDD, quote expiry.
- Cheapest/fastest/balanced badges.
- Historical performance when sufficiently sampled.

Actions:

- Select, refresh, edit affected inputs, view calculation/raw evidence.
- Save draft or manual carrier when no option.
- UNKNOWN_ERROR offers retry and carrier incident detail, not unsupported text.

## SCR-SHIP-01 Shipment detail

Displays source order, selected quote snapshot, carrier request/response summary, waybill, label, pickup, timeline, exceptions, return and downstream settlement links.

Actions are status/capability/permission constrained:

- Update allowed fields.
- Requote affected changes.
- Cancel.
- Switch carrier before handover.
- Print label.
- Request pickup.
- Request redelivery.
- Open manual fallback checklist.

Unknown create outcome displays a blocking reconciliation banner; it never offers a blind create button.

## SCR-EXC-01 Exception workbox

Filters: type, carrier, warehouse, age, COD, attempts, owner and due state.

Columns: priority, waybill, canonical/raw status, age, COD, attempt count, owner and recommended action.

Detail drawer: timeline, recipient/shop context, checklist, notes, carrier capability, command confirmation and outcome.

## SCR-RET-01 Return receiving

Scan-first layout:

- Waybill scan/input.
- Ownership/duplicate banner.
- Shipment/item expectation.
- Condition checklist.
- Direct camera media.
- Issue type and note.
- Confirm receipt.

Media upload from gallery is labeled lower-evidence unless a later approved policy allows it.

## SCR-RATE-01 Rate and policy

Tabs:

- Source documents.
- Structured rules.
- Settlement policy.
- Claim policy.
- Simulator.
- Approval/version history.

Every rule displays source page/clause, author, reviewer, status and effective range.

## SCR-IMPORT-01 Data sources

Cards for source orders, carrier statements, rate/policies and optional bank:

- Upload/select adapter.
- Mapping preview.
- Validation counts and control totals.
- Blocking/non-blocking issues.
- Raw file hash/revision.
- Promote/supersede history.

No invalid blocking row silently enters an audit snapshot.

## SCR-AUD-01 Audit results

Summary:

- Data quality.
- Processing statuses.
- Six missing states.
- Findings by type.
- Four money levels separately.

Detail table:

- Waybill/source/batch.
- Processing status and multiple findings.
- Expected vs actual components.
- Rule/evidence lineage.
- Case status and owner.

Drill-down exposes source rows, calculation and version. It never collapses findings into one destructive label.

## SCR-BATCH-01 Batch and bank

Displays independent carrier transfer and bank reconciliation statuses, batch totals, member waybills and bank links.

Allocation editor supports many-to-many, validates transaction limits and requires confirmation for suggestions.

## SCR-CASE-01 Case and claim

Sections:

- Finding/calculation.
- Four money levels.
- State/timeline/owner.
- Evidence and missing checklist.
- Deadline/policy.
- Submission mode/reference/response.
- Recovery installments/bank proof.
- Carry-forward periods.

High-impact state transitions require reason/evidence and may require approval.
