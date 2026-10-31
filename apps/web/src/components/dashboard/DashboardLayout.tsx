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
 * Full Dashboard Shell Layout with responsive sidebar, header, and content container.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { DashboardHeader } from './DashboardHeader';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardLayoutProps, NavSection } from './types';

export const DEFAULT_NAV_SECTIONS: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      {
        title: 'Bàn làm việc (Dashboard)',
        href: '/',
        icon: LayoutDashboard,
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
      },
      {
        title: 'Kết nối hãng vận chuyển',
        href: '/carriers',
        icon: Truck,
      },
      {
        title: 'Cứu đơn giao thất bại',
        href: '/exceptions',
        icon: AlertTriangle,
        badge: 3,
        badgeVariant: 'risk',
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
      },
      {
        title: 'Hồ sơ khiếu nại',
        href: '/claims',
        icon: ShieldCheck,
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
      },
      {
        title: 'Phân quyền & Thành viên',
        href: '/settings/users',
        icon: Users,
      },
      {
        title: 'Cài đặt hệ thống',
        href: '/settings',
        icon: Settings,
      },
    ],
  },
];

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
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobileNav();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            !drawerRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            !drawerRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileOpen, closeMobileNav]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex overflow-x-hidden">
      {/* Desktop Sidebar (hidden on mobile, made inert when mobile drawer is open) */}
      <div
        className="hidden lg:block shrink-0 sticky top-0 h-screen z-30"
        aria-hidden={isMobileOpen ? 'true' : undefined}
        inert={isMobileOpen || undefined}
      >
        <DashboardSidebar
          navSections={navSections}
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
              navSections={navSections}
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
        inert={isMobileOpen || undefined}
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
