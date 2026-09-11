/**
 * @shipde/testkit - MSW Canonical State Types
 * Supports the 7 canonical UI states: LOADING, EMPTY, ERROR, FORBIDDEN, PARTIAL, SUCCESS, RECOVERY.
 */

export type CanonicalUiState =
  'LOADING' | 'EMPTY' | 'ERROR' | 'FORBIDDEN' | 'PARTIAL' | 'SUCCESS' | 'RECOVERY';

export interface MswScenarioConfig {
  state: CanonicalUiState;
  delayMs?: number;
  recoveryAttemptsBeforeSuccess?: number;
}
