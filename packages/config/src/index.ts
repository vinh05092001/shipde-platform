/**
 * @shipde/config
 * Shared workspace configuration and environment constants.
 */

export const WORKSPACE_ENV = {
  DEFAULT_NODE_VERSION: '24',
  DEFAULT_PNPM_VERSION: '11.23.0',
  DEFAULT_TIMEZONE: 'Asia/Ho_Chi_Minh',
  DEFAULT_CURRENCY: 'VND',
} as const;

export type WorkspaceEnvironment = typeof WORKSPACE_ENV;
