/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 *
 * MIT License
 * Copyright (c) 2024 Sadman Sakib
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
 * Column header with accessible sorting controls, ARIA sort attributes,
 * trigger focus restoration, and arrow-key menu navigation.
 */

'use client';

import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff } from 'lucide-react';
import { ColumnDef, ColumnSort } from './types';

interface DataTableColumnHeaderProps<TData = any> {
  column: ColumnDef<TData>;
  title: string;
  sort?: ColumnSort | null;
  onSort?: (columnId: string, desc: boolean) => void;
  onHide?: (columnId: string) => void;
  className?: string;
}

export function DataTableColumnHeader<TData = any>({
  column,
  title,
  sort,
  onSort,
  onHide,
  className = '',
}: DataTableColumnHeaderProps<TData>) {
  const [isOpen, setIsOpen] = useState(false);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const prevIsOpenRef = useRef(false);

  const isSorted = sort?.id === column.id ? (sort.desc ? 'desc' : 'asc') : false;

  const updateMenuPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 176;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      setMenuPosition({
        top: rect.bottom + 6,
        left,
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  // Restore trigger focus on dropdown close (Finding 14 P2)
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Focus first item when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        menuItemRefs.current[0]?.focus();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (column.enableSorting === false || !onSort) {
    return (
      <div
        className={`text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider ${className}`}
      >
        {title}
      </div>
    );
  }

  const ariaSort = isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : 'none';
  const labelText = `Sắp xếp theo ${title}: hiện tại ${isSorted === 'asc' ? 'tăng dần' : isSorted === 'desc' ? 'giảm dần' : 'chưa sắp xếp'}`;

  const hasHide = column.enableHiding !== false && Boolean(onHide);
  const totalMenuItems = hasHide ? 3 : 2;

  const handleMenuItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (index + 1) % totalMenuItems;
      menuItemRefs.current[nextIdx]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (index - 1 + totalMenuItems) % totalMenuItems;
      menuItemRefs.current[prevIdx]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuItemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuItemRefs.current[totalMenuItems - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const menuElement = isOpen ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Tùy chọn cho cột ${title}`}
      className={`${
        isMounted && typeof document !== 'undefined'
          ? 'fixed z-50'
          : 'absolute left-0 top-full mt-1.5 z-30'
      } w-44 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100`}
      style={
        isMounted && typeof document !== 'undefined'
          ? {
              top: menuPosition ? `${menuPosition.top}px` : undefined,
              left: menuPosition ? `${menuPosition.left}px` : undefined,
              visibility: menuPosition ? 'visible' : 'hidden',
            }
          : undefined
      }
    >
      <button
        ref={(el) => {
          menuItemRefs.current[0] = el;
        }}
        type="button"
        role="menuitem"
        tabIndex={0}
        onClick={() => {
          onSort(column.id, false);
          setIsOpen(false);
        }}
        onKeyDown={(e) => handleMenuItemKeyDown(e, 0)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
          isSorted === 'asc'
            ? 'font-semibold text-[var(--primary)] bg-[var(--primary-subtle)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
        }`}
      >
        <ArrowUp className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span>Tăng dần</span>
      </button>

      <button
        ref={(el) => {
          menuItemRefs.current[1] = el;
        }}
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onSort(column.id, true);
          setIsOpen(false);
        }}
        onKeyDown={(e) => handleMenuItemKeyDown(e, 1)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
          isSorted === 'desc'
            ? 'font-semibold text-[var(--primary)] bg-[var(--primary-subtle)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
        }`}
      >
        <ArrowDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span>Giảm dần</span>
      </button>

      {hasHide && (
        <>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
          <button
            ref={(el) => {
              menuItemRefs.current[2] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onHide!(column.id);
              setIsOpen(false);
            }}
            onKeyDown={(e) => handleMenuItemKeyDown(e, 2)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <EyeOff className="w-3.5 h-3.5 text-[var(--text-dim)]" aria-hidden="true" />
            <span>Ẩn cột này</span>
          </button>
        </>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center gap-1 ${className}`}
      data-sort={ariaSort}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={labelText}
        title={labelText}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (next) {
              updateMenuPosition();
            } else {
              setMenuPosition(null);
            }
            return next;
          });
        }}
        className="group inline-flex items-center gap-1.5 px-1.5 py-1 -ml-1.5 rounded-[6px] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
      >
        <span>{title}</span>
        {isSorted === 'desc' ? (
          <ArrowDown className="w-3.5 h-3.5 text-[var(--primary)]" />
        ) : isSorted === 'asc' ? (
          <ArrowUp className="w-3.5 h-3.5 text-[var(--primary)]" />
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)]" />
        )}
      </button>

      {isOpen &&
        (isMounted && typeof document !== 'undefined'
          ? createPortal(menuElement, document.body)
          : menuElement)}
    </div>
  );
}
