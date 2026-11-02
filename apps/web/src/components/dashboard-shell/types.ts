/**
 * MIT License
 *
 * Portions of this file are adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * Copyright (c) 2024 Kiranism
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
 */

import type React from 'react';

export interface DashboardNavSubItem {
  id: string;
  title: string;
  href: string;
  badgeCount?: number;
  badgeTone?: 'neutral' | 'warning' | 'danger' | 'info' | 'success';
  shortcut?: string[];
  disabled?: boolean;
}

export interface DashboardNavItem {
  id: string;
  title: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
  badgeTone?: 'neutral' | 'warning' | 'danger' | 'info' | 'success';
  shortcut?: string[];
  disabled?: boolean;
  items?: DashboardNavSubItem[];
}

export interface DashboardNavGroup {
  id: string;
  groupLabel: string;
  items: DashboardNavItem[];
}

export interface TenantContextOption {
  tenantId: string;
  shopId: string;
  shopName: string;
  warehouseLabel: string;
  planTier?: string;
}

export interface DashboardUserProfile {
  id: string;
  fullName: string;
  email: string;
  roleLabel: string;
  avatarInitials?: string;
}

export interface DashboardBreadcrumbItem {
  label: string;
  href?: string;
}
