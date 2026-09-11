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
  '/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['login'];
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
    get: operations['getMe'];
    put?: never;
    post?: never;
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
    get: operations['listShops'];
    put?: never;
    post: operations['createShop'];
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
    LoginRequest: {
      identifier: string;
      /** Format: password */
      password: string;
      /** @default false */
      remember_device: boolean;
    };
    AuthResponse: {
      data?: {
        /** @enum {string} */
        status?: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'ORG_SELECTION_REQUIRED';
        access_token?: string;
        challenge_id?: string;
      };
    };
    ShopInput: {
      name: string;
      legal_name?: string;
      tax_code?: string;
      /** @default Asia/Ho_Chi_Minh */
      timezone: string;
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
      401: components['responses']['Error'];
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
      /** @description Current user and memberships */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
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
        content?: never;
      };
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
