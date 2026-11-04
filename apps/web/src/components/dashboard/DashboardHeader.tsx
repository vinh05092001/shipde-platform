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
 * Top application header with mobile menu trigger, shop context, search trigger,
 * and user profile navigation menu.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, Search, Store } from 'lucide-react';
import type { DashboardUser } from './types';
import { DashboardUserMenu } from './DashboardUserMenu';
import { createGlobalShortcutHandler } from './dashboard-header-utils';

export {
  createGlobalShortcutHandler,
  maskEmail,
  type GlobalShortcutOptions,
  type ShortcutKeyEvent,
} from './dashboard-header-utils';

export interface DashboardHeaderProps {
  currentUser?: DashboardUser | null;
  shopName?: string;
  onToggleMobileNav?: () => void;
  isMobileNavOpen?: boolean;
  onSignOut?: () => void;
  actions?: React.ReactNode;
  className?: string;
  onSearchClick?: () => void;
  searchHref?: string;
  onProfileClick?: () => void;
  profileHref?: string;
  showSearch?: boolean;
  defaultUserMenuOpen?: boolean;
}

export function DashboardHeader({
  currentUser,
  shopName = 'Ship Dễ — Shop Demo',
  onToggleMobileNav,
  isMobileNavOpen = false,
  actions,
  onSearchClick,
  searchHref = '/search',
  onProfileClick,
  profileHref = '/settings/profile',
  onSignOut,
  showSearch = true,
  defaultUserMenuOpen = false,
  className = '',
}: DashboardHeaderProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(defaultUserMenuOpen);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const prevUserMenuOpenRef = useRef(false);
  const menuItemRefs = useRef<(HTMLElement | null)[]>([]);

  // Restore trigger focus on user menu close (Finding 14 P2)
  useEffect(() => {
    if (prevUserMenuOpenRef.current && !isUserMenuOpen) {
      userMenuTriggerRef.current?.focus();
    }
    prevUserMenuOpenRef.current = isUserMenuOpen;
  }, [isUserMenuOpen]);

  // Focus first menu item on open (Round 14 / Finding 11 P2)
  useEffect(() => {
    if (isUserMenuOpen) {
      const timer = setTimeout(() => {
        const first = menuItemRefs.current.find(Boolean);
        first?.focus();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [isUserMenuOpen]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsUserMenuOpen(true);
    }
  };

  const handleMenuItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    const activeItems = menuItemRefs.current.filter((item): item is HTMLElement => item !== null);
    const total = activeItems.length;
    if (total === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (index + 1) % total;
      activeItems[nextIdx]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (index - 1 + total) % total;
      activeItems[prevIdx]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      activeItems[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      activeItems[total - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsUserMenuOpen(false);
      userMenuTriggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setIsUserMenuOpen(false);
    }
  };

  const handleSetMenuItemRef = (index: number, el: HTMLElement | null) => {
    menuItemRefs.current[index] = el;
  };

  const handleSearchActivation = useCallback(() => {
    if (onSearchClick) {
      onSearchClick();
    } else if (typeof window !== 'undefined' && searchHref) {
      window.location.href = searchHref;
    }
  }, [onSearchClick, searchHref]);

  // Register Ctrl+K global keyboard listener
  useEffect(() => {
    if (!showSearch) return;

    const handler = createGlobalShortcutHandler({
      showSearch,
      onTrigger: handleSearchActivation,
    });
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSearchActivation, showSearch]);

  // Close user profile dropdown on click outside or escape key
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
        .map((n: string) => n[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : '--';

  const userMenuLabel = currentUser
    ? `Menu tài khoản của ${currentUser.name}`
    : 'Menu tài khoản (Chưa đăng nhập)';

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
            title="Mở thanh điều hướng"
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

      {/* Center: Global Search shortcut trigger */}
      {showSearch && (
        <div className="hidden md:flex items-center max-w-md w-full">
          <div className="relative w-full">
            <button
              type="button"
              onClick={handleSearchActivation}
              aria-label="Tìm kiếm nhanh toàn hệ thống (Ctrl + K)"
              title="Tìm kiếm nhanh toàn hệ thống (Ctrl + K)"
              className="w-full h-9 pl-9 pr-3 text-xs rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] cursor-pointer text-left flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <div className="flex items-center gap-2 truncate">
                <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                <span className="truncate">Tìm kiếm nhanh vận đơn, đơn hàng...</span>
              </div>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-dim)] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[4px] shrink-0">
                Ctrl K
              </kbd>
            </button>
          </div>
        </div>
      )}

      {/* Right: Actions & User Navigation Menu */}
      <div className="flex items-center gap-3">
        {actions}

        <DashboardUserMenu
          currentUser={currentUser}
          profileHref={profileHref}
          onProfileClick={onProfileClick}
          onSignOut={onSignOut}
          isUserMenuOpen={isUserMenuOpen}
          setIsUserMenuOpen={setIsUserMenuOpen}
          userMenuRef={userMenuRef}
          userMenuTriggerRef={userMenuTriggerRef}
          onSetMenuItemRef={handleSetMenuItemRef}
          userMenuLabel={userMenuLabel}
          initials={initials}
          handleTriggerKeyDown={handleTriggerKeyDown}
          handleMenuItemKeyDown={handleMenuItemKeyDown}
        />
      </div>
    </header>
  );
}
