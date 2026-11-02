'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * Copyright (c) 2024 Kiranism
 *
 * Adapted for Ship Dễ without Clerk dependencies; uses native Ship Dễ tenant
 * context switcher and session user profile.
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
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileCheck2,
  LayoutDashboard,
  Package,
  Scale,
  Settings,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react';
import type {
  DashboardNavGroup,
  DashboardNavItem,
  DashboardUserProfile,
  TenantContextOption,
} from './types';

export const DEFAULT_SHIPDE_NAV_GROUPS: DashboardNavGroup[] = [
  {
    id: 'operations',
    groupLabel: 'Vận hành hằng ngày',
    items: [
      {
        id: 'overview',
        title: 'Tổng quan vận hành',
        href: '/',
        icon: LayoutDashboard,
        shortcut: ['G', 'O'],
      },
      {
        id: 'orders',
        title: 'Đơn hàng & Tạo vận đơn',
        href: '/orders',
        icon: Package,
        shortcut: ['G', 'D'],
      },
      {
        id: 'shipments',
        title: 'Quản lý Vận đơn',
        href: '/shipments',
        icon: Truck,
        badgeCount: 12,
        badgeTone: 'info',
        items: [
          {
            id: 'shipments-all',
            title: 'Tất cả vận đơn',
            href: '/shipments',
          },
          {
            id: 'shipments-pickup',
            title: 'Chờ lấy hàng',
            href: '/shipments?status=READY_TO_PICK',
            badgeCount: 2,
            badgeTone: 'info',
          },
          {
            id: 'shipments-failed',
            title: 'Giao thất bại cần xử lý',
            href: '/shipments?status=DELIVERY_FAILED',
            badgeCount: 2,
            badgeTone: 'danger',
          },
        ],
      },
      {
        id: 'incidents',
        title: 'Vấn đề & Sự cố (NDR)',
        href: '/incidents',
        icon: AlertTriangle,
        badgeCount: 3,
        badgeTone: 'warning',
      },
    ],
  },
  {
    id: 'finance',
    groupLabel: 'Tài chính & Đối soát',
    items: [
      {
        id: 'reconciliation',
        title: 'Đối soát & COD',
        href: '/reconciliation',
        icon: FileCheck2,
        badgeCount: 3,
        badgeTone: 'danger',
      },
      {
        id: 'claims',
        title: 'Khiếu nại ĐVVC',
        href: '/claims',
        icon: ShieldAlert,
      },
      {
        id: 'ledger',
        title: 'Sổ cái & Lãi lỗ',
        href: '/ledger',
        icon: Scale,
      },
      {
        id: 'analytics',
        title: 'Báo cáo hiệu suất ĐVVC',
        href: '/analytics',
        icon: BarChart3,
      },
    ],
  },
  {
    id: 'system',
    groupLabel: 'Cấu hình & Đa kênh',
    items: [
      {
        id: 'settings',
        title: 'Kết nối & Phân quyền',
        href: '/settings',
        icon: Settings,
      },
    ],
  },
];

