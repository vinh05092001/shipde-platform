/**
 * Ported from Kiranism/next-shadcn-dashboard-starter (MIT License)
 * Source: https://github.com/Kiranism/next-shadcn-dashboard-starter
 *
 * MIT License
 * Copyright (c) 2024 Kiran
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.

/**
 * Masks an email address for privacy and PII protection in accordance with BR-UI-03 & Work Item.
 * E.g. 'nguyenvana@shipde.vn' -> 'n****a@shipde.vn'
 */
export function maskEmail(email?: string | null): string {
  if (!email) return '';
  if (!email.includes('@')) return '***';
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  if (name.length <= 2) {
    return `${name[0]}*@${domain}`;
  }
  return `${name[0]}${'*'.repeat(Math.min(name.length - 2, 4))}${name[name.length - 1]}@${domain}`;
}

export interface GlobalShortcutOptions {
  showSearch?: boolean;
  onTrigger: () => void;
}

export interface ShortcutKeyEvent {
  ctrlKey?: boolean;
  metaKey?: boolean;
  key: string;
  preventDefault: () => void;
  target?:
    | EventTarget
    | {
        tagName?: string;
        isContentEditable?: boolean;
        getAttribute?: (name: string) => string | null;
      }
    | null;
}

/**
 * Creates the global keyboard listener for Ctrl+K search shortcut (Finding 6).
 * Safe against uppercase 'K', modifier combinations, and inputs.
 */
export function createGlobalShortcutHandler({
  showSearch = true,
  onTrigger,
}: GlobalShortcutOptions) {
  return function handleGlobalKeyDown(event: KeyboardEvent | ShortcutKeyEvent) {
    if (showSearch === false) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      const target = (event as any).target;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute?.('contenteditable') === 'true');
      if (!isEditable) {
        event.preventDefault();
        onTrigger();
      }
    }
  };
}
