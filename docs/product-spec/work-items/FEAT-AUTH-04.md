# FEAT-AUTH-04: Password Recovery

## Feature Overview

- **Feature ID**: FEAT-AUTH-04
- **Slice**: S01 — Identity and organization
- **Group**: Identity and organization
- **Status**: BACKLOG
- **Dependencies**: TASK-FOUND-04 (see BACKLOG-DEPENDENCIES.md)
- **Work Item Path**: docs/product-spec/work-items/FEAT-AUTH-04.md

## Business Outcome

Enable users who have forgotten their password to securely recover access to their account using an expiring one-time reset token delivered via email or phone. Upon successful password reset, all existing sessions must be revoked to prevent unauthorized access from compromised devices.

## In Scope

1. **Forgot Password Request Flow**
   - User enters email or phone on `/forgot-password` screen
   - System validates identifier exists and is verified
   - Generates cryptographically secure one-time reset token
   - Token expires after 1 hour (configurable)
   - Token delivered via email (preferred) or SMS (fallback)
   - Anti-enumeration: always returns success response regardless of account existence

2. **Password Reset Flow**
   - User clicks link with token in URL: `/reset-password?token=...`
   - System validates token: exists, not expired, not consumed, matches identifier
   - User enters new password (with strength requirements)
   - On success: password updated, token marked consumed, ALL device sessions revoked
   - User redirected to login with success message

3. **Security Requirements**
   - Tokens hashed in database (SHA-256), never stored in plaintext
   - One-time use only; consuming a token invalidates it permanently
   - Rate limiting on forgot-password requests (per IP and per account)
   - Brute-force protection on token verification
   - Revoke all `DeviceSession` records for the user on successful reset
   - Audit log entries for: request, token consumption, password change, session revocation

4. **UI States** (per DESIGN-SYSTEM-UX-RULES.md)
   - Forgot Password screen: loading, empty (no identifier entered), validation error, rate-limited, success (token sent), forbidden
   - Reset Password screen: loading, invalid/expired token, validation error, password mismatch, success, forbidden

## Out of Scope

- MFA reset (FEAT-AUTH-05)
- Admin-initiated password reset for other users
- Password history / reuse prevention (can be added later)
- Email/phone change during reset (separate flow)
## Acceptance Criteria

| ID | Scenario | Expected Result |
|----|----------|-----------------|
| AC-01 | User requests reset for verified email | 200 OK, token generated and sent via delivery adapter, audit logged |
| AC-02 | User requests reset for unverified email | 200 OK (anti-enumeration), no token sent, audit logged |
| AC-03 | User requests reset for non-existent email | 200 OK (anti-enumeration), no token sent, audit logged |
| AC-04 | User requests reset for verified phone | 200 OK, token sent via SMS, audit logged |
| AC-05 | Rate limit exceeded (5 requests/hour/IP) | 429 TOO_MANY_REQUESTS with retry-after header |
| AC-06 | Valid token used within expiry | Password updated, token consumed, all sessions revoked, 200 OK |
| AC-07 | Expired token used | 400 TOKEN_EXPIRED, token not consumed |
| AC-08 | Already consumed token used | 400 TOKEN_ALREADY_USED |
| AC-09 | Invalid/malformed token used | 400 INVALID_TOKEN |
| AC-10 | Weak password rejected | 400 VALIDATION_ERROR with field errors |
| AC-11 | Password mismatch rejected | 400 VALIDATION_ERROR with field errors |
| AC-12 | Successful reset revokes all DeviceSession records | All sessions for user have `is_revoked = true` |
| AC-13 | Forgot Password screen shows all required states | Loading, empty, validation, error, success, forbidden |
| AC-14 | Reset Password screen shows all required states | Loading, invalid token, validation, error, success, forbidden |

## Data Model Changes

### New Model: `PasswordResetToken`

