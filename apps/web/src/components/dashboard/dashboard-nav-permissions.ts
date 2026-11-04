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
 * Permission filtering helpers for dashboard navigation sections.
 */

import type { DashboardUser, NavItem, NavSection } from './types';

/**
 * Evaluates whether an individual NavItem is accessible to the given user based
 * on required permissions or allowed roles (Finding 4 P2).
 */
export function isNavItemPermitted(item: NavItem, user?: DashboardUser | null): boolean {
  // If item specifies no required permissions or roles, it is public/unrestricted
  if (!item.permissions?.length && !item.roles?.length) {
    return true;
  }
  // If user is absent/unauthenticated, all restricted items are denied
  if (!user) {
    return false;
  }
  const userRole = user.role?.toUpperCase();
  // OWNER role holds full operational and administrative permissions across Ship Dễ
  if (userRole === 'OWNER') {
    return true;
  }
  // Check role matches
  if (item.roles?.length && item.roles.some((r) => r.toUpperCase() === userRole)) {
    return true;
  }
  const userPerms = user.permissions ?? [];
  // Wildcard permission grant
  if (userPerms.includes('*')) {
    return true;
  }
  // Check discrete canonical permission code matches
  if (item.permissions?.length && item.permissions.some((p) => userPerms.includes(p))) {
    return true;
  }
  return false;
}

/**
 * Filters navigation sections by active user permissions and roles (Finding 4 P2).
 * Empty sections resulting from filtering are pruned from display.
 */
export function filterNavSectionsByPermissions(
  navSections: NavSection[],
  user?: DashboardUser | null
): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemPermitted(item, user)),
    }))
    .filter((section) => section.items.length > 0);
}
