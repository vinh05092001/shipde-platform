'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from sadmann7/shadcn-table
 * (https://github.com/sadmann7/shadcn-table)
 * Copyright (c) 2023 Sadman Sakib
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

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, PlusCircle, Search, X } from 'lucide-react';
import type { DataTableOption } from './types';

export interface DataTableFacetedFilterProps {
  columnId: string;
  title: string;
  options: DataTableOption[];
  selectedValues: string[];
  facetCounts?: Record<string, number>;
  onChange: (nextValues: string[] | undefined) => void;
}

export function DataTableFacetedFilter({
  columnId,
  title,
  options,
  selectedValues,
  facetCounts,
  onChange,
}: DataTableFacetedFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputId = useId();

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter(
      (opt) => opt.label.toLowerCase().includes(query) || opt.value.toLowerCase().includes(query)
    );
  }, [options, searchQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const toggleOption = (optionValue: string) => {
    const next = new Set(selectedSet);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    const nextArray = Array.from(next);
    onChange(nextArray.length > 0 ? nextArray : undefined);
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block text-left"
      data-faceted-filter={columnId}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Lọc theo ${title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Lọc dữ liệu theo ${title}`}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border border-dashed px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
          selectedSet.size > 0
            ? 'border-orange-300 bg-orange-50/70 text-orange-900'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <PlusCircle className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>{title}</span>

        {selectedSet.size > 0 && (
          <>
            <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden="true" />
            <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800 tabular-nums lg:hidden">
              {selectedSet.size}
            </span>
            <div className="hidden items-center gap-1 lg:flex">
              {selectedSet.size > 2 ? (
                <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800 tabular-nums">
                  Đã chọn {selectedSet.size}
                </span>
              ) : (
                options
                  .filter((opt) => selectedSet.has(opt.value))
                  .map((opt) => (
                    <span
                      key={opt.value}
                      className="inline-flex items-center rounded bg-orange-100/90 px-1.5 py-0.5 text-[11px] font-medium text-orange-900"
                    >
                      {opt.label}
                    </span>
                  ))
              )}
            </div>
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Bộ lọc đa tiêu chí ${title}`}
          className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <div className="relative mb-2 flex items-center border-b border-slate-100 pb-2">
            <label htmlFor={searchInputId} className="sr-only">
              Tìm tùy chọn trong {title}
            </label>
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              id={searchInputId}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Tìm ${title.toLowerCase()}...`}
              className="w-full rounded-md bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Xóa từ khóa tìm tùy chọn"
                title="Xóa từ khóa"
                className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={`Danh sách lựa chọn ${title}`}
            className="max-h-56 overflow-y-auto space-y-0.5"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">
                Không tìm thấy tùy chọn phù hợp.
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedSet.has(option.value);
                const IconComponent = option.icon;
                const count = facetCounts?.[option.value] ?? option.count;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggleOption(option.value)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
                      isSelected
                        ? 'bg-orange-50/80 font-medium text-slate-900'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? 'border-orange-600 bg-orange-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      {IconComponent && (
                        <IconComponent className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      )}
                      <span className="truncate">{option.label}</span>
                    </span>

                    {typeof count === 'number' && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {selectedSet.size > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Xóa bộ lọc {title.toLowerCase()}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
