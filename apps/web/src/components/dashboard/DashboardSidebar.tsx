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
 * Collapsible sidebar with navigation sections, active indicators,
 * notification badges, and mobile drawer support.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Package, X } from 'lucide-react';
import { NavItem, NavSection } from './types';

interface DashboardSidebarProps {
  navSections: NavSection[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobile?: boolean;
  onCloseMobile?: () => void;
  className?: string;
}

export function DashboardSidebar({
  navSections,
  isCollapsed = false,
  onToggleCollapse,
  isMobile = false,
  onCloseMobile,
  className = '',
}: DashboardSidebarProps) {
  const pathname = usePathname();

  const renderBadge = (item: NavItem) => {
    if (item.badge === undefined || item.badge === null) return null;

    let variantClass =
      'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)]';
    if (item.badgeVariant === 'risk') {
      variantClass =
        'bg-[var(--status-risk-bg)] text-[var(--status-risk-text)] border-[var(--status-risk-border)]';
    } else if (item.badgeVariant === 'warn') {
      variantClass =
        'bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] border-[var(--status-warn-border)]';
    } else if (item.badgeVariant === 'ok') {
      variantClass =
        'bg-[var(--status-ok-bg)] text-[var(--status-ok-text)] border-[var(--status-ok-border)]';
    }

    return (
      <span
        className={`tabular-nums font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${variantClass} ml-auto`}
      >
        {item.badge}
      </span>
    );
  };

  return (
    <aside
      aria-label="Thanh điều hướng chính"
      className={`h-full flex flex-col bg-[var(--bg-card)] border-r border-[var(--border-subtle)] transition-all duration-300 select-none ${
        isMobile ? 'w-72' : isCollapsed ? 'w-18' : 'w-64'
      } ${className}`}
    >
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
        <Link
          href="/"
          className="flex items-center gap-3 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[6px]"
          title="Ship Dễ Home"
        >
          <div className="w-9 h-9 rounded-[8px] bg-[var(--primary)] text-white flex items-center justify-center shrink-0 shadow-sm font-bold text-base">
            <Package className="w-5 h-5" aria-hidden="true" />
          </div>

          {(!isCollapsed || isMobile) && (
            <div className="flex flex-col leading-tight">
              <span className="font-extrabold text-sm tracking-tight text-[var(--text-primary)]">
                Ship Dễ
              </span>
              <span className="text-[10px] font-medium text-[var(--text-muted)]">
                Điều hành & Đối soát
              </span>
            </div>
          )}
        </Link>

        {isMobile && onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Đóng thanh điều hướng"
            className="p-1.5 rounded-[6px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 custom-scrollbar">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-1">
            {section.title && (!isCollapsed || isMobile) && (
              <div className="px-3 text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
                {section.title}
              </div>
            )}

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.disabled ? '#' : item.href}
                    aria-current={isActive ? 'page' : undefined}
                    aria-disabled={item.disabled}
                    title={isCollapsed && !isMobile ? item.title : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-[8px] text-xs font-medium transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                      isActive
                        ? 'bg-[var(--primary-subtle)] text-[var(--primary)] font-semibold shadow-xs'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                    } ${item.disabled ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {Icon && (
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive
                            ? 'text-[var(--primary)]'
                            : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                        }`}
                        aria-hidden="true"
                      />
                    )}

                    {(!isCollapsed || isMobile) && <span className="truncate">{item.title}</span>}

                    {(!isCollapsed || isMobile) && renderBadge(item)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Collapse Button (Desktop Only) */}
      {!isMobile && onToggleCollapse && (
        <div className="p-3 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-[8px] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                <span>Thu gọn thanh điều hướng</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
