'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from Kiranism/next-shadcn-dashboard-starter
 * (https://github.com/Kiranism/next-shadcn-dashboard-starter)
 * Copyright (c) 2024 Kiranism
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

import React from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * PageHeader (ported from Kiranism/next-shadcn-dashboard-starter Heading pattern)
 * Enforces Ship Dễ typography scale (24px bold H1, 14px muted subtitle, 8px grid alignment)
 * and limits top-right primary actions to 1 primary + secondary actions.
 */
export function PageHeader({
  title,
  description,
  badge,
  metadata,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-4 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-start sm:justify-between ${className}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="max-w-3xl text-xs sm:text-sm text-slate-600">{description}</p>
        )}
        {metadata && <div className="pt-1 text-xs text-slate-500">{metadata}</div>}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface PageContainerProps {
  children?: React.ReactNode;
  scrollable?: boolean;
  maxWidthClass?: string;
  className?: string;
}

/**
 * PageContainer (ported from Kiranism/next-shadcn-dashboard-starter PageContainer)
 * Provides consistent 24px (p-6) desktop / 16px (p-4) mobile padding and max-width 1600px.
 */
export function PageContainer({
  children,
  scrollable = true,
  maxWidthClass = 'max-w-[1600px]',
  className = '',
}: PageContainerProps) {
  const inner = (
    <div className={`mx-auto w-full ${maxWidthClass} p-4 sm:p-6 space-y-6 ${className}`}>
      {children}
    </div>
  );

  if (scrollable) {
    return <div className="flex-1 overflow-y-auto">{inner}</div>;
  }

  return <div className="flex flex-1 flex-col overflow-hidden">{inner}</div>;
}
