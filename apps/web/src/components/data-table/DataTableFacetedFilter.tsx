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
 * Faceted filter dropdown with multi-select checkboxes, count badges,
 * optimistic selection accumulation, and accessible listbox keyboard navigation.
 */

'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Check, PlusCircle, X } from 'lucide-react';
import { DataTableFilterOption } from './types';

interface DataTableFacetedFilterProps {
  title: string;
  options: DataTableFilterOption[];
  selectedValues?: Set<string>;
  onSelect: (values: string[]) => void;
  className?: string;
  historyEpoch?: number;
  resetEpoch?: number;
}

/**
 * Computes the synchronized optimistic selection for faceted filter when
 * committed selectedValues prop, historyEpoch, or resetEpoch changes (Finding 4 P1).
 * Preserves optimistic selections when multiple selections happen in the same
 * dropdown before committed search params update, and drops pending selections
 * on browser history navigation (popstate) or explicit external filter resets.
 */
export function computeOptimisticFacetSelection(
  currentOptimistic: Set<string>,
  incomingCommitted: Set<string>,
  prevCommitted: Set<string>,
  pendingSelections: string[],
  historyEvent = false,
  resetEvent = false
): {
  nextOptimistic: Set<string>;
  nextPending: string[];
  wasIgnoredDueToPending: boolean;
} {
  if (resetEvent) {
    return {
      nextOptimistic: new Set<string>(),
      nextPending: [],
      wasIgnoredDueToPending: false,
    };
  }

  if (historyEvent) {
    return {
      nextOptimistic: new Set(incomingCommitted),
      nextPending: [],
      wasIgnoredDueToPending: false,
    };
  }

  const incomingStr = Array.from(incomingCommitted).sort().join('.');
  const prevStr = Array.from(prevCommitted).sort().join('.');

  if (incomingStr === prevStr) {
    return {
      nextOptimistic: currentOptimistic,
      nextPending: pendingSelections,
      wasIgnoredDueToPending: false,
    };
  }

  const pendingIdx = pendingSelections.indexOf(incomingStr);
  if (pendingIdx !== -1) {
    const nextPending = pendingSelections.slice(pendingIdx + 1);
    if (nextPending.length === 0) {
      // All pending selections acknowledged
      return {
        nextOptimistic: new Set(incomingCommitted),
        nextPending,
        wasIgnoredDueToPending: false,
      };
    } else {
      // User made newer selections; preserve current optimistic values
      return {
        nextOptimistic: currentOptimistic,
        nextPending,
        wasIgnoredDueToPending: true,
      };
    }
  }

  // External change (e.g. resetFilters)
  return {
    nextOptimistic: new Set(incomingCommitted),
    nextPending: [],
    wasIgnoredDueToPending: false,
  };
}

