/**
 * @shipde/ui
 * Shared UI tokens, primitives, and design system helpers.
 */

export const UI_VARIANTS = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  OUTLINE: 'outline',
  DANGER: 'danger',
} as const;

export type UiVariant = (typeof UI_VARIANTS)[keyof typeof UI_VARIANTS];
