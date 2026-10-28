export interface paths {
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Operational liveness probe (API-FOUND-HEALTH-LIVE)
     * @description Returns 200 when the process is alive without querying downstream dependencies.
     */
    get: operations['getHealthLive'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Operational readiness probe (API-FOUND-HEALTH-READY)
     * @description Returns 200 when all required infrastructure dependencies (PostgreSQL, Redis, S3) are healthy, or 503 if any dependency is unavailable.
     */
    get: operations['getHealthReady'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Self-register new merchant and owner user (API-AUTH-REGISTER)
     * @description Creates a new merchant tenant and its initial owner user in a single transaction in pending-verification status.
     */
    post: operations['register'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/verify-email': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Verify user email using verification token (API-AUTH-VERIFY-EMAIL)
     * @description Verifies email address using single-use token and activates user if eligible.
     */
    post: operations['verifyEmail'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/verify-phone': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Verify user phone using OTP (API-AUTH-VERIFY-PHONE)
     * @description Verifies phone number using OTP code and activates user if eligible.
     */
    post: operations['verifyPhone'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/verify/resend': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Resend verification token or OTP (API-AUTH-RESEND-VERIFICATION)
     * @description Re-issues a verification token or phone OTP subject to independent rate limits.
     */
    post: operations['resendVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/forgot-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Request password reset link (FEAT-AUTH-04) */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** @description Email or phone number */
            identifier: string;
            /** @enum {string} */
            channel?: 'email' | 'phone';
          };
        };
      };
      responses: {
        /** @description Link sent */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Rate limited */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/verify-reset-token': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify password reset token (FEAT-AUTH-04) */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            token: string;
          };
        };
      };
      responses: {
        /** @description Token valid */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid, expired, or consumed token */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Account locked */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/reset-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Reset password using token (FEAT-AUTH-04) */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            token: string;
            password: string;
            password_confirm: string;
          };
        };
      };
      responses: {
        /** @description Password updated and sessions revoked */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid token or password mismatch */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Account locked */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Rate limited */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Password login (API-AUTH-LOGIN, FEAT-AUTH-03)
     * @description Authenticates with email/Vietnamese phone + password. Identical INVALID_CREDENTIALS response for unknown identifier or wrong password. Non-active statuses are rejected with distinct 403 codes (AUTH_PENDING_VERIFICATION, AUTH_ACCOUNT_SUSPENDED, AUTH_ACCOUNT_DISABLED, AUTH_INVITATION_PENDING). Rate limited per IP and per identifier.
     */
    post: operations['login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/login/otp/request': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Request a login OTP (API-AUTH-LOGIN-OTP-REQUEST, FEAT-AUTH-03)
     * @description Sends a 6-digit login OTP over the verified channel (email or phone). Requires AUTH_LOGIN_OTP_ENABLED. Generic OTP_SENT response; unknown identifiers or unverified channels receive the same response without delivery.
     */
    post: operations['requestLoginOtp'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/login/otp/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Verify a login OTP and issue a session (API-AUTH-LOGIN-OTP-VERIFY, FEAT-AUTH-03)
     * @description Verifies the 6-digit login OTP (5-minute TTL, single use, max 5 wrong attempts) and returns the same session shape as password login.
     */
    post: operations['verifyLoginOtp'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/status': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get MFA enrollment and recovery status (API-AUTH-MFA-STATUS, FEAT-AUTH-05) */
    get: operations['getMfaStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/setup': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Initiate authenticator-app TOTP enrollment (API-AUTH-MFA-SETUP, FEAT-AUTH-05) */
    post: operations['startMfaSetup'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/setup/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify TOTP and activate MFA factor (API-AUTH-MFA-SETUP-VERIFY, FEAT-AUTH-05) */
    post: operations['verifyMfaSetup'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/challenge/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify TOTP login challenge (API-AUTH-MFA-CHALLENGE-VERIFY, FEAT-AUTH-05) */
    post: operations['verifyMfaChallenge'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/recovery/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify recovery code and issue session (API-AUTH-MFA-RECOVERY-VERIFY, FEAT-AUTH-05) */
    post: operations['verifyMfaRecovery'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/mfa/recovery-codes/regenerate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Regenerate recovery codes (API-AUTH-MFA-RECOVERY-REGENERATE, FEAT-AUTH-05) */
    post: operations['regenerateMfaRecoveryCodes'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/users/{user_id}/mfa/reset': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Admin reset user MFA factor (API-AUTH-MFA-ADMIN-RESET, FEAT-AUTH-05) */
    post: operations['adminResetUserMfa'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/permissions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List platform capability permissions catalog (FEAT-RBAC-01) */
    get: operations['listPermissions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/roles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List system and custom roles for tenant (FEAT-RBAC-01) */
    get: operations['listRoles'];
    put?: never;
    /** Create a custom role for tenant (FEAT-RBAC-01) */
    post: operations['createRole'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/roles/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get detailed role definition by id (FEAT-RBAC-01) */
    get: operations['getRoleById'];
    put?: never;
    post?: never;
    /** Delete an unassigned custom role (FEAT-RBAC-01) */
    delete: operations['deleteRole'];
    options?: never;
    head?: never;
    /** Update custom role definition (FEAT-RBAC-01) */
    patch: operations['updateRole'];
    trace?: never;
  };
  '/users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List merchant users (API-USR-LIST, FEAT-USR-02) */
    get: operations['listUsers'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/users/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get user details (API-USR-GET, FEAT-USR-02) */
    get: operations['getUser'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update user profile and scopes (API-USR-UPDATE, FEAT-USR-02) */
    patch: operations['updateUser'];
    trace?: never;
  };
  '/users/{id}/suspend': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Suspend user account (API-USR-SUSPEND, FEAT-USR-02) */
    post: operations['suspendUser'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/users/{id}/activate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Reinstate suspended user (API-USR-ACTIVATE, FEAT-USR-02) */
    post: operations['activateUser'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/users/{id}/deactivate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Deactivate user account (API-USR-DEACTIVATE, FEAT-USR-02) */
    post: operations['deactivateUser'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/users/check-scope': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Check user scope authorization (API-USR-CHECK-SCOPE, FEAT-USR-01) */
    post: operations['checkUserScope'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/invitations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List user invitations for merchant (API-USR-INVITE-LIST, FEAT-USR-01) */
    get: operations['listInvitations'];
    put?: never;
    /** Send team member invitation (API-USR-INVITE-SEND, FEAT-USR-01) */
    post: operations['createInvitation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/invitations/{id}/resend': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Resend user invitation (API-USR-INVITE-RESEND, FEAT-USR-01) */
    post: operations['resendInvitation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/invitations/{id}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Cancel pending user invitation (API-USR-INVITE-CANCEL, FEAT-USR-01) */
    post: operations['cancelInvitation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/invitations/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Public verification of invitation token (API-USR-INVITE-VERIFY, FEAT-USR-01)
     * @description Token is sent in the JSON body, never in the URL, so access logs, proxies and Referer never retain the plaintext secret (SECURITY-NFR / AC-USR-01-18).
     */
    post: operations['verifyInvitation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/invitations/accept': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Public acceptance of invitation and account setup (API-USR-INVITE-ACCEPT, FEAT-USR-01) */
    post: operations['acceptInvitation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get current authenticated user profile and preferences (FEAT-PRO-01) */
    get: operations['getMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update current authenticated user profile (FEAT-PRO-01) */
    patch: operations['updateMe'];
    trace?: never;
  };
  '/me/preferences': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get current user personal preferences (FEAT-PRO-01) */
    get: operations['getMyPreferences'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update current user personal preferences (FEAT-PRO-01) */
    patch: operations['updateMyPreferences'];
    trace?: never;
  };
  '/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List active sessions for current user (API-SESSION-LIST, FEAT-AUTH-06)
     * @description Returns all sessions for the authenticated user within the merchant tenant.
     *     Sessions expired by inactivity (30 days) or absolute lifetime (90 days) are
     *     marked EXPIRED. The current session is marked with is_current=true.
     */
    get: operations['listSessions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/sessions/{sessionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Revoke a single session (API-SESSION-REVOKE, FEAT-AUTH-06)
     * @description Revokes the specified session. Idempotent: revoking an already-revoked
     *     session returns success. Requires ownership (same user).
     */
    delete: operations['revokeSession'];
    options?: never;
    head?: never;
    /**
     * Update session last activity (heartbeat) (API-SESSION-HEARTBEAT, FEAT-AUTH-06)
     * @description Updates the last_active_at timestamp for the current session only.
     *     Returns 403 if session is not ACTIVE or not owned by caller.
     */
    patch: operations['heartbeatSession'];
    trace?: never;
  };
  '/sessions/revoke-all': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Revoke all sessions for current user (API-SESSION-REVOKE-ALL, FEAT-AUTH-06)
     * @description Revokes all active sessions for the authenticated user. Optionally includes
     *     the current session (logout everywhere). Returns count of revoked sessions.
     */
    post: operations['revokeAllSessions'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shops': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List authorized shops (FEAT-ORG-01) */
    get: operations['listShops'];
    put?: never;
    post: operations['createShop'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shops/profile': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get current shop profile (FEAT-ORG-01)
     * @description Returns the legal, billing and operating defaults of the caller's authorized shop.
     */
    get: operations['getShopProfile'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * Update current shop profile (FEAT-ORG-01)
     * @description Updates legal, billing and operating defaults. Requires iam:shop_config capability.
     */
    patch: operations['updateShopProfile'];
    trace?: never;
  };
  '/shops/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get shop profile by ID (FEAT-ORG-01)
     * @description Returns the shop profile by ID with strict server-side tenant scoping.
     */
    get: operations['getShopById'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * Update shop profile by ID (FEAT-ORG-01)
     * @description Updates shop profile by ID with strict server-side tenant scoping and permission enforcement.
     */
    patch: operations['updateShopById'];
    trace?: never;
  };
  '/admin/shops': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List all shops (admin) (API-ADMIN-SHOP-LIST, FEAT-AUTH-02) */
    get: operations['listAdminShops'];
    put?: never;
    /**
     * Admin-created shop account (API-ADMIN-SHOP-CREATE, FEAT-AUTH-02)
     * @description Platform operator provisions initial shop owner account without exposing public self-registration.
     */
    post: operations['createAdminShop'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/carrier-accounts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listCarrierAccounts'];
    put?: never;
    post: operations['connectCarrierAccount'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/carrier-accounts/{id}/test': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['testCarrierAccount'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/orders': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listOrders'];
    put?: never;
    post: operations['createOrder'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/orders/{id}/shipping-options': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['getShippingOptions'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/orders/{id}/routing-decision': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['selectShippingOption'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['createShipment'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getShipment'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments/{id}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['cancelShipment'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments/{id}/label': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getShipmentLabel'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments/{id}/redelivery': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['requestRedelivery'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/shipments/{id}/tracking': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getTracking'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/audit-periods': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['createAuditPeriod'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/audit-periods/{id}/runs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['runAudit'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/batches/{id}/bank-allocations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['allocateBankTransaction'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/cases/{id}/transitions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['transitionCase'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    AdminCreateShopInput: {
      merchant_name: string;
      full_name?: string;
      /** Format: email */
      email?: string;
      phone?: string;
      password?: string;
    };
    AdminCreateShopResponse: {
      /** @example true */
      success: boolean;
      data: {
        merchant: {
          /** Format: uuid */
          id: string;
          name: string;
          code: string;
          status: string;
          /** Format: date-time */
          created_at: string;
        };
        user: {
          /** Format: uuid */
          id: string;
          /** Format: uuid */
          merchant_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          role: string;
          status: string;
          /** Format: date-time */
          email_verified_at?: string | null;
          /** Format: date-time */
          phone_verified_at?: string | null;
        };
        password_is_temporary: boolean;
      };
      meta?: components['schemas']['Meta'];
    };
    AdminListShopsResponse: {
      /** @example true */
      success: boolean;
      data: {
        shops: {
          /** Format: uuid */
          id: string;
          name: string;
          code: string;
          status: string;
          /** Format: date-time */
          created_at: string;
          user_count?: number;
          owner?: {
            id?: string;
            full_name?: string;
            email?: string | null;
            phone?: string | null;
          } | null;
        }[];
        total: number;
      };
      meta?: components['schemas']['Meta'];
    };
    RegisterRequest: {
      merchant_name: string;
      full_name: string;
      /** Format: email */
      email?: string;
      phone?: string;
      /** Format: password */
      password: string;
      terms_accepted: boolean;
      terms_version: string;
    };
    RegistrationResponse: {
      data: {
        /** Format: uuid */
        user_id: string;
        /** Format: uuid */
        merchant_id: string;
        /** @enum {string} */
        status: 'PENDING_VERIFICATION' | 'ACTIVE';
        email?: string;
        phone?: string;
        message?: string;
      };
      meta: components['schemas']['Meta'];
    };
    VerifyEmailRequest: {
      token: string;
    };
    VerifyPhoneRequest: {
      phone: string;
      otp: string;
    };
    VerifyResponse: {
      data: {
        /** Format: uuid */
        user_id: string;
        /** Format: uuid */
        merchant_id: string;
        /** @enum {string} */
        status: 'PENDING_VERIFICATION' | 'ACTIVE';
        /** @enum {string} */
        channel: 'email' | 'phone';
        verified: boolean;
      };
      meta: components['schemas']['Meta'];
    };
    ResendVerificationRequest: {
      identifier: string;
      /** @enum {string} */
      channel: 'email' | 'phone';
    };
    ResendVerificationResponse: {
      data: {
        /** @enum {string} */
        status: 'SENT' | 'RATE_LIMITED';
        /** @enum {string} */
        channel: 'email' | 'phone';
        cooldown_seconds?: number;
      };
      meta: components['schemas']['Meta'];
    };
    LoginRequest: {
      /** @description Email or Vietnamese phone number of the account. */
      identifier: string;
      /** Format: password */
      password: string;
      /** @default false */
      remember_device: boolean;
    };
    AuthenticatedUser: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      merchant_id: string;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      /** @enum {string} */
      role: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT';
      /** @enum {string} */
      status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'DISABLED' | 'INVITED';
      /** Format: date-time */
      email_verified_at?: string | null;
      /** Format: date-time */
      phone_verified_at?: string | null;
      /** Format: date-time */
      created_at: string;
    };
    AuthenticatedMerchant: {
      /** Format: uuid */
      id: string;
      name: string;
      business_code?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      status?: string | null;
      /** Format: date-time */
      created_at: string;
    };
    AuthResponse: {
      data: {
        /** @enum {string} */
        status: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'ORG_SELECTION_REQUIRED';
        access_token?: string;
        /** @description Access token lifetime in seconds (present when access_token is returned). */
        expires_in?: number;
        challenge_id?: string;
        user?: components['schemas']['AuthenticatedUser'];
        merchant?: components['schemas']['AuthenticatedMerchant'];
      };
      meta: components['schemas']['Meta'];
    };
    LoginOtpRequestRequest: {
      /** @description Email or Vietnamese phone number of the account. */
      identifier: string;
    };
    LoginOtpChallengeResponse: {
      data: {
        /** @enum {string} */
        status: 'OTP_SENT';
        /** @enum {string} */
        channel: 'email' | 'phone';
        /** @description Masked recipient, e.g. m***@shipde.vn or 0901***4567. */
        recipient_masked: string;
        cooldown_seconds: number;
        expires_in_seconds: number;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    LoginOtpVerifyRequest: {
      /** @description Email or Vietnamese phone number of the account. */
      identifier: string;
      otp: string;
    };
    ShopInput: {
      name: string;
      legal_name?: string;
      tax_code?: string;
      /** @default Asia/Ho_Chi_Minh */
      timezone: string;
    };
    ShopProfile: {
      /** Format: uuid */
      id: string;
      name: string;
      code: string;
      status: string;
      legal_name?: string | null;
      tax_code?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
      legal_address?: string | null;
      billing_email?: string | null;
      billing_address?: string | null;
      bank_name?: string | null;
      bank_account_number?: string | null;
      bank_account_name?: string | null;
      bank_branch?: string | null;
      /** @default Asia/Ho_Chi_Minh */
      timezone: string;
      /** @default VND */
      currency: string;
      /**
       * @default SHOP
       * @enum {string}
       */
      default_fee_payer: 'SHOP' | 'RECIPIENT';
      /**
       * @default g
       * @enum {string}
       */
      default_weight_unit: 'g' | 'kg';
      /** @default false */
      auto_routing_enabled: boolean;
      operating_notes?: string | null;
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      updated_at: string;
    };
    UpdateShopProfileInput: {
      name?: string;
      legal_name?: string | null;
      tax_code?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
      legal_address?: string | null;
      billing_email?: string | null;
      billing_address?: string | null;
      bank_name?: string | null;
      bank_account_number?: string | null;
      bank_account_name?: string | null;
      bank_branch?: string | null;
      timezone?: string;
      currency?: string;
      /** @enum {string} */
      default_fee_payer?: 'SHOP' | 'RECIPIENT';
      /** @enum {string} */
      default_weight_unit?: 'g' | 'kg';
      auto_routing_enabled?: boolean;
      operating_notes?: string | null;
    };
    ShopProfileResponse: {
      success: boolean;
      data: components['schemas']['ShopProfile'];
      meta: components['schemas']['Meta'];
    };
    ListShopsResponse: {
      success: boolean;
      data: {
        shops: components['schemas']['ShopProfile'][];
      };
      meta: components['schemas']['Meta'];
    };
    CarrierAccountInput: {
      /** @enum {string} */
      carrier_code: 'GHN' | 'GHTK' | 'VIETTEL_POST' | 'JT_EXPRESS';
      alias: string;
      /** @enum {string} */
      permission_profile: 'OBSERVE' | 'ACTION';
      credential: {
        [key: string]: unknown;
      };
    };
    SourceOrderInput: {
      source_order_code: string;
      /** Format: uuid */
      warehouse_id: string;
      recipient: {
        name: string;
        phone: string;
      };
      address: {
        line1: string;
        province: string;
        district: string;
        ward: string;
      };
      expected_cod_vnd: number;
      /** @enum {string} */
      fee_payer: 'SHOP' | 'RECIPIENT' | 'OTHER';
      parcels: components['schemas']['ParcelInput'][];
    };
    ParcelInput: {
      weight_gram: number;
      length_cm?: number;
      width_cm?: number;
      height_cm?: number;
      declared_value_vnd: number;
    };
    AuditPeriodInput: {
      /** Format: uuid */
      carrier_account_id: string;
      /** Format: date */
      period_start: string;
      /** Format: date */
      period_end: string;
    };
    BankAllocationInput: {
      /** Format: uuid */
      bank_transaction_id: string;
      allocated_amount_vnd: number;
      confirmation_note?: string;
    };
    CaseTransitionInput: {
      target_status: string;
      reason: string;
      evidence_ids?: string[];
      amount_vnd?: number;
    };
    CommandResponse: {
      data: {
        /** Format: uuid */
        command_id: string;
        /** @enum {string} */
        status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
        /** Format: uuid */
        resource_id?: string;
        next_action?: string;
      };
      meta: components['schemas']['Meta'];
    };
    ErrorResponse: {
      error: {
        code: string;
        message: string;
        retryable: boolean;
        /**
         * @description Next action instructed for the client (e.g. 'LOGIN' on 401 SESSION_INVALID under AC-SESS-06)
         * @example LOGIN
         */
        next_action?: string;
        fields?: {
          field?: string;
          code?: string;
          message?: string;
        }[];
      };
      meta: components['schemas']['Meta'];
    };
    Meta: {
      correlation_id: string;
    };
    LivenessResponse: {
      /** @enum {string} */
      status: 'ok';
      /** @example api */
      service: string;
      /** Format: date-time */
      timestamp: string;
      /** @example 123e4567-e89b-12d3-a456-426614174000 */
      correlationId: string;
    };
    SessionInfo: {
      /** Format: uuid */
      session_id: string;
      device_id: string;
      device_model?: string;
      user_agent?: string;
      /** @description SHA-256 truncated hash of IP address */
      ip_address?: string;
      /** @enum {string} */
      status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'INACTIVE';
      /** Format: date-time */
      last_active_at: string;
      /** Format: date-time */
      expires_at: string;
      /** Format: date-time */
      created_at: string;
      /** @description True if this is the current session making the request */
      is_current: boolean;
    };
    ListSessionsResponse: {
      data: components['schemas']['SessionInfo'][];
      meta: components['schemas']['Meta'];
    };
    RevokeSessionResponse: {
      /** Format: uuid */
      session_id: string;
      /** @enum {string} */
      status: 'REVOKED';
      message: string;
    };
    RevokeAllSessionsRequest: {
      /** @default false */
      include_current: boolean;
    };
    RevokeAllSessionsResponse: {
      revoked_count: number;
      message: string;
    };
    HeartbeatSessionResponse: {
      /** Format: uuid */
      session_id: string;
      /** Format: date-time */
      last_active_at: string;
    };
    ReadinessResponse: {
      /** @enum {string} */
      status: 'ok' | 'error';
      /** @example api */
      service: string;
      /** Format: date-time */
      timestamp: string;
      /** @example 123e4567-e89b-12d3-a456-426614174000 */
      correlationId: string;
      checks: {
        /** @enum {string} */
        database: 'up' | 'down';
        /** @enum {string} */
        redis: 'up' | 'down';
        /** @enum {string} */
        storage: 'up' | 'down';
      } & {
        [key: string]: 'up' | 'down';
      };
    };
    MfaStatusResponse: {
      data: {
        /** @enum {string} */
        status: 'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'RESET';
        required: boolean;
        recovery_codes_remaining: number;
        /** Format: date-time */
        mfa_verified_at?: string | null;
      };
      meta: components['schemas']['Meta'];
    };
    MfaSetupRequest: {
      password: string;
    };
    MfaSetupResponse: {
      data: {
        secret_key: string;
        provisioning_uri: string;
        /** Format: date-time */
        expires_at: string;
        expires_in_seconds: number;
      };
      meta: components['schemas']['Meta'];
    };
    MfaSetupVerifyRequest: {
      code: string;
    };
    MfaSetupVerifyResponse: {
      data: {
        /** @enum {string} */
        status: 'AUTHENTICATED';
        recovery_codes: string[];
        access_token: string;
        expires_in: number;
        user: components['schemas']['AuthenticatedUser'];
        merchant: components['schemas']['AuthenticatedMerchant'];
      };
      meta: components['schemas']['Meta'];
    };
    MfaChallengeVerifyRequest: {
      challenge_id: string;
      code: string;
    };
    MfaRecoveryVerifyRequest: {
      challenge_id: string;
      recovery_code: string;
    };
    MfaRecoveryVerifyResponse: {
      data: {
        /** @enum {string} */
        status: 'AUTHENTICATED';
        access_token: string;
        expires_in: number;
        recovery_codes_remaining: number;
        user: components['schemas']['AuthenticatedUser'];
        merchant: components['schemas']['AuthenticatedMerchant'];
      };
      meta: components['schemas']['Meta'];
    };
    MfaRegenerateRecoveryCodesRequest: {
      password: string;
      code: string;
    };
    MfaRegenerateRecoveryCodesResponse: {
      data: {
        recovery_codes: string[];
      };
      meta: components['schemas']['Meta'];
    };
    MfaAdminResetRequest: {
      reason: string;
    };
    MfaAdminResetResponse: {
      data: {
        /** Format: uuid */
        target_user_id: string;
        reset: boolean;
        revoked_sessions_count: number;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    PermissionItem: {
      /** Format: uuid */
      id: string;
      code: string;
      name: string;
      description?: string | null;
      category: string;
    };
    PermissionsResponse: {
      data: {
        permissions: components['schemas']['PermissionItem'][];
        categories: string[];
      };
      meta: components['schemas']['Meta'];
    };
    RoleItem: {
      /** Format: uuid */
      id: string;
      code?: string | null;
      name: string;
      description?: string | null;
      is_system: boolean;
      /** Format: uuid */
      merchant_id?: string | null;
      permissions_count: number;
      permissions: components['schemas']['PermissionItem'][];
      user_count: number;
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      updated_at: string;
    };
    RolesResponse: {
      data: {
        roles: components['schemas']['RoleItem'][];
        /** @description Whether the authenticated actor has server permission iam:manage_users to modify roles */
        can_manage_roles?: boolean;
      };
      meta: components['schemas']['Meta'];
    };
    RoleDetailResponse: {
      data: {
        role: components['schemas']['RoleItem'];
      };
      meta: components['schemas']['Meta'];
    };
    CreateRoleRequest: {
      name: string;
      description?: string | null;
      permissions: string[];
    };
    UpdateRoleRequest: {
      name?: string;
      description?: string | null;
      permissions?: string[];
    };
    DeleteRoleResponse: {
      data: {
        /** Format: uuid */
        id: string;
        deleted: boolean;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    /** @enum {string} */
    InvitationStatus: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
    SendInvitationRequest: {
      /** Format: email */
      email?: string;
      phone?: string;
      /** @enum {string} */
      role: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT';
      store_scopes?: string[];
      warehouse_scopes?: string[];
    };
    InvitationItem: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      merchant_id: string;
      email?: string | null;
      phone?: string | null;
      /** @enum {string} */
      role: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT';
      store_scopes?: string[];
      warehouse_scopes?: string[];
      status: components['schemas']['InvitationStatus'];
      /** Format: uuid */
      invited_by_user_id?: string | null;
      /** Format: date-time */
      expires_at: string;
      /** Format: date-time */
      consumed_at?: string | null;
      /** Format: date-time */
      created_at: string;
    };
    SendInvitationResponse: {
      data: components['schemas']['InvitationItem'];
      meta: components['schemas']['Meta'];
    };
    ListInvitationsResponse: {
      data: components['schemas']['InvitationItem'][];
      meta: {
        total: number;
        page: number;
        limit: number;
        correlation_id: string;
      };
    };
    ResendInvitationResponse: {
      data: {
        /** Format: uuid */
        id: string;
        status: components['schemas']['InvitationStatus'];
        /** Format: date-time */
        expires_at: string;
      };
      meta: components['schemas']['Meta'];
    };
    CancelInvitationResponse: {
      data: {
        /** Format: uuid */
        id: string;
        status: components['schemas']['InvitationStatus'];
      };
      meta: components['schemas']['Meta'];
    };
    VerifyInvitationResponse: {
      data: {
        valid: boolean;
        tenant_name: string;
        role: string;
        identifier: string;
        store_scopes?: string[];
        warehouse_scopes?: string[];
      };
      meta: components['schemas']['Meta'];
    };
    AcceptInvitationRequest: {
      token: string;
      full_name: string;
      password: string;
      password_confirm?: string;
    };
    AcceptInvitationResponse: {
      data: {
        /** Format: uuid */
        user_id: string;
        email?: string | null;
        phone?: string | null;
        full_name: string;
        role: string;
        status: string;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    CheckScopeRequest: {
      store_id?: string;
      warehouse_id?: string;
    };
    CheckScopeResponse: {
      data: {
        authorized: boolean;
        /** Format: uuid */
        user_id: string;
        role: string;
        store_scopes: string[];
        warehouse_scopes: string[];
      };
      meta: components['schemas']['Meta'];
    };
    NotificationChannels: {
      email?: boolean;
      in_app?: boolean;
      push?: boolean;
    };
    NotificationSubscriptions: {
      delivery_fail?: boolean;
      rate_discrepancy?: boolean;
      cod_overdue?: boolean;
      claim_deadline_warning?: boolean;
      abnormal_return?: boolean;
      security_alerts?: boolean;
      create_unknown?: boolean;
    };
    NotificationPreferences: {
      channels?: components['schemas']['NotificationChannels'];
      /** @example 15 */
      digest_window_minutes?: number;
      subscriptions?: components['schemas']['NotificationSubscriptions'];
    };
    UserProfile: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      merchant_id?: string | null;
      /** Format: email */
      email?: string | null;
      phone?: string | null;
      full_name: string;
      role: string;
      status?: string;
      avatar_url?: string | null;
      /** @example vi */
      language: string;
      /** @example Asia/Ho_Chi_Minh */
      timezone: string;
      /** Format: uuid */
      default_warehouse_id?: string | null;
      store_scopes?: string[];
      warehouse_scopes?: string[];
      /** Format: uuid */
      custom_role_id?: string | null;
      notification_preferences?: components['schemas']['NotificationPreferences'];
      merchant?: {
        /** Format: uuid */
        id?: string;
        name?: string;
      } | null;
      /** Format: date-time */
      created_at?: string;
    };
    UserPreferences: {
      /** @example vi */
      language: string;
      /** @example Asia/Ho_Chi_Minh */
      timezone: string;
      /** Format: uuid */
      default_warehouse_id?: string | null;
      notification_preferences?: components['schemas']['NotificationPreferences'];
    };
    GetMeResponse: {
      data: components['schemas']['UserProfile'];
      meta?: components['schemas']['Meta'];
    };
    UpdateMeRequest: {
      full_name?: string;
      phone?: string | null;
      avatar_url?: string | null;
      /** @enum {string} */
      language?: 'vi' | 'en';
      timezone?: string;
      /** Format: uuid */
      default_warehouse_id?: string | null;
      notification_preferences?: components['schemas']['NotificationPreferences'];
    };
    UpdateMeResponse: {
      data: components['schemas']['UserProfile'];
      meta?: components['schemas']['Meta'];
    };
    GetPreferencesResponse: {
      data: components['schemas']['UserPreferences'];
      meta?: components['schemas']['Meta'];
    };
    UpdatePreferencesRequest: {
      /** @enum {string} */
      language?: 'vi' | 'en';
      timezone?: string;
      /** Format: uuid */
      default_warehouse_id?: string | null;
      notification_preferences?: components['schemas']['NotificationPreferences'];
    };
    UpdatePreferencesResponse: {
      data: components['schemas']['UserPreferences'];
      meta?: components['schemas']['Meta'];
    };
    UserListItem: {
      /** Format: uuid */
      id: string;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      /** @enum {string} */
      role: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'FINANCE';
      /** @enum {string} */
      status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'PENDING_VERIFICATION' | 'INVITED';
      store_scopes: string[];
      warehouse_scopes: string[];
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      last_active_at?: string | null;
    };
    ListUsersResponse: {
      data: components['schemas']['UserListItem'][];
      meta: {
        total: number;
        page: number;
        limit: number;
        total_pages: number;
        correlation_id: string;
      };
    };
    UserDetail: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      merchant_id: string;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      /** @enum {string} */
      role: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'FINANCE';
      /** @enum {string} */
      status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'PENDING_VERIFICATION' | 'INVITED';
      store_scopes: string[];
      warehouse_scopes: string[];
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      updated_at: string;
      /** Format: date-time */
      last_active_at?: string | null;
    };
    UserDetailResponse: {
      data: components['schemas']['UserDetail'];
      meta: components['schemas']['Meta'];
    };
    UpdateUserRequest: {
      full_name?: string;
      /** @enum {string} */
      role?: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'FINANCE';
      store_scopes?: string[];
      warehouse_scopes?: string[];
    };
    SuspendUserRequest: {
      reason: string;
    };
    SuspendUserResponse: {
      data: {
        /** Format: uuid */
        id: string;
        status: string;
        revoked_sessions_count: number;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    ActivateUserRequest: {
      reason?: string;
    };
    ActivateUserResponse: {
      data: {
        /** Format: uuid */
        id: string;
        status: string;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
    DeactivateUserRequest: {
      reason?: string;
    };
    DeactivateUserResponse: {
      data: {
        /** Format: uuid */
        id: string;
        status: string;
        revoked_sessions_count: number;
        message: string;
      };
      meta: components['schemas']['Meta'];
    };
  };
  responses: {
    /** @description Canonical error */
    Error: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorResponse'];
      };
    };
    /** @description Unauthenticated request — missing or empty authorization header (UNAUTHENTICATED under AC-SESS-19) */
    Unauthenticated: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        /**
         * @example {
         *       "error": {
         *         "code": "UNAUTHENTICATED",
         *         "message": "Vui lòng đăng nhập để tiếp tục",
         *         "retryable": false
         *       },
         *       "meta": {
         *         "correlation_id": "123e4567-e89b-12d3-a456-426614174000"
         *       }
         *     }
         */
        'application/json': components['schemas']['ErrorResponse'];
      };
    };
    /** @description Unauthorized request — missing token (UNAUTHENTICATED under AC-SESS-19) or expired/revoked/invalid session (SESSION_INVALID with next_action LOGIN under AC-SESS-06) */
    SessionInvalid: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorResponse'];
      };
    };
    /** @description Rate limit exceeded (RATE_LIMITED) */
    RateLimited: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorResponse'];
      };
    };
    /** @description Command accepted */
    CommandAccepted: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['CommandResponse'];
      };
    };
  };
  parameters: {
    Id: string;
    SessionId: string;
    IdempotencyKey: string;
    Page: number;
    PageSize: number;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  getHealthLive: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process event loop is alive */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LivenessResponse'];
        };
      };
    };
  };
  getHealthReady: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description All required dependencies are healthy */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReadinessResponse'];
        };
      };
      /** @description One or more dependencies are unavailable */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReadinessResponse'];
        };
      };
    };
  };
  register: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterRequest'];
      };
    };
    responses: {
      /** @description Registration initiated, pending verification */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RegistrationResponse'];
        };
      };
      400: components['responses']['Error'];
      429: components['responses']['RateLimited'];
    };
  };
  verifyEmail: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['VerifyEmailRequest'];
      };
    };
    responses: {
      /** @description Email verified successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VerifyResponse'];
        };
      };
      400: components['responses']['Error'];
      410: components['responses']['Error'];
    };
  };
  verifyPhone: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['VerifyPhoneRequest'];
      };
    };
    responses: {
      /** @description Phone verified successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VerifyResponse'];
        };
      };
      400: components['responses']['Error'];
      410: components['responses']['Error'];
    };
  };
  resendVerification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ResendVerificationRequest'];
      };
    };
    responses: {
      /** @description Verification token or OTP resent */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ResendVerificationResponse'];
        };
      };
      400: components['responses']['Error'];
      429: components['responses']['RateLimited'];
    };
  };
  login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginRequest'];
      };
    };
    responses: {
      /** @description Authenticated or MFA challenge */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
      400: components['responses']['Error'];
      /** @description INVALID_CREDENTIALS */
      401: components['responses']['Error'];
      /** @description Account status gate or OTP login disabled */
      403: components['responses']['Error'];
      429: components['responses']['RateLimited'];
    };
  };
  requestLoginOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginOtpRequestRequest'];
      };
    };
    responses: {
      /** @description Generic OTP challenge (anti-enumeration) */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LoginOtpChallengeResponse'];
        };
      };
      400: components['responses']['Error'];
      /** @description AUTH_OTP_LOGIN_DISABLED when OTP login is not enabled */
      403: components['responses']['Error'];
      429: components['responses']['RateLimited'];
    };
  };
  verifyLoginOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginOtpVerifyRequest'];
      };
    };
    responses: {
      /** @description Authenticated session */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
      /** @description INVALID_OTP */
      400: components['responses']['Error'];
      /** @description Account status gate or OTP login disabled */
      403: components['responses']['Error'];
      /** @description OTP_ALREADY_CONSUMED or OTP_EXPIRED */
      410: components['responses']['Error'];
      /** @description OTP_MAX_ATTEMPTS_EXCEEDED or RATE_LIMITED */
      429: components['responses']['RateLimited'];
    };
  };
  getMfaStatus: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current MFA status */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaStatusResponse'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  startMfaSetup: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaSetupRequest'];
      };
    };
    responses: {
      /** @description Provisioning URI and manual secret key */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaSetupResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      /** @description MFA already active */
      409: components['responses']['Error'];
    };
  };
  verifyMfaSetup: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaSetupVerifyRequest'];
      };
    };
    responses: {
      /** @description Factor activated, returns 10 recovery codes and authenticated session */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaSetupVerifyResponse'];
        };
      };
      400: components['responses']['Error'];
      /** @description Activation conflict */
      409: components['responses']['Error'];
      /** @description Setup expired */
      410: components['responses']['Error'];
    };
  };
  verifyMfaChallenge: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaChallengeVerifyRequest'];
      };
    };
    responses: {
      /** @description Session issued with auth_assurance=MFA */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
      /** @description Invalid TOTP code */
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      /** @description Challenge expired or consumed */
      410: components['responses']['Error'];
      /** @description Rate limited (challenge or IP threshold) */
      429: components['responses']['RateLimited'];
    };
  };
  verifyMfaRecovery: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaRecoveryVerifyRequest'];
      };
    };
    responses: {
      /** @description Code consumed and session issued */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaRecoveryVerifyResponse'];
        };
      };
      /** @description Invalid or already consumed recovery code */
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      /** @description Challenge expired or consumed */
      410: components['responses']['Error'];
      429: components['responses']['RateLimited'];
    };
  };
  regenerateMfaRecoveryCodes: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaRegenerateRecoveryCodesRequest'];
      };
    };
    responses: {
      /** @description 10 new one-time recovery codes displayed once */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaRegenerateRecoveryCodesResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
    };
  };
  adminResetUserMfa: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        user_id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MfaAdminResetRequest'];
      };
    };
    responses: {
      /** @description Factor reset and sessions revoked */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MfaAdminResetResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      /** @description Idempotency conflict */
      409: components['responses']['Error'];
    };
  };
  listPermissions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of all canonical platform capability permissions grouped by category */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PermissionsResponse'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  listRoles: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of system roles and merchant-scoped custom roles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RolesResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  createRole: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateRoleRequest'];
      };
    };
    responses: {
      /** @description Role created successfully */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RoleDetailResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  getRoleById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Role detail including capability permissions and assigned user count */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RoleDetailResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  deleteRole: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Role deleted successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DeleteRoleResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  updateRole: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateRoleRequest'];
      };
    };
    responses: {
      /** @description Role updated successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RoleDetailResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  listUsers: {
    parameters: {
      query?: {
        page?: number;
        limit?: number;
        role?: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'FINANCE';
        status?: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'PENDING_VERIFICATION' | 'INVITED';
        search?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of tenant users */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListUsersResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  getUser: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description User profile and scopes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserDetailResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  updateUser: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateUserRequest'];
      };
    };
    responses: {
      /** @description Updated user profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserDetailResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  suspendUser: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SuspendUserRequest'];
      };
    };
    responses: {
      /** @description User suspended and sessions revoked */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SuspendUserResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  activateUser: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': components['schemas']['ActivateUserRequest'];
      };
    };
    responses: {
      /** @description User reinstated to active status */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ActivateUserResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  deactivateUser: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': components['schemas']['DeactivateUserRequest'];
      };
    };
    responses: {
      /** @description User deactivated and sessions revoked */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DeactivateUserResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  checkUserScope: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CheckScopeRequest'];
      };
    };
    responses: {
      /** @description Scope authorization successful */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CheckScopeResponse'];
        };
      };
      401: components['responses']['Error'];
      /** @description Scope access denied */
      403: components['responses']['Error'];
    };
  };
  listInvitations: {
    parameters: {
      query?: {
        status?: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'ALL';
        page?: number;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of invitations */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListInvitationsResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  createInvitation: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SendInvitationRequest'];
      };
    };
    responses: {
      /** @description Invitation created and sent */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SendInvitationResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  resendInvitation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Invitation resent and expiration extended */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ResendInvitationResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  cancelInvitation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Invitation cancelled */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CancelInvitationResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  verifyInvitation: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          token: string;
        };
      };
    };
    responses: {
      /** @description Token is valid and unexpired */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VerifyInvitationResponse'];
        };
      };
      /** @description Token not found, expired, cancelled, or already used */
      404: components['responses']['Error'];
    };
  };
  acceptInvitation: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AcceptInvitationRequest'];
      };
    };
    responses: {
      /** @description Invitation accepted and account activated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AcceptInvitationResponse'];
        };
      };
      /** @description Invalid password, expired token, or token already used */
      400: components['responses']['Error'];
      /** @description Token not found or cancelled */
      404: components['responses']['Error'];
    };
  };
  getMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current user profile, merchant metadata, and personal preferences */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetMeResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
    };
  };
  updateMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateMeRequest'];
      };
    };
    responses: {
      /** @description Profile updated successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UpdateMeResponse'];
        };
      };
      /** @description Validation error or invalid phone/timezone format */
      400: components['responses']['Error'];
      401: components['responses']['SessionInvalid'];
      /** @description Privilege escalation denied or warehouse scope unauthorized */
      403: components['responses']['Error'];
      /** @description Phone number already exists */
      409: components['responses']['Error'];
    };
  };
  getMyPreferences: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current user preferences */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetPreferencesResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
    };
  };
  updateMyPreferences: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdatePreferencesRequest'];
      };
    };
    responses: {
      /** @description Preferences updated successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UpdatePreferencesResponse'];
        };
      };
      /** @description Validation error or critical notification cannot be disabled */
      400: components['responses']['Error'];
      401: components['responses']['SessionInvalid'];
      /** @description Warehouse scope unauthorized */
      403: components['responses']['Error'];
    };
  };
  listSessions: {
    parameters: {
      query?: {
        page?: components['parameters']['Page'];
        page_size?: components['parameters']['PageSize'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Paged list of sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListSessionsResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
    };
  };
  revokeSession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        sessionId: components['parameters']['SessionId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RevokeSessionResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
      /** @description Not owner of session or cross-tenant */
      403: components['responses']['Error'];
      /** @description Session not found */
      404: components['responses']['Error'];
    };
  };
  heartbeatSession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        sessionId: components['parameters']['SessionId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Heartbeat updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HeartbeatSessionResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
      /** @description Session not active or not owned by caller */
      403: components['responses']['Error'];
      /** @description Session not found */
      404: components['responses']['Error'];
    };
  };
  revokeAllSessions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RevokeAllSessionsRequest'];
      };
    };
    responses: {
      /** @description All sessions revoked */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RevokeAllSessionsResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
    };
  };
  listShops: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Authorized shops */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListShopsResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
      403: components['responses']['Error'];
    };
  };
  createShop: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ShopInput'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['Error'];
    };
  };
  getShopProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current shop profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ShopProfileResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
      403: components['responses']['Error'];
    };
  };
  updateShopProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateShopProfileInput'];
      };
    };
    responses: {
      /** @description Updated shop profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ShopProfileResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['SessionInvalid'];
      403: components['responses']['Error'];
    };
  };
  getShopById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Shop profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ShopProfileResponse'];
        };
      };
      401: components['responses']['SessionInvalid'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  updateShopById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateShopProfileInput'];
      };
    };
    responses: {
      /** @description Updated shop profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ShopProfileResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['SessionInvalid'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  listAdminShops: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number;
        search?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of shops */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminListShopsResponse'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  createAdminShop: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AdminCreateShopInput'];
      };
    };
    responses: {
      /** @description Shop and owner created successfully */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminCreateShopResponse'];
        };
      };
      400: components['responses']['Error'];
      401: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  listCarrierAccounts: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Carrier accounts in scope */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  connectCarrierAccount: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CarrierAccountInput'];
      };
    };
    responses: {
      /** @description Connection test queued */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['Error'];
    };
  };
  testCarrierAccount: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['CommandAccepted'];
    };
  };
  listOrders: {
    parameters: {
      query?: {
        page?: components['parameters']['Page'];
        page_size?: components['parameters']['PageSize'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Paged source orders */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  createOrder: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SourceOrderInput'];
      };
    };
    responses: {
      /** @description Source order created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['Error'];
    };
  };
  getShippingOptions: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['CommandAccepted'];
    };
  };
  selectShippingOption: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          quote_id: string;
          override_reason?: string;
        };
      };
    };
    responses: {
      /** @description Routing decision persisted */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      409: components['responses']['Error'];
    };
  };
  createShipment: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          source_order_id: string;
          /** Format: uuid */
          routing_decision_id: string;
        };
      };
    };
    responses: {
      202: components['responses']['CommandAccepted'];
      409: components['responses']['Error'];
    };
  };
  getShipment: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Shipment detail */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['Error'];
    };
  };
  cancelShipment: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          reason: string;
        };
      };
    };
    responses: {
      202: components['responses']['CommandAccepted'];
    };
  };
  getShipmentLabel: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Private label download reference or bytes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  requestRedelivery: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['CommandAccepted'];
    };
  };
  getTracking: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Canonical and raw-safe timeline */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  createAuditPeriod: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AuditPeriodInput'];
      };
    };
    responses: {
      /** @description Period created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  runAudit: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['CommandAccepted'];
    };
  };
  allocateBankTransaction: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BankAllocationInput'];
      };
    };
    responses: {
      /** @description Allocation confirmed */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      409: components['responses']['Error'];
    };
  };
  transitionCase: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        id: components['parameters']['Id'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CaseTransitionInput'];
      };
    };
    responses: {
      /** @description Case transition recorded */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      409: components['responses']['Error'];
    };
  };
}
