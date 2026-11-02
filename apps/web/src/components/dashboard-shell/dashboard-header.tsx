'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * Copyright (c) 2024 Kiranism
 *
 * Adapted for Ship Dễ without Clerk dependencies; uses native Ship Dễ session
 * user navigation and breadcrumb patterns.
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

import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeft,
  Search,
  Settings,
  UserCheck,
} from 'lucide-react';
import type { DashboardBreadcrumbItem, DashboardUserProfile, TenantContextOption } from './types';

export interface DashboardBreadcrumbsProps {
  items: DashboardBreadcrumbItem[];
  onNavigate?: (href: string) => void;
}

export function DashboardBreadcrumbs({ items, onNavigate }: DashboardBreadcrumbsProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="hidden items-center text-xs sm:flex">
      <ol className="flex items-center gap-1.5">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
              {idx > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              )}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  onClick={(event) => {
                    if (onNavigate && item.href) {
                      event.preventDefault();
                      onNavigate(item.href);
                    }
                  }}
                  className="font-medium text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 rounded px-1"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className="font-semibold text-slate-900"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface DashboardUserNavProps {
  user: DashboardUserProfile;
  activeTenant?: TenantContextOption;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onSignOut?: () => void;
}

export function DashboardUserNav({
  user,
  activeTenant,
  onProfileClick,
  onSettingsClick,
  onSignOut,
}: DashboardUserNavProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Tài khoản người dùng ${user.fullName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Tài khoản: ${user.fullName} (${user.roleLabel})`}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-800"
        >
          {user.avatarInitials ?? user.fullName.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden max-w-[140px] truncate font-semibold text-slate-800 lg:inline">
          {user.fullName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu tài khoản người dùng"
          className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-900">{user.fullName}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
            <span className="mt-1 inline-flex items-center rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">
              {user.roleLabel}
            </span>
          </div>

          {activeTenant && (
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-600">
              <div className="font-medium text-slate-400">Ngữ cảnh cửa hàng:</div>
              <div className="font-semibold text-slate-800">{activeTenant.shopName}</div>
              <div className="text-slate-500">{activeTenant.warehouseLabel}</div>
            </div>
          )}

          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onProfileClick?.();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <UserCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Hồ sơ & phiên làm việc</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSettingsClick?.();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <Settings className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Cấu hình cửa hàng</span>
            </button>
          </div>

          <div className="border-t border-slate-100 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSignOut?.();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface DashboardHeaderProps {
  breadcrumbs?: DashboardBreadcrumbItem[];
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
  onOpenQuickSearch?: () => void;
  activeTenant?: TenantContextOption;
  user?: DashboardUserProfile;
  headerActions?: React.ReactNode;
  className?: string;
}

export function DashboardHeader({
  breadcrumbs = [],
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenMobileMenu,
  onOpenQuickSearch,
  activeTenant,
  user,
  headerActions,
  className = '',
}: DashboardHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs sm:px-6 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Mở menu điều hướng di động"
            title="Mở menu điều hướng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={
              sidebarCollapsed ? 'Mở rộng thanh điều hướng bên' : 'Thu gọn thanh điều hướng bên'
            }
            aria-pressed={sidebarCollapsed}
            title="Thu gọn / Mở rộng thanh điều hướng (Ctrl+B)"
            className="hidden h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 md:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <div className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden="true" />

        <DashboardBreadcrumbs items={breadcrumbs} />
      </div>

      <div className="flex items-center gap-2.5">
        {onOpenQuickSearch && (
          <button
            type="button"
            onClick={onOpenQuickSearch}
            aria-label="Tìm kiếm nhanh mã vận đơn hoặc đơn hàng (Ctrl+K)"
            title="Tìm kiếm nhanh (Ctrl+K / ⌘K)"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span className="hidden md:inline">Tra cứu nhanh vận đơn...</span>
            <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 sm:inline-block">
              ⌘K
            </kbd>
          </button>
        )}

        {activeTenant && (
          <div
            className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 xl:flex"
            title={`Phạm vi dữ liệu hiện tại: ${activeTenant.shopName} — ${activeTenant.warehouseLabel}`}
          >
            <Building2 className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" />
            <span className="font-semibold text-slate-900">{activeTenant.shopName}</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-500">{activeTenant.warehouseLabel}</span>
          </div>
        )}

        {headerActions}

        {user && <DashboardUserNav user={user} activeTenant={activeTenant} />}
      </div>
    </header>
  );
}
