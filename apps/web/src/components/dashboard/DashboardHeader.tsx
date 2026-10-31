/**
 * Ported from Kiranism/next-shadcn-dashboard-starter (MIT License)
 * Source: https://github.com/Kiranism/next-shadcn-dashboard-starter
 * License: MIT
 *
 * Top application header for the dashboard shell.
 * Includes mobile menu trigger, shop/branch context, global search trigger,
 * and user profile navigation menu.
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { LogOut, Menu, Search, Store, User } from 'lucide-react';
import { DashboardUser } from './types';

interface DashboardHeaderProps {
  currentUser?: DashboardUser;
  shopName?: string;
  onToggleMobileNav?: () => void;
  isMobileNavOpen?: boolean;
  onSignOut?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function DashboardHeader({
  currentUser,
  shopName = 'Ship Dễ Store',
  onToggleMobileNav,
  isMobileNavOpen = false,
  onSignOut,
  actions,
  className = '',
}: DashboardHeaderProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    }
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  const initials = currentUser?.name
    ? currentUser.name
        .split(' ')
        .map((n) => n[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : 'SD';

  return (
    <header
      className={`h-16 px-4 sm:px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-between gap-4 sticky top-0 z-20 ${className}`}
    >
      {/* Left: Mobile hamburger & Shop Context */}
      <div className="flex items-center gap-3">
        {onToggleMobileNav && (
          <button
            type="button"
            onClick={onToggleMobileNav}
            aria-label="Mở thanh điều hướng"
            aria-expanded={isMobileNavOpen}
            className="lg:hidden p-2 rounded-[8px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        )}

        {/* Shop context badge */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-[var(--bg-app)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
          <Store className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" aria-hidden="true" />
          <span className="font-semibold text-[var(--text-primary)] max-w-[150px] sm:max-w-xs truncate">
            {shopName}
          </span>
        </div>
      </div>

      {/* Center / Search bar shortcut */}
      <div className="hidden md:flex items-center max-w-md w-full">
        <div className="relative w-full">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            type="text"
            readOnly
            placeholder="Tìm kiếm nhanh vận đơn, đơn hàng... (Ctrl + K)"
            aria-label="Tìm kiếm nhanh toàn hệ thống"
            className="w-full h-9 pl-9 pr-4 text-xs rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:border-[var(--border-strong)] cursor-pointer focus:outline-none"
          />
        </div>
      </div>

      {/* Right: Actions & User Navigation Menu */}
      <div className="flex items-center gap-3">
        {actions}

        {/* User profile dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            aria-label="Menu tài khoản cá nhân"
            aria-expanded={isUserMenuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 p-1.5 rounded-[8px] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--primary-subtle)] text-[var(--primary)] font-bold text-xs flex items-center justify-center border border-[var(--primary-border)]">
              {initials}
            </div>
            <div className="hidden sm:block text-left text-xs leading-tight">
              <div className="font-semibold text-[var(--text-primary)] max-w-[120px] truncate">
                {currentUser?.name || 'Tài khoản Ship Dễ'}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] max-w-[120px] truncate">
                {currentUser?.role || 'Người dùng'}
              </div>
            </div>
          </button>

          {isUserMenuOpen && (
            <div
              role="menu"
              aria-label="Menu tài khoản"
              className="absolute right-0 top-full mt-2 w-56 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xl py-1 z-40 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                <div className="font-semibold text-xs text-[var(--text-primary)] truncate">
                  {currentUser?.name || 'Tài khoản'}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">
                  {currentUser?.email || 'user@shipde.net'}
                </div>
                <div className="mt-1">
                  <span className="badge-ok !text-[10px] !py-0.5 !px-1.5">
                    {currentUser?.role || 'Chủ Shop'}
                  </span>
                </div>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setIsUserMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
                >
                  <User className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>Hồ sơ tài khoản</span>
                </button>
              </div>

              {onSignOut && (
                <>
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <div className="py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onSignOut();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--status-risk-text)] hover:bg-[var(--status-risk-bg)] cursor-pointer transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
