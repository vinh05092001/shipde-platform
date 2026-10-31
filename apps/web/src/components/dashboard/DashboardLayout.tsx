/**
 * Ported from Kiranism/next-shadcn-dashboard-starter (MIT License)
 * Source: https://github.com/Kiranism/next-shadcn-dashboard-starter
 * License: MIT
 *
 * Full Dashboard Shell Layout with responsive sidebar, header, and content container.
 */

'use client';

import React, { useState, useEffect } from 'react';
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
}: DashboardLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex overflow-x-hidden">
      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden lg:block shrink-0 sticky top-0 h-screen z-30">
        <DashboardSidebar
          navSections={navSections}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
        />
      </div>

      {/* Mobile Sidebar Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer container */}
          <div className="fixed inset-y-0 left-0 max-w-full flex">
            <DashboardSidebar
              navSections={navSections}
              isMobile={true}
              onCloseMobile={() => setIsMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <DashboardHeader
          currentUser={currentUser}
          shopName={shopName}
          onToggleMobileNav={() => setIsMobileOpen(true)}
          isMobileNavOpen={isMobileOpen}
          onSignOut={onSignOut}
          actions={headerActions}
        />

        {/* Scrollable Page Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