function getBadgeToneClasses(
  tone: DashboardNavItem['badgeTone'] = 'neutral',
  isActive: boolean
): string {
  if (isActive) {
    return 'bg-orange-100 text-orange-900 border-orange-300';
  }
  switch (tone) {
    case 'danger':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'warning':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'info':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'success':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export interface AppSidebarProps {
  navGroups?: DashboardNavGroup[];
  activePath?: string;
  collapsed?: boolean;
  mobileOpen?: boolean;
  onToggleCollapsed?: () => void;
  onCloseMobile?: () => void;
  onNavigate?: (href: string, itemId: string) => void;
  tenants?: TenantContextOption[];
  activeTenant?: TenantContextOption;
  onSelectTenant?: (tenant: TenantContextOption) => void;
  user?: DashboardUserProfile;
  className?: string;
}

export function AppSidebar({
  navGroups = DEFAULT_SHIPDE_NAV_GROUPS,
  activePath = '/',
  collapsed = false,
  mobileOpen = false,
  onCloseMobile,
  onNavigate,
  tenants = [],
  activeTenant,
  onSelectTenant,
  user,
  className = '',
}: AppSidebarProps) {
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    shipments: true,
  });

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseMobile?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const toggleSubMenu = (itemId: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const renderSidebarContent = (isMobileDrawer: boolean) => {
    const isCollapsedView = collapsed && !isMobileDrawer;

    return (
      <div className="flex h-full flex-col bg-slate-900 text-slate-100">
        {/* Brand & Tenant Switcher Header */}
        <div className="border-b border-slate-800 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-600 font-bold text-white shadow-xs">
                SĐ
              </div>
              {!isCollapsedView && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold tracking-tight text-white">
                      Ship Dễ
                    </span>
                    <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">
                      OPS
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-slate-400">
                    Điều phối & Đối soát vận chuyển
                  </p>
                </div>
              )}
            </div>

            {isMobileDrawer && onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Đóng thanh điều hướng"
                title="Đóng menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Tenant / Shop Context Switcher */}
          {activeTenant && !isCollapsedView && (
            <div className="relative mt-3">
              <button
                type="button"
                onClick={() => {
                  if (tenants.length > 1) {
                    setTenantMenuOpen((prev) => !prev);
                  }
                }}
                aria-label={`Ngữ cảnh cửa hàng hiện tại: ${activeTenant.shopName}`}
                aria-expanded={tenants.length > 1 ? tenantMenuOpen : undefined}
                aria-haspopup={tenants.length > 1 ? 'listbox' : undefined}
                title={`Cửa hàng: ${activeTenant.shopName} (${activeTenant.warehouseLabel})`}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-800/70 px-2.5 py-2 text-left text-xs transition-colors hover:border-slate-700 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-100">
                      {activeTenant.shopName}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {activeTenant.warehouseLabel}
                    </span>
                  </span>
                </span>
                {tenants.length > 1 && (
                  <ChevronsUpDown
                    className="h-3.5 w-3.5 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                )}
              </button>

              {tenantMenuOpen && tenants.length > 1 && (
                <div
                  role="listbox"
                  aria-label="Chọn cửa hàng hoặc kho vận hành"
                  className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-xl"
                >
                  {tenants.map((tenant) => {
                    const isCurrent = tenant.shopId === activeTenant.shopId;
                    return (
                      <button
                        key={tenant.shopId}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => {
                          onSelectTenant?.(tenant);
                          setTenantMenuOpen(false);
                        }}
                        className={`flex w-full flex-col rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                          isCurrent
                            ? 'bg-orange-600/20 font-semibold text-orange-300'
                            : 'text-slate-200 hover:bg-slate-700/70'
                        }`}
                      >
                        <span className="truncate">{tenant.shopName}</span>
                        <span className="truncate text-[10px] text-slate-400">
                          {tenant.warehouseLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation Groups */}
        <nav
          aria-label="Điều hướng chính hệ thống Ship Dễ"
          className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5"
        >
          {navGroups.map((group) => (
            <div key={group.id}>
              {!isCollapsedView && (
                <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.groupLabel}
                </div>
              )}

              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    activePath === item.href ||
                    (item.href !== '/' && activePath.startsWith(item.href));
                  const hasSubItems = Array.isArray(item.items) && item.items.length > 0;
                  const isExpanded = Boolean(expandedItems[item.id]);

                  return (
                    <li key={item.id}>
                      <div className="flex items-center">
                        <a
                          href={item.href}
                          aria-current={isActive ? 'page' : undefined}
                          title={item.title}
                          onClick={(event) => {
                            if (onNavigate) {
                              event.preventDefault();
                              onNavigate(item.href, item.id);
                            }
                            if (isMobileDrawer) {
                              onCloseMobile?.();
                            }
                          }}
                          className={`group flex flex-1 items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                            isActive
                              ? 'bg-orange-600 text-white font-semibold shadow-xs'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            {Icon && (
                              <Icon
                                className={`h-4 w-4 shrink-0 ${
                                  isActive
                                    ? 'text-white'
                                    : 'text-slate-400 group-hover:text-slate-200'
                                }`}
                                aria-hidden="true"
                              />
                            )}
                            {!isCollapsedView && <span className="truncate">{item.title}</span>}
                          </span>

                          {!isCollapsedView && typeof item.badgeCount === 'number' && (
                            <span
                              className={`ml-auto inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${getBadgeToneClasses(
                                item.badgeTone,
                                isActive
                              )}`}
                            >
                              {item.badgeCount}
                            </span>
                          )}
                        </a>

                        {!isCollapsedView && hasSubItems && (
                          <button
                            type="button"
                            onClick={() => toggleSubMenu(item.id)}
                            aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} mục con của ${item.title}`}
                            aria-expanded={isExpanded}
                            title={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${item.title}`}
                            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </div>

                      {!isCollapsedView && hasSubItems && isExpanded && (
                        <ul className="mt-1 ml-4 border-l border-slate-800 pl-2.5 space-y-1">
                          {item.items?.map((subItem) => {
                            const isSubActive = activePath === subItem.href;
                            return (
                              <li key={subItem.id}>
                                <a
                                  href={subItem.href}
                                  aria-current={isSubActive ? 'page' : undefined}
                                  onClick={(event) => {
                                    if (onNavigate) {
                                      event.preventDefault();
                                      onNavigate(subItem.href, subItem.id);
                                    }
                                    if (isMobileDrawer) {
                                      onCloseMobile?.();
                                    }
                                  }}
                                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                                    isSubActive
                                      ? 'bg-slate-800 font-semibold text-orange-400'
                                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                                  }`}
                                >
                                  <span className="truncate">{subItem.title}</span>
                                  {typeof subItem.badgeCount === 'number' && (
                                    <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
                                      {subItem.badgeCount}
                                    </span>
                                  )}
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Native User Footer (No Clerk) */}
        {user && (
          <div className="border-t border-slate-800 p-3">
            <div className="flex items-center gap-2.5">
              <div
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-orange-400 ring-1 ring-slate-700"
              >
                {user.avatarInitials ?? user.fullName.slice(0, 2).toUpperCase()}
              </div>
              {!isCollapsedView && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-100">{user.fullName}</p>
                  <p className="truncate text-[11px] text-slate-400">{user.roleLabel}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop rail */}
      <aside
        aria-label="Thanh điều hướng bên trái"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={`hidden shrink-0 border-r border-slate-800 transition-all duration-200 md:block ${
          collapsed ? 'w-16' : 'w-64'
        } ${className}`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu điều hướng di động"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
}
