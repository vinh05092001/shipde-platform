'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * Copyright (c) 2024 Kiranism
 *
 * Adapted for Ship Dễ without Clerk dependencies.
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

import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import type {
  DashboardBreadcrumbItem,
  DashboardNavGroup,
  DashboardUserProfile,
  TenantContextOption,
} from './types';
import { AppSidebar, DEFAULT_SHIPDE_NAV_GROUPS } from './app-sidebar';
import { DashboardHeader } from './dashboard-header';

export interface DashboardShellProps {
  children?: React.ReactNode;
  navGroups?: DashboardNavGroup[];
  activePath?: string;
  breadcrumbs?: DashboardBreadcrumbItem[];
  tenants?: TenantContextOption[];
  activeTenant?: TenantContextOption;
  onSelectTenant?: (tenant: TenantContextOption) => void;
  user?: DashboardUserProfile;
  defaultSidebarCollapsed?: boolean;
  onNavigate?: (href: string, itemId?: string) => void;
  onOpenQuickSearch?: () => void;
  headerActions?: React.ReactNode;
  topBanner?: React.ReactNode;
  isLoading?: boolean;
  error?: {
    title?: string;
    message: string;
    code?: string;
  } | null;
  onRetry?: () => void;
  isForbidden?: boolean;
  forbiddenMessage?: string;
  className?: string;
}

export function DashboardShell({
  children,
  navGroups = DEFAULT_SHIPDE_NAV_GROUPS,
  activePath = '/',
  breadcrumbs = [],
  tenants = [],
  activeTenant,
  onSelectTenant,
  user,
  defaultSidebarCollapsed = false,
  onNavigate,
  onOpenQuickSearch,
  headerActions,
  topBanner,
  isLoading = false,
  error = null,
  onRetry,
  isForbidden = false,
  forbiddenMessage,
  className = '',
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar collapse (Kiranism starter pattern)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`flex min-h-screen w-full bg-slate-50 text-slate-900 antialiased ${className}`}>
      {/* Keyboard Skip-to-Content Link */}
      <a
        href="#dashboard-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-orange-600 focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Chuyển đến nội dung chính
      </a>

      <AppSidebar
        navGroups={navGroups}
        activePath={activePath}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onNavigate={onNavigate}
        tenants={tenants}
        activeTenant={activeTenant}
        onSelectTenant={onSelectTenant}
        user={user}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {topBanner}

        <DashboardHeader
          breadcrumbs={breadcrumbs}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenQuickSearch={onOpenQuickSearch}
          activeTenant={activeTenant}
          user={user}
          headerActions={headerActions}
        />

        <main
          id="dashboard-main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col focus:outline-none"
        >
          {isLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div className="space-y-2">
                  <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-200" />
                  <div className="h-4 w-96 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-200" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={`shell-card-skel-${idx}`}
                    className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white p-4"
                  />
                ))}
              </div>
              <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
              <span className="sr-only">Đang tải không gian làm việc...</span>
            </div>
          ) : isForbidden ? (
            <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center p-6 text-center">
              <div
                role="alert"
                className="modern-card w-full rounded-xl border border-amber-200 bg-white p-8"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                  <ShieldAlert className="h-6 w-6" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-bold text-slate-900">
                  Không có quyền truy cập khu vực này (403)
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {forbiddenMessage ??
                    'Vai trò hiện tại của bạn không được cấp quyền truy cập phân hệ này. Vui lòng liên hệ Quản trị viên cửa hàng.'}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center p-6 text-center">
              <div
                role="alert"
                className="modern-card w-full rounded-xl border border-rose-200 bg-white p-8"
              >
                <div
                  aria-hidden="true"
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600"
                >
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-base font-bold text-slate-900">
                  {error.title ?? 'Gián đoạn tải không gian làm việc'}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{error.message}</p>
                {error.code && (
                  <p className="mt-2 font-mono text-[11px] text-rose-700 tabular-nums">
                    Mã lỗi: {error.code}
                  </p>
                )}
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="btn-primary mt-5 inline-flex items-center gap-2 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Thử tải lại trang</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
