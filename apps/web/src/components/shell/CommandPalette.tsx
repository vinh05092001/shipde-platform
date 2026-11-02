'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from '../ui/sheet';
import type { NavTarget } from './navigation';

export function CommandTargets({
  targets,
  query,
  onSelect,
}: {
  targets: NavTarget[];
  query: string;
  onSelect: (target: NavTarget) => void;
}) {
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi')
      .replace(/đ/g, 'd');
  const matching = targets.filter((t) =>
    normalize(t.label + ' ' + t.group).includes(normalize(query.trim()))
  );
  return (
    <div
      className="shell-command-results"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
        );
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}
    >
      <ul aria-label="Trang có thể truy cập">
        {matching.map((target) => (
          <li key={target.id}>
            <button type="button" className="shell-command-target" onClick={() => onSelect(target)}>
              <target.icon size={18} aria-hidden="true" />
              <span>
                {target.label}
                <small className="block text-(--text-muted)">{target.group}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!matching.length && (
        <p role="status" className="p-4 text-(--text-secondary)">
          {targets.length
            ? 'Không tìm thấy trang phù hợp. Thử từ khóa khác.'
            : 'Chưa có mục điều hướng. Liên hệ quản trị viên để được cấp quyền.'}
        </p>
      )}
    </div>
  );
}
export function CommandPalette({
  targets,
  onClose,
}: {
  targets: NavTarget[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  useEffect(() => {
    // Sheet opens after mount; place focus in its labelled search field.
    document.getElementById('shell-command-query')?.focus();
  }, []);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Chuyển đến trang"
      variant="command"
    >
      <div className="p-4">
        <label htmlFor="shell-command-query" className="sr-only">
          Tìm trang
        </label>
        <input
          id="shell-command-query"
          className="modern-input"
          type="search"
          placeholder="Tìm trang…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter') {
              const first = event.currentTarget
                .closest('dialog')
                ?.querySelector<HTMLButtonElement>('.shell-command-target');
              if (first) {
                event.preventDefault();
                if (event.key === 'Enter') first.click();
                else first.focus();
              }
            }
          }}
        />
      </div>
      <CommandTargets
        targets={targets}
        query={query}
        onSelect={(target) => {
          onClose();
          router.push(target.href);
        }}
      />
    </Sheet>
  );
}
