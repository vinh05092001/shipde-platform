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
 * PageHeader / Heading pattern for dashboard views.
 * Supports breadcrumbs, title, description, and action buttons.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { BreadcrumbItem } from './types';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`space-y-3 pb-4 border-b border-[var(--border-subtle)] ${className}`}>
      {/* Breadcrumb Navigation */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Đường dẫn trang"
          className="flex items-center space-x-1 text-xs text-[var(--text-muted)]"
        >
          <Link
            href="/"
            className="flex items-center hover:text-[var(--text-primary)] transition-colors"
            title="Trang chủ"
            aria-label="Trang chủ"
          >
            <Home className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>

          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;

            return (
              <React.Fragment key={idx}>
                <ChevronRight
                  className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0"
                  aria-hidden="true"
                />
                {isLast || !crumb.href ? (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={`truncate ${
                      isLast
                        ? 'font-semibold text-[var(--text-primary)]'
                        : 'hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="truncate hover:text-[var(--text-primary)] transition-colors"
                  >
                    {crumb.label}
                  </Link>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      )}

      {/* Title & Actions Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export function Heading({
  title,
  description,
  className = '',
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
      {description && <p className="text-xs text-[var(--text-muted)]">{description}</p>}
    </div>
  );
}
