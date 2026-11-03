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
 * Responsive application shell layout with collapsible sidebar, mobile drawer overlay,
 * sticky top navigation bar, and main content area.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  Package,
  Truck,
  AlertTriangle,
  FileSpreadsheet,
  ShieldCheck,
  Building2,
  Users,
  Settings,
} from 'lucide-react';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardHeader } from './DashboardHeader';
import { DashboardLayoutProps, DashboardUser, NavItem, NavSection } from './types';

export const DEFAULT_NAV_SECTIONS: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      {
        title: 'Bàn làm việc (Dashboard)',
        href: '/',
        icon: LayoutDashboard,
        permissions: [
          'order:view_create',
          'reconciliation:run_review_audit',
          'shipment:track_exceptions',
        ],
      },
    ],
  },
  {
    title: 'ĐIỀU HÀNH & VẬN ĐƠN',
    items: [
      {
        title: 'Quản lý vận đơn',
        href: '/shipments',
        icon: Package,
        permissions: ['order:view_create', 'shipment:track_exceptions'],
      },
      {
        title: 'Kết nối hãng vận chuyển',
        href: '/carriers',
        icon: Truck,
        permissions: ['iam:connect_observe_token'],
      },
      {
        title: 'Cứu đơn giao thất bại',
        href: '/exceptions',
        icon: AlertTriangle,
        permissions: ['shipment:track_exceptions'],
      },
    ],
  },
  {
    title: 'ĐỐI SOÁT & TÀI CHÍNH',
    items: [
      {
        title: 'Bảng kê & Đối soát',
        href: '/reconciliation',
        icon: FileSpreadsheet,
        permissions: ['reconciliation:run_review_audit'],
      },
      {
        title: 'Hồ sơ khiếu nại',
        href: '/claims',
        icon: ShieldCheck,
        permissions: ['claim:verify_submit'],
      },
    ],
  },
  {
    title: 'HỆ THỐNG & CÀI ĐẶT',
    items: [
      {
        title: 'Chi nhánh & Kho hàng',
        href: '/settings/warehouses',
        icon: Building2,
        permissions: ['iam:shop_view', 'iam:shop_config'],
      },
      {
        title: 'Phân quyền & Thành viên',
        href: '/settings/users',
        icon: Users,
        permissions: ['iam:manage_users'],
      },
      {
        title: 'Cài đặt hệ thống',
        href: '/settings',
        icon: Settings,
        permissions: ['iam:shop_config'],
      },
    ],
  },
];

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

export function DashboardLayout({
  children,
  navSections = DEFAULT_NAV_SECTIONS,
  currentUser,
  shopName,
  onSignOut,
  headerActions,
  onSearchClick,
  searchHref,
  onProfileClick,
  profileHref,
  showSearch,
  defaultMobileOpen = false,
}: DashboardLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(defaultMobileOpen);

  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Filter navigation items by active user permissions (Finding 4 P2)
  const visibleNavSections = useMemo(() => {
    return filterNavSectionsByPermissions(navSections, currentUser);
  }, [navSections, currentUser]);

  const closeMobileNav = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  const openMobileNav = useCallback(() => {
    if (typeof document !== 'undefined') {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    }
    setIsMobileOpen(true);
  }, []);

  // Focus management and focus trapping for mobile drawer dialog
  useEffect(() => {
    if (!isMobileOpen) {
      // Restore focus to previously focused element upon dismissal
      if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === 'function'
      ) {
        previousActiveElementRef.current.focus();
        previousActiveElementRef.current = null;
      }
      return;
    }

    // Move focus inside drawer
    const timer = setTimeout(() => {
      if (drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          drawerRef.current.focus();
        }
      }
    }, 10);

    function handleKeyDown(e: KeyboardEvent) {
      handleDrawerKeyDown(e, drawerRef.current, document.activeElement, closeMobileNav);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileOpen, closeMobileNav]);

  // Close mobile drawer when resizing or entering desktop breakpoint (lg = 1024px) to prevent inert desktop freeze
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(min-width: 1024px)');

    function handleMediaChange(e: MediaQueryListEvent | MediaQueryList) {
      handleDesktopBreakpointResize(e.matches, isMobileOpen, closeMobileNav);
    }

    if (mql.addEventListener) {
      mql.addEventListener('change', handleMediaChange);
    } else {
      mql.addListener(handleMediaChange);
    }

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handleMediaChange);
      } else {
        mql.removeListener(handleMediaChange);
      }
    };
  }, [isMobileOpen, closeMobileNav]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex overflow-x-hidden">
      {/* Desktop Sidebar (hidden on mobile, made inert when mobile drawer is open) */}
      <div
        className="hidden lg:block shrink-0 sticky top-0 h-screen z-30"
        aria-hidden={isMobileOpen ? 'true' : undefined}
        inert={isMobileOpen}
      >
        <DashboardSidebar
          navSections={visibleNavSections}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
        />
      </div>

      {/* Mobile Sidebar Drawer Overlay */}
      {isMobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Điều hướng chính"
          className="fixed inset-0 z-50 lg:hidden"
          ref={drawerRef}
          tabIndex={-1}
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={closeMobileNav}
            aria-hidden="true"
          />

          {/* Drawer container */}
          <div className="fixed inset-y-0 left-0 max-w-full flex">
            <DashboardSidebar
              navSections={visibleNavSections}
              isMobile={true}
              onCloseMobile={closeMobileNav}
            />
          </div>
        </div>
      )}

      {/* Main Content Area (made inert when mobile drawer is open) */}
      <div
        className="flex-1 flex flex-col min-w-0"
        aria-hidden={isMobileOpen ? 'true' : undefined}
        inert={isMobileOpen}
      >
        {/* Header */}
        <DashboardHeader
          currentUser={currentUser}
          shopName={shopName}
          onToggleMobileNav={openMobileNav}
          isMobileNavOpen={isMobileOpen}
          onSignOut={onSignOut}
          actions={headerActions}
          onSearchClick={onSearchClick}
          searchHref={searchHref}
          onProfileClick={onProfileClick}
          profileHref={profileHref}
          showSearch={showSearch}
        />

        {/* Scrollable Page Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