export function DataTableFacetedFilter({
  title,
  options,
  selectedValues = new Set(),
  onSelect,
  className = '',
  historyEpoch,
  resetEpoch,
}: DataTableFacetedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Optimistic facet selections queue (Finding 4 P1)
  const [optimisticValues, setOptimisticValues] = useState<Set<string>>(
    () => new Set(selectedValues)
  );
  const pendingSelectionsRef = useRef<string[]>([]);
  const prevCommittedRef = useRef<Set<string>>(selectedValues);
  const prevHistoryEpochRef = useRef<number | undefined>(historyEpoch);
  const prevResetEpochRef = useRef<number | undefined>(resetEpoch);
  const prevIsOpenRef = useRef(false);

  // Synchronize optimistic state with prop changes
  useEffect(() => {
    const historyEvent =
      historyEpoch !== undefined &&
      prevHistoryEpochRef.current !== undefined &&
      historyEpoch !== prevHistoryEpochRef.current;
    prevHistoryEpochRef.current = historyEpoch;

    const resetEvent =
      resetEpoch !== undefined &&
      prevResetEpochRef.current !== undefined &&
      resetEpoch !== prevResetEpochRef.current;
    prevResetEpochRef.current = resetEpoch;

    const res = computeOptimisticFacetSelection(
      optimisticValues,
      selectedValues,
      prevCommittedRef.current,
      pendingSelectionsRef.current,
      historyEvent,
      resetEvent
    );
    prevCommittedRef.current = selectedValues;
    pendingSelectionsRef.current = res.nextPending;
    if (res.nextOptimistic !== optimisticValues) {
      setOptimisticValues(res.nextOptimistic);
    }
  }, [selectedValues, historyEpoch, resetEpoch, optimisticValues]);

  // Restore trigger focus on dropdown close (Finding 14 P2)
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  // Reset option refs when options change
  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, filteredOptions.length);
  }, [filteredOptions]);

  const handleToggle = (value: string) => {
    const next = new Set(optimisticValues);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setOptimisticValues(next);
    const serialized = Array.from(next).sort().join('.');
    pendingSelectionsRef.current.push(serialized);
    onSelect(Array.from(next));
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set<string>();
    setOptimisticValues(next);
    pendingSelectionsRef.current.push('');
    onSelect([]);
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent, index: number, value: string) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleToggle(value);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (index + 1) % filteredOptions.length;
      optionRefs.current[nextIdx]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (index - 1 + filteredOptions.length) % filteredOptions.length;
      optionRefs.current[prevIdx]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      optionRefs.current[filteredOptions.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const selectedCount = optimisticValues.size;

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Bộ lọc ${title}: ${selectedCount > 0 ? `${selectedCount} đã chọn` : 'chưa chọn'}`}
        title={`Bộ lọc ${title}: ${selectedCount > 0 ? `${selectedCount} đã chọn` : 'chưa chọn'}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-[6px] border text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
          selectedCount > 0
            ? 'border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
        }`}
      >
        <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{title}</span>

        {selectedCount > 0 && (
          <>
            <div className="h-3 w-px bg-[var(--primary)]/30 mx-0.5" />
            <span className="tabular-nums font-mono px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--primary)] text-white">
              {selectedCount}
            </span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={`Danh sách tùy chọn cho ${title}`}
          className="absolute left-0 top-full mt-1.5 w-60 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xl p-2 z-40 animate-in fade-in zoom-in-95 duration-100"
        >
          {options.length > 5 && (
            <div className="mb-2">
              <input
                type="text"
                placeholder={`Tìm ${title.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' && filteredOptions.length > 0) {
                    e.preventDefault();
                    optionRefs.current[0]?.focus();
                  }
                }}
                aria-label={`Tìm kiếm tùy chọn ${title}`}
                className="w-full h-7 px-2 text-xs rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
              />
            </div>
          )}

          <div
            role="listbox"
            aria-multiselectable="true"
            className="max-h-56 overflow-y-auto space-y-0.5 py-1"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-[var(--text-muted)]">
                Không tìm thấy tùy chọn nào
              </div>
            ) : (
              filteredOptions.map((option, optIdx) => {
                const isSelected = optimisticValues.has(option.value);
                const Icon = option.icon;

                return (
                  <div
                    key={option.value}
                    ref={(el) => {
                      optionRefs.current[optIdx] = el;
                    }}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => handleToggle(option.value)}
                    onKeyDown={(e) => handleOptionKeyDown(e, optIdx, option.value)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-[4px] text-xs cursor-pointer select-none transition-colors ${
                      isSelected
                        ? 'bg-[var(--primary-subtle)] text-[var(--primary)] font-medium'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div
                        className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                            : 'border-[var(--border-strong)] bg-white'
                        }`}
                      >
                        {isSelected && (
                          <Check className="w-2.5 h-2.5 stroke-[3]" aria-hidden="true" />
                        )}
                      </div>

                      {Icon && (
                        <Icon
                          className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{option.label}</span>
                    </div>

                    {option.count !== undefined && (
                      <span className="tabular-nums font-mono text-[11px] text-[var(--text-muted)] ml-2">
                        {option.count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {selectedCount > 0 && (
            <>
              <div className="h-px bg-[var(--border-subtle)] my-1.5" />
              <button
                type="button"
                onClick={handleClear}
                title="Xóa bộ lọc này"
                className="w-full flex items-center justify-center gap-1.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] rounded-[4px] transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" aria-hidden="true" />
                <span>Xóa bộ lọc này</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
