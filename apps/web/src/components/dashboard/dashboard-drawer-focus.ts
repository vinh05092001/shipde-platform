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
 *
 * Mobile drawer focus trap and responsive breakpoint helpers.
 */

/**
 * Breakpoint handler for responsive drawer dismissal (Finding 7).
 * When resizing to desktop (>= 1024px / Tailwind `lg`), an open mobile drawer
 * must close to prevent the desktop layout from remaining inert and unresponsive.
 */
export function handleDesktopBreakpointResize(
  matchesDesktop: boolean,
  isMobileOpen: boolean,
  closeMobileNav: () => void
): boolean {
  if (matchesDesktop && isMobileOpen) {
    closeMobileNav();
    return true;
  }
  return false;
}

/**
 * Focus trapping and keyboard navigation handler for mobile drawer overlay (Finding 3 / Finding 7).
 * Exercises production behavior for Tab, Shift+Tab wrapping, and Escape dismissal.
 */
export function handleDrawerKeyDown(
  e: { key: string; shiftKey?: boolean; preventDefault: () => void },
  drawerElement:
    | HTMLElement
    | {
        querySelectorAll: (selector: string) => ArrayLike<any>;
        contains: (el: any) => boolean;
      }
    | null,
  activeElement: any,
  closeMobileNav: () => void
): boolean {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeMobileNav();
    return true;
  }

  if (e.key === 'Tab' && drawerElement) {
    const focusables = Array.from(
      (drawerElement as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    if (focusables.length === 0) {
      e.preventDefault();
      return true;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (activeElement === first || !drawerElement.contains(activeElement)) {
        e.preventDefault();
        last.focus();
        return true;
      }
    } else {
      if (activeElement === last || !drawerElement.contains(activeElement)) {
        e.preventDefault();
        first.focus();
        return true;
      }
    }
  }

  return false;
}
