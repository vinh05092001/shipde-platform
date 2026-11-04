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
 * User profile dropdown menu with keyboard navigation and focus restoration.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { maskEmail } from './dashboard-header-utils';
import { DashboardUser } from './types';

interface DashboardUserMenuProps {
  currentUser?: DashboardUser | null;
  profileHref: string;
  onProfileClick?: () => void;
  onSignOut?: () => void;
  isUserMenuOpen: boolean;
  setIsUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userMenuRef: React.RefObject<HTMLDivElement | null>;
  userMenuTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onSetMenuItemRef: (index: number, el: HTMLElement | null) => void;
  userMenuLabel: string;
  initials: string;
  handleTriggerKeyDown: (e: React.KeyboardEvent) => void;
  handleMenuItemKeyDown: (e: React.KeyboardEvent, index: number) => void;
}

export function DashboardUserMenu({
  currentUser,
  profileHref,
  onProfileClick,
  onSignOut,
  isUserMenuOpen,
  setIsUserMenuOpen,
  userMenuRef,
  userMenuTriggerRef,
  onSetMenuItemRef,
  userMenuLabel,
  initials,
  handleTriggerKeyDown,
  handleMenuItemKeyDown,
}: DashboardUserMenuProps) {
  return (
    <div className="relative" ref={userMenuRef}>
      <button
        ref={userMenuTriggerRef}
        type="button"
        onClick={() => setIsUserMenuOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-label="Menu tài khoản cá nhân"
        title={userMenuLabel}
        aria-expanded={isUserMenuOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2 p-1.5 rounded-[8px] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      >
        <div className="w-8 h-8 rounded-full bg-[var(--primary-subtle)] text-[var(--primary)] font-bold text-xs flex items-center justify-center border border-[var(--primary-border)]">
          {initials}
        </div>
        <div className="hidden sm:block text-left text-xs leading-tight">
          <div className="font-semibold text-[var(--text-primary)] max-w-[120px] truncate">
            {currentUser?.name || 'Chưa đăng nhập'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] max-w-[120px] truncate">
            {currentUser?.role || 'Khách'}
          </div>
        </div>
      </button>

      {isUserMenuOpen && (
        <div
          role="menu"
          aria-label="Menu tài khoản"
          className="absolute right-0 top-full mt-2 w-56 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xl py-1 z-40 animate-in fade-in zoom-in-95 duration-100"
        >
          {currentUser ? (
            <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
              <div className="font-semibold text-xs text-[var(--text-primary)] truncate">
                {currentUser.name}
              </div>
              {currentUser.email && (
                <div
                  className="text-[11px] text-[var(--text-muted)] truncate"
                  data-testid="user-email"
                >
                  {maskEmail(currentUser.email)}
                </div>
              )}
              {currentUser.role && (
                <div className="mt-1">
                  <span className="badge-ok !text-[10px] !py-0.5 !px-1.5">{currentUser.role}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-center">
              <div className="font-semibold text-xs text-[var(--text-secondary)]">
                Chưa đăng nhập
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Thông tin tài khoản không khả dụng
              </div>
            </div>
          )}

          {currentUser && (
            <div className="py-1">
              <Link
                ref={(el) => {
                  onSetMenuItemRef(0, el);
                }}
                href={profileHref}
                role="menuitem"
                tabIndex={0}
                onClick={() => {
                  setIsUserMenuOpen(false);
                  onProfileClick?.();
                }}
                onKeyDown={(e) => handleMenuItemKeyDown(e, 0)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                <User className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <span>Hồ sơ tài khoản</span>
              </Link>
            </div>
          )}

          {onSignOut && (
            <>
              <div className="h-px bg-[var(--border-subtle)] my-1" />
              <div className="py-1">
                <button
                  ref={(el) => {
                    const signOutIdx = currentUser ? 1 : 0;
                    onSetMenuItemRef(signOutIdx, el);
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    onSignOut();
                  }}
                  onKeyDown={(e) => handleMenuItemKeyDown(e, currentUser ? 1 : 0)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--status-risk-text)] hover:bg-[var(--status-risk-bg)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-risk-border)]"
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
  );
}