```prisma
model PasswordResetToken {
  id           String   @id @default(uuid()) @db.Uuid
  user_id      String   @db.Uuid
  token        String   @unique @db.VarChar(255)  // SHA-256 hash
  channel      String   @db.VarChar(16)         // 'email' | 'phone'
  identifier   String   @db.VarChar(255)        // email or phone used
  expires_at   DateTime @db.Timestamptz
  consumed_at  DateTime? @db.Timestamptz
  created_at   DateTime @default(now()) @db.Timestamptz

  user         User     @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id])
  @@index([identifier, channel])
  @@map("password_reset_tokens")
}
```

### User Model Updates
- No new fields needed; existing `password_hash` updated on reset
- `DeviceSession` cascade revocation handled in service

## API Contract

### POST `/auth/forgot-password`

**Request**:
```json
{
  "identifier": "string",  // email or phone
  "channel": "email" | "phone"  // optional, auto-detected if omitted
}
```

**Response 200**:
```json
{
  "data": {
    "status": "SENT",
    "message": "Nếu tài khoản tồn tại và đã xác thực, liên kết đặt lại mật khẩu đã được gửi.",
    "channel": "email"
  }
}
```

**Response 429**: Rate limited
**Response 400**: Validation error (invalid identifier format)

### POST `/auth/verify-reset-token`

**Request**:
```json
{
  "token": "string"  // raw token from URL
}
```

**Response 200**:
```json
{
  "data": {
    "valid": true,
    "identifier": "user@example.com",
    "channel": "email"
  }
}
```

**Response 400**: INVALID_TOKEN, TOKEN_EXPIRED, TOKEN_ALREADY_USED

### POST `/auth/reset-password`

**Request**:
```json
{
  "token": "string",
  "password": "string",
  "password_confirm": "string"
}
```

**Response 200**:
```json
{
  "data": {
    "message": "Mật khẩu đã được đặt lại thành công. Tất cả phiên đăng nhập khác đã bị thu hồi."
  }
}
```

**Response 400**: VALIDATION_ERROR, INVALID_TOKEN, TOKEN_EXPIRED, TOKEN_ALREADY_USED, PASSWORD_MISMATCH, WEAK_PASSWORD

## UI Screens

### 1. `/forgot-password` — Forgot Password Screen
- Input: Email or phone field (auto-detect channel)
- Submit button: "Gửi liên kết đặt lại mật khẩu"
- Link back to login: "Quay lại đăng nhập"
- States: loading, empty, validation, rate-limited, success, forbidden

### 2. `/reset-password?token=...` — Reset Password Screen
- Hidden token from URL query param
- Password input with strength indicator
- Confirm password input
- Submit button: "Đặt lại mật khẩu"
- Link back to login: "Quay lại đăng nhập"
- States: loading, invalid/expired token, validation, password mismatch, weak password, success, forbidden

## Implementation Tasks

1. [ ] Add `PasswordResetToken` model to Prisma schema, run `pnpm db:generate`
2. [ ] Add `forgotPassword`, `verifyResetToken`, `resetPassword` methods to `AuthService`
3. [ ] Add corresponding endpoints to `AuthController`
4. [ ] Add rate limiting for forgot-password (reuse `RateLimitService`)
5. [ ] Add audit logging for all password reset actions
4. [ ] Create `ForgotPasswordView` component and `/forgot-password` page
5. [ ] Create `ResetPasswordView` component and `/reset-password` page
6. [ ] Update `AuthContext` with `forgotPassword`, `verifyResetToken`, `resetPassword` methods
7. [ ] Add unit tests for `AuthService` password reset methods
8. [ ] Add supertest integration tests for all three endpoints
9. [ ] Add web component tests for both screens
10. [ ] Run full test suite and verify all acceptance criteria
11. [ ] Take screenshots of all UI states for PR evidence
12. [ ] Open Pull Request titled `[FEAT-AUTH-04] Password recovery`

## Related Documents

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` (line 12)
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`

## Security Notes

- Tokens must use cryptographically secure random bytes (32 bytes = 256 bits)
- Tokens hashed with SHA-256 before storage
- Constant-time comparison for token verification
- All sensitive operations audit logged with IP and correlation ID
- Rate limiting: 5 requests/hour per IP, 3 requests/hour per account
- Token expiry: 1 hour (3600 seconds)
- Password requirements: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char