# Carrier Adapter Contract

## Goals

- One canonical interface for frontend/domain services.
- Carrier-specific payloads and statuses remain inside adapters.
- Capability checks precede commands.
- Adapters preserve raw evidence and return normalized outcomes.

## Canonical methods

\`\`\`typescript
interface CarrierAdapter {
  testConnection(ctx: AccountContext): Promise<ConnectionTest>;
  getCapabilities(ctx: AccountContext): Promise<CapabilitySet>;
  normalizeAddress(input: CanonicalAddress): Promise<AddressMappingResult>;
  checkServiceability(input: ServiceabilityRequest): Promise<ServiceabilityResult>;
  getQuotes(input: QuoteRequest): Promise<CarrierQuote[]>;
  createShipment(input: CreateShipmentRequest, idem: IdempotencyContext): Promise<CommandResult>;
  findShipmentByClientRef(input: ClientReferenceLookup): Promise<RemoteShipmentLookup>;
  getShipment(input: ShipmentLookup): Promise<CarrierShipment>;
  updateShipment(input: UpdateShipmentRequest, idem: IdempotencyContext): Promise<CommandResult>;
  cancelShipment(input: CancelShipmentRequest, idem: IdempotencyContext): Promise<CommandResult>;
  getLabel(input: LabelRequest): Promise<LabelResult>;
  requestPickup(input: PickupRequest, idem: IdempotencyContext): Promise<CommandResult>;
  trackShipment(input: ShipmentLookup): Promise<CarrierTrackingResult>;
  requestRedelivery(input: RedeliveryRequest, idem: IdempotencyContext): Promise<CommandResult>;
  fetchSettlement(input: SettlementRequest): Promise<SettlementResult>;
  submitClaim(input: ClaimRequest, idem: IdempotencyContext): Promise<CommandResult>;
}
\`\`\`

## Capability result

Each method capability carries:

- support: SUPPORTED, UNSUPPORTED, PARTNER_CONFIRMATION_REQUIRED or TEMPORARILY_UNAVAILABLE.
- permission: required token/account scope.
- environment: sandbox/production.
- evidence level and source URL/reference.
- last verified at.
- constraints by status/service/account.

## Normalized command outcomes

- SUCCEEDED: provider acknowledged effect with durable reference.
- REJECTED: explicit business/auth/validation rejection.
- OUTCOME_UNKNOWN: network/timeout after request may have reached provider.
- UNSUPPORTED: capability not available for account/provider.
- TEMPORARILY_UNAVAILABLE: known outage/circuit open.

Only REJECTED known-safe or verified not-found permits a new attempt according to policy. OUTCOME_UNKNOWN starts reconciliation.

## Adapter responsibilities

- Authentication/header/signature.
- Provider address/service mapping.
- Payload conversion and unit conversion.
- Provider error classification.
- Sanitized raw request/response evidence.
- Status mapping and unknown-status preservation.
- Webhook signature verification/deduplication key.
- Rate-limit and retry hints.
- Provider-specific reconciliation lookup.

## Domain responsibilities

- Permission and approval.
- Routing policy.
- Command idempotency record.
- State transition.
- Notifications/workbox.
- Audit and billing.

