/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 * License: MIT
 *
 * Faceted filter dropdown with multi-select checkboxes and count badges.
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
}

export function DataTableFacetedFilter({
  title,
  options,
  selectedValues = new Set(),
  onSelect,
  className = '',
}: DataTableFacetedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleToggle = (value: string) => {
    const next = new Set(selectedValues);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onSelect(Array.from(next));
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect([]);
  };

  const selectedCount = selectedValues.size;

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        aria-label={`Bộ lọc ${title}: ${selectedCount > 0 ? `${selectedCount} đã chọn` : 'chưa chọn'}`}
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
              filteredOptions.map((option) => {
                const isSelected = selectedValues.has(option.value);
                const Icon = option.icon;

                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => handleToggle(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        handleToggle(option.value);
                      }
                    }}
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
