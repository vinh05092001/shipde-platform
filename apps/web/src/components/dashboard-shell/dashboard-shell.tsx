'use client';

/**
 * Reusable Dashboard Shell, Collapsible App Sidebar, Breadcrumbs & Page Header
 *
 * Adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * License: MIT License
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
 * Note: Clerk authentication has been omitted; integrates natively with Ship Dễ
 * operator session props and Vietnamese operational UX rules.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Inbox,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';

export interface DashboardNavSubItem {
  id: string;
  title: string;
  href: string;
  badge?: string | number;
  disabled?: boolean;
}

export interface DashboardNavItem {
  id: string;
  title: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeTone?: 'info' | 'ok' | 'warn' | 'risk';
  disabled?: boolean;
  items?: DashboardNavSubItem[];
}

export interface DashboardNavGroup {
  id: string;
  label: string;
  items: DashboardNavItem[];
}

export interface DashboardBreadcrumbItem {
  title: string;
  href?: string;
}

export interface DashboardContextOption {
  id: string;
  label: string;
  scopeType?: 'SHOP' | 'BRANCH' | 'WAREHOUSE';
}

export interface DashboardUserProfile {
  name: string;
  email: string;
  roleLabel: string;
  avatarInitials?: string;
}

export type DashboardShellState =
  'success' | 'loading' | 'empty' | 'error' | 'forbidden' | 'validation' | 'partial';

const ROLE_BADGE_MAP: Record<string, string> = {
  OWNER: 'Chủ shop',
  OPS_CSKH: 'Vận hành / CSKH',
  ACCOUNTANT: 'Kế toán đối soát',
  WAREHOUSE: 'Nhân viên kho',
  BACKOFFICE: 'Quản trị cấu hình',
};

export function formatRoleLabelVi(roleOrLabel?: string): string {
  if (!roleOrLabel) return 'Nhân sự vận hành';
  return ROLE_BADGE_MAP[roleOrLabel.toUpperCase()] || roleOrLabel;
}

// ============================================================================
// 1. DashboardBreadcrumbs
// ============================================================================
export interface DashboardBreadcrumbsProps {
  items: DashboardBreadcrumbItem[];
  onNavigate?: (href: string) => void;
}

export function DashboardBreadcrumbs({ items, onNavigate }: DashboardBreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Đường dẫn điều hướng" data-testid="dashboard-breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-[#697386]">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.title}-${idx}`} className="inline-flex items-center gap-1.5">
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#9da6b8]" />}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'font-bold text-[#0c1421]' : 'text-[#3b4352]'}
                >
                  {item.title}
                </span>
              ) : onNavigate ? (
                <button
                  type="button"
                  onClick={() => item.href && onNavigate(item.href)}
                  className="hover:text-[#0c1421] focus-visible:outline-2 focus-visible:outline-[#c23807] rounded px-1 -mx-1 transition cursor-pointer"
                >
                  {item.title}
                </button>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-[#0c1421] focus-visible:outline-2 focus-visible:outline-[#c23807] rounded px-1 -mx-1 transition"
                >
                  {item.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ============================================================================
// 2. PageHeader
// ============================================================================
export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: string;
  badgeTone?: 'info' | 'ok' | 'warn' | 'risk';
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  badge,
  badgeTone = 'info',
  metadata,
  actions,
}: PageHeaderProps) {
  const toneClass =
    badgeTone === 'ok'
      ? 'badge-ok'
      : badgeTone === 'warn'
        ? 'badge-warn'
        : badgeTone === 'risk'
          ? 'badge-risk'
          : 'badge-info';

  return (
    <div
      data-testid="dashboard-page-header"
      className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-[#eae7e4]"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-extrabold tracking-tight text-[#0c1421]">{title}</h1>
          {badge && <span className={toneClass}>{badge}</span>}
        </div>
        {description && <p className="text-xs text-[#3b4352] max-w-3xl">{description}</p>}
        {metadata && <div className="pt-1 text-xs text-[#697386]">{metadata}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ============================================================================
// 3. DashboardUserNav (Native Ship Dễ User Menu — No Clerk)
// ============================================================================
export interface DashboardUserNavProps {
  user: DashboardUserProfile;
  onProfileClick?: () => void;
  onSignOut?: () => void;
}

export function DashboardUserNav({ user, onProfileClick, onSignOut }: DashboardUserNavProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const initials =
    user.avatarInitials ||
    user.name
      .split(' ')
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') ||
    'SD';

  return (
    <div
      className="relative"
      data-testid="dashboard-user-nav"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Tài khoản người dùng: ${user.name}`}
        data-testid="dashboard-user-nav-trigger"
        className="inline-flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
      >
        <span className="w-7 h-7 rounded-lg bg-[#fff5f0] border border-[#fdddd0] text-[#c23807] font-bold text-xs flex items-center justify-center">
          {initials}
        </span>
        <span className="hidden md:flex flex-col items-start text-left leading-tight">
          <span className="text-xs font-bold text-[#0c1421]">{user.name}</span>
          <span className="text-[11px] text-[#697386]">{formatRoleLabelVi(user.roleLabel)}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[#697386]" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Tùy chọn tài khoản"
          data-testid="dashboard-user-nav-menu"
          className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white border border-[#eae7e4] shadow-lg z-40 p-2 space-y-1"
        >
          <div className="px-2.5 py-2 border-b border-[#eae7e4]">
            <p className="text-xs font-bold text-[#0c1421]">{user.name}</p>
            <p className="text-[11px] text-[#697386] truncate">{user.email}</p>
            <span className="badge-info mt-1.5 inline-block">
              {formatRoleLabelVi(user.roleLabel)}
            </span>
          </div>
          {onProfileClick && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onProfileClick();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-[#0c1421] hover:bg-[#f6f5f3] transition cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-[#697386]" />
              <span>Hồ sơ cá nhân & Phiên đăng nhập</span>
            </button>
          )}
          {onSignOut && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onSignOut();
              }}
              data-testid="dashboard-user-signout"
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2] transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. AppSidebar (Collapsible Desktop Rail + Accessible Mobile Drawer)
// ============================================================================
export interface AppSidebarProps {
  navGroups: DashboardNavGroup[];
  activeHref: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: (href: string, item: DashboardNavItem | DashboardNavSubItem) => void;
  brandTitle?: string;
  brandSubtitle?: string;
}

export function AppSidebar({
  navGroups,
  activeHref,
  isCollapsed = false,
  onToggleCollapse,
  onNavigate,
  brandTitle = 'Ship Dễ',
  brandSubtitle = 'Điều hành vận chuyển',
}: AppSidebarProps) {
  const [expandedIds, setExpandedIds] = React.useState<Record<string, boolean>>({});
  const navItemRefs = React.useRef<Array<HTMLElement | null>>([]);

  const toggleGroupExpand = (itemId: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [itemId]: prev[itemId] === false ? true : false,
    }));
  };

  const handleSidebarKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const validRefs = navItemRefs.current.filter(Boolean);
    if (validRefs.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = navItemRefs.current[Math.min(navItemRefs.current.length - 1, idx + 1)];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = navItemRefs.current[Math.max(0, idx - 1)];
      prev?.focus();
    }
  };

  let flatIndex = 0;

  return (
    <aside
      aria-label="Thanh điều hướng chính"
      data-testid="dashboard-sidebar"
      data-collapsed={isCollapsed ? 'true' : 'false'}
      className={`flex flex-col border-r border-[#eae7e4] bg-white transition-all duration-150 shrink-0 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-14 px-3 border-b border-[#eae7e4] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-[#c23807] text-white font-black text-sm flex items-center justify-center shrink-0">
            S
          </div>
          {!isCollapsed && (
            <div className="leading-tight truncate">
              <div className="text-sm font-extrabold text-[#0c1421] truncate">{brandTitle}</div>
              <div className="text-[11px] text-[#697386] truncate">{brandSubtitle}</div>
            </div>
          )}
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            title={
              isCollapsed
                ? 'Mở rộng thanh điều hướng (Ctrl+B)'
                : 'Thu gọn thanh điều hướng (Ctrl+B)'
            }
            data-testid="dashboard-sidebar-collapse-toggle"
            className="p-1.5 rounded-lg text-[#697386] hover:text-[#0c1421] hover:bg-[#f6f5f3] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav aria-label="Danh mục chức năng" className="flex-1 overflow-y-auto p-2 space-y-4">
        {navGroups.map((group) => (
          <div key={group.id} className="space-y-1">
            {!isCollapsed && (
              <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#697386]">
                {group.label}
              </div>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const currentIdx = flatIndex++;
                const IconComp = item.icon;
                const isActive =
                  activeHref === item.href ||
                  Boolean(item.items?.some((sub) => sub.href === activeHref));
                const hasSubItems = Boolean(item.items && item.items.length > 0);
                const isSubExpanded = expandedIds[item.id] !== false;

                const badgeToneClass =
                  item.badgeTone === 'risk'
                    ? 'bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]'
                    : item.badgeTone === 'warn'
                      ? 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]'
                      : item.badgeTone === 'ok'
                        ? 'bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]'
                        : 'bg-[#f6f5f3] text-[#3b4352] border-[#eae7e4]';

                return (
                  <li key={item.id}>
                    <div className="flex items-center">
                      <button
                        ref={(el) => {
                          navItemRefs.current[currentIdx] = el;
                        }}
                        type="button"
                        disabled={item.disabled}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={isCollapsed ? item.title : undefined}
                        title={isCollapsed ? item.title : undefined}
                        data-testid={`dashboard-nav-item-${item.id}`}
                        onClick={() => {
                          if (hasSubItems && !isCollapsed) {
                            toggleGroupExpand(item.id);
                          }
                          onNavigate?.(item.href, item);
                        }}
                        onKeyDown={(e) => handleSidebarKeyDown(e, currentIdx)}
                        className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-[#c23807] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isActive
                            ? 'bg-[#fff5f0] text-[#c23807] border border-[#fdddd0]'
                            : 'text-[#3b4352] hover:bg-[#f6f5f3] hover:text-[#0c1421]'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2.5 truncate">
                          {IconComp && (
                            <IconComp
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-[#c23807]' : 'text-[#697386]'
                              }`}
                            />
                          )}
                          {!isCollapsed && <span className="truncate">{item.title}</span>}
                        </span>

                        {!isCollapsed && (
                          <span className="inline-flex items-center gap-1.5 shrink-0">
                            {item.badge !== undefined && (
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[11px] font-mono tabular-nums ${badgeToneClass}`}
                              >
                                {item.badge}
                              </span>
                            )}
                            {hasSubItems && (
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  isSubExpanded ? 'rotate-0' : '-rotate-90'
                                }`}
                              />
                            )}
                          </span>
                        )}
                      </button>
                    </div>

                    {!isCollapsed && hasSubItems && isSubExpanded && (
                      <ul className="mt-1 ml-6 pl-2.5 border-l border-[#eae7e4] space-y-1">
                        {item.items?.map((sub) => {
                          const subActive = activeHref === sub.href;
                          return (
                            <li key={sub.id}>
                              <button
                                type="button"
                                disabled={sub.disabled}
                                aria-current={subActive ? 'page' : undefined}
                                data-testid={`dashboard-nav-subitem-${sub.id}`}
                                onClick={() => onNavigate?.(sub.href, sub)}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                                  subActive
                                    ? 'font-bold text-[#c23807] bg-[#fff5f0]'
                                    : 'text-[#697386] hover:text-[#0c1421] hover:bg-[#f6f5f3]'
                                }`}
                              >
                                <span className="truncate">{sub.title}</span>
                                {sub.badge !== undefined && (
                                  <span className="font-mono text-[11px] tabular-nums">
                                    {sub.badge}
                                  </span>
                                )}
                              </button>
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
    </aside>
  );
}

// ============================================================================
// 5. DashboardShell (Complete Operational Layout + State Coverage)
// ============================================================================
export interface DashboardShellProps {
  navGroups: DashboardNavGroup[];
  activeHref: string;
  breadcrumbs?: DashboardBreadcrumbItem[];
  pageTitle: string;
  pageDescription?: string;
  pageBadge?: string;
  pageBadgeTone?: 'info' | 'ok' | 'warn' | 'risk';
  pageMetadata?: React.ReactNode;
  pageActions?: React.ReactNode;
  contextOptions?: DashboardContextOption[];
  selectedContextId?: string;
  onContextChange?: (contextId: string) => void;
  user?: DashboardUserProfile;
  onNavigate?: (href: string) => void;
  onOpenQuickSearch?: () => void;
  onSignOut?: () => void;
  defaultCollapsed?: boolean;
  // Shell-level state support per DESIGN-SYSTEM-UX-RULES.md
  state?: DashboardShellState;
  stateMessage?: string;
  onRetry?: () => void;
  onForbiddenRecovery?: () => void;
  onEmptyAction?: () => void;
  emptyActionLabel?: string;
  children?: React.ReactNode;
}

const DEFAULT_USER: DashboardUserProfile = {
  name: 'Nguyễn Vận Hành',
  email: 'ops@shipde.vn',
  roleLabel: 'OWNER',
};

export function DashboardShell({
  navGroups,
  activeHref,
  breadcrumbs = [],
  pageTitle,
  pageDescription,
  pageBadge,
  pageBadgeTone,
  pageMetadata,
  pageActions,
  contextOptions = [],
  selectedContextId,
  onContextChange,
  user = DEFAULT_USER,
  onNavigate,
  onOpenQuickSearch,
  onSignOut,
  defaultCollapsed = false,
  state = 'success',
  stateMessage,
  onRetry,
  onForbiddenRecovery,
  onEmptyAction,
  emptyActionLabel,
  children,
}: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsCollapsed((prev) => !prev);
      } else if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  return (
    <div
      data-testid="dashboard-shell"
      data-shell-state={state}
      className="min-h-screen bg-[#fdfcfb] text-[#0c1421] flex flex-col"
    >
      {/* WCAG AA Keyboard Skip-to-Content Link */}
      <a
        href="#dashboard-main-content"
        data-testid="dashboard-skip-link"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#c23807] focus:text-white focus:font-bold focus:text-xs"
      >
        Chuyển đến nội dung chính
      </a>

      <div className="flex flex-1 min-h-screen">
        {/* Desktop Collapsible Sidebar */}
        <div className="hidden md:flex">
          <AppSidebar
            navGroups={navGroups}
            activeHref={activeHref}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
            onNavigate={(href) => onNavigate?.(href)}
          />
        </div>

        {/* Mobile Drawer Sidebar */}
        {isMobileMenuOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu điều hướng di động"
            data-testid="dashboard-mobile-drawer"
            className="fixed inset-0 z-50 md:hidden flex"
          >
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <div className="relative z-10 flex bg-white h-full">
              <AppSidebar
                navGroups={navGroups}
                activeHref={activeHref}
                isCollapsed={false}
                onNavigate={(href) => {
                  setIsMobileMenuOpen(false);
                  onNavigate?.(href);
                }}
              />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                aria-label="Đóng menu di động"
                className="p-2 m-2 h-9 w-9 rounded-lg bg-white border border-[#eae7e4] text-[#0c1421] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Main Column: Top Header + Page Container */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Header Bar */}
          <header
            data-testid="dashboard-header"
            className="h-14 px-4 bg-white border-b border-[#eae7e4] flex items-center justify-between gap-3 sticky top-0 z-20"
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Mở thanh điều hướng di động"
                data-testid="dashboard-mobile-trigger"
                className="md:hidden p-2 rounded-lg border border-[#eae7e4] text-[#0c1421] hover:bg-[#f6f5f3]"
              >
                <Menu className="w-4 h-4" />
              </button>

              <DashboardBreadcrumbs items={breadcrumbs} onNavigate={onNavigate} />
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Top Context Selector (Shop / Branch / Warehouse per DESIGN-SYSTEM-UX-RULES.md) */}
              {contextOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#697386] hidden sm:inline" />
                  <label htmlFor="dashboard-context-select" className="sr-only">
                    Phạm vi cửa hàng hoặc kho vận hành
                  </label>
                  <select
                    id="dashboard-context-select"
                    value={selectedContextId || contextOptions[0]?.id}
                    onChange={(e) => onContextChange?.(e.target.value)}
                    aria-label="Phạm vi cửa hàng hoặc kho vận hành"
                    data-testid="dashboard-context-selector"
                    className="min-h-[34px] px-2.5 py-1 rounded-lg border border-[#eae7e4] bg-[#f6f5f3] text-xs font-semibold text-[#0c1421] focus:outline-none focus:border-[#c23807]"
                  >
                    {contextOptions.map((ctx) => (
                      <option key={ctx.id} value={ctx.id}>
                        {ctx.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick Global Search Trigger */}
              {onOpenQuickSearch && (
                <button
                  type="button"
                  onClick={onOpenQuickSearch}
                  aria-label="Tìm kiếm nhanh (Ctrl+K)"
                  data-testid="dashboard-quick-search-button"
                  className="inline-flex items-center gap-2 min-h-[34px] px-3 py-1 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] text-xs text-[#3b4352] transition cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[#697386]" />
                  <span className="hidden sm:inline">Tìm nhanh...</span>
                  <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-[#f6f5f3] border border-[#eae7e4] rounded text-[#697386]">
                    Ctrl+K
                  </kbd>
                </button>
              )}

              {/* User Identity Menu */}
              <DashboardUserNav user={user} onSignOut={onSignOut} />
            </div>
          </header>

          {/* Main Operational Content Container */}
          <main
            id="dashboard-main-content"
            tabIndex={-1}
            className="flex-1 p-4 sm:p-6 space-y-6 max-w-[1600px] w-full mx-auto focus:outline-none"
          >
            <PageHeader
              title={pageTitle}
              description={pageDescription}
              badge={pageBadge}
              badgeTone={pageBadgeTone}
              metadata={pageMetadata}
              actions={pageActions}
            />

            {/* Shell-level State Handling when state !== 'success' */}
            {state === 'loading' ? (
              <div
                role="status"
                aria-busy="true"
                data-testid="dashboard-shell-loading"
                className="modern-card p-8 space-y-4"
              >
                <div className="flex items-center gap-3 text-xs font-semibold text-[#3b4352]">
                  <RefreshCw className="w-4 h-4 text-[#c23807] animate-spin" />
                  <span>{stateMessage || 'Đang đồng bộ không gian làm việc...'}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="h-20 rounded-xl bg-[#eae7e4] animate-pulse" />
                  <div className="h-20 rounded-xl bg-[#eae7e4] animate-pulse" />
                  <div className="h-20 rounded-xl bg-[#eae7e4] animate-pulse" />
                </div>
              </div>
            ) : state === 'forbidden' ? (
              <div
                role="alert"
                data-testid="dashboard-shell-forbidden"
                className="modern-card p-10 text-center flex flex-col items-center justify-center space-y-3 bg-[#fef2f2]/40"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] flex items-center justify-center">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div className="max-w-md space-y-1">
                  <h2 className="text-sm font-bold text-[#0c1421]">
                    Không có quyền truy cập khu vực này (403)
                  </h2>
                  <p className="text-xs text-[#3b4352]">
                    {stateMessage ||
                      'Vai trò hiện tại không được cấp quyền xem màn hình này. Dữ liệu hệ thống không bị thay đổi.'}
                  </p>
                </div>
                {onForbiddenRecovery && (
                  <button
                    type="button"
                    onClick={onForbiddenRecovery}
                    data-testid="dashboard-shell-forbidden-recovery"
                    className="btn-secondary text-xs"
                  >
                    Quay lại trang tổng quan được phép
                  </button>
                )}
              </div>
            ) : state === 'error' ? (
              <div
                role="alert"
                data-testid="dashboard-shell-error"
                className="modern-card p-10 text-center flex flex-col items-center justify-center space-y-3 bg-[#fef2f2]/30"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="max-w-md space-y-1">
                  <h2 className="text-sm font-bold text-[#0c1421]">
                    Gián đoạn tải dữ liệu không gian làm việc
                  </h2>
                  <p className="text-xs text-[#3b4352]">
                    {stateMessage ||
                      'Không thể kết nối máy chủ ứng dụng. Dữ liệu hiện tại không bị thay đổi.'}
                  </p>
                </div>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    data-testid="dashboard-shell-retry"
                    className="btn-primary text-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử lại ngay</span>
                  </button>
                )}
              </div>
            ) : state === 'empty' ? (
              <div
                data-testid="dashboard-shell-empty"
                className="modern-card p-10 text-center flex flex-col items-center justify-center space-y-3"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#f6f5f3] border border-[#eae7e4] text-[#697386] flex items-center justify-center">
                  <Inbox className="w-6 h-6" />
                </div>
                <div className="max-w-md space-y-1">
                  <h2 className="text-sm font-bold text-[#0c1421]">
                    Chưa có dữ liệu trong phạm vi đang chọn
                  </h2>
                  <p className="text-xs text-[#697386]">
                    {stateMessage ||
                      'Hãy chuyển đổi phạm vi cửa hàng/kho hoặc khởi tạo bản ghi đầu tiên.'}
                  </p>
                </div>
                {onEmptyAction && emptyActionLabel && (
                  <button
                    type="button"
                    onClick={onEmptyAction}
                    data-testid="dashboard-shell-empty-action"
                    className="btn-primary text-xs"
                  >
                    {emptyActionLabel}
                  </button>
                )}
              </div>
            ) : (
              <>
                {state === 'validation' && (
                  <div
                    role="alert"
                    data-testid="dashboard-shell-validation"
                    className="p-3.5 rounded-xl bg-[#fffbeb] border border-[#fde68a] flex items-center gap-2.5 text-xs text-[#b45309]"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      <strong>Cảnh báo dữ liệu đầu vào: </strong>
                      {stateMessage || 'Một số tham số bộ lọc không hợp lệ và đã được đặt lại.'}
                    </span>
                  </div>
                )}
                {state === 'partial' && (
                  <div
                    role="status"
                    data-testid="dashboard-shell-partial"
                    className="p-3.5 rounded-xl bg-[#fffbeb] border border-[#fde68a] flex items-center gap-2.5 text-xs text-[#b45309]"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                      <strong>Dữ liệu hiển thị một phần: </strong>
                      {stateMessage ||
                        'Một số nguồn dữ liệu phụ đang đồng bộ; bảng dưới đây hiển thị các bản ghi đã xác thực.'}
                    </span>
                  </div>
                )}
                {children}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
