/**
 * Layout patterns adapted from Kiranism/next-shadcn-dashboard-starter.
 * MIT License, Copyright (c) 2023 Kiranism. Reference only; existing auth/spec wins.
 * https://github.com/Kiranism/next-shadcn-dashboard-starter/blob/main/src/components/layout/app-sidebar.tsx
 * MIT permission notice: ./REFERENCE-LICENSE.md.
 */
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search, LogOut, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '../ui/sidebar';
import { CommandPalette } from './CommandPalette';
import {
  currentHref,
  deriveBreadcrumbs,
  getNavigation,
  personalTargets,
  resolveRolePermissions,
  type Crumb,
  type NavTarget,
  type RoleConfiguration,
  type ShellProfile,
} from './navigation';

export function ShellSkeleton() {
  return (
    <div role="status" aria-label="Đang tải ứng dụng" aria-busy="true" className="shell-skeleton">
      <div className="hidden md:block space-y-4 p-4">
        <div className="h-10 rounded bg-(--bg-subtle)" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-(--bg-subtle)" />
        ))}
      </div>
      <div className="p-4 space-y-6">
        <div className="h-12 rounded bg-(--bg-subtle)" />
        <div className="h-64 rounded bg-(--bg-subtle)" />
        <span className="sr-only">Đang tải ứng dụng</span>
      </div>
    </div>
  );
}
export function ShellNavigation({
  targets,
  activeHref,
  onNavigate,
}: {
  targets: NavTarget[];
  activeHref: string;
  onNavigate?: () => void;
}) {
  const groups = Array.from(new Set(targets.map((t) => t.group)));
  return (
    <nav aria-label="Điều hướng chính">
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group} label={group}>
            <SidebarMenu>
              {targets
                .filter((t) => t.group === group)
                .map((target) => (
                  <li key={target.id}>
                    <Link
                      href={target.href}
                      onClick={onNavigate}
                      className="shell-nav-link"
                      aria-label={target.label}
                      title={target.label}
                      aria-current={activeHref === target.href ? 'page' : undefined}
                    >
                      <target.icon size={18} aria-hidden="true" />
                      <span className="shell-nav-label">{target.label}</span>
                    </Link>
                  </li>
                ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        {!targets.length && (
          <p role="status" className="p-3 text-(--text-secondary)">
            Chưa có mục điều hướng. Liên hệ quản trị viên để được cấp quyền.
          </p>
        )}
      </SidebarContent>
    </nav>
  );
}
export function ShellBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Đường dẫn trang" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs.map((crumb, index) => (
          <li
            key={index}
            className={
              'flex min-w-0 items-center gap-2 ' +
              (index < crumbs.length - 1 ? 'hidden sm:flex' : '')
            }
          >
            {index > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0" />}
            {index === crumbs.length - 1 ? (
              <span className="truncate" aria-current="page">
                {crumb.label}
              </span>
            ) : crumb.href ? (
              <Link className="truncate" href={crumb.href}>
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate text-(--text-secondary)">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
function ShellChrome({ targets, children }: { targets: NavTarget[]; children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // Do not stack a new modal over an existing business form.
        if (event.shiftKey || document.querySelector('dialog[open], [role="dialog"]')) return;
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
  return (
    <>
      <a href="#shell-content" className="shell-skip-link">
        Đến nội dung chính
      </a>
      <Sidebar>
        <Link href="/" className="shell-brand" onClick={() => setOpenMobile(false)}>
          <span className="shell-brand-icon" aria-hidden="true">
            S
          </span>
          <span className="shell-nav-label">Ship Dễ</span>
        </Link>
        <ShellNavigation
          targets={targets}
          activeHref={currentHref(pathname, query)}
          onNavigate={() => setOpenMobile(false)}
        />
      </Sidebar>
      <div className="shell-inset">
        <header className="shell-header">
          <SidebarTrigger />
          <ShellBreadcrumbs crumbs={deriveBreadcrumbs(pathname, query, targets)} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="shell-icon-button"
              aria-label="Chuyển đến trang (Ctrl hoặc Command K) ⌘K"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setPaletteOpen(true)}
            >
              <Search size={18} aria-hidden="true" />
              <kbd aria-hidden="true" className="hidden lg:inline text-xs">
                ⌘K
              </kbd>
            </button>
            <details
              className="shell-user-menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary className="shell-icon-button">
                <span className="sr-only">Menu tài khoản</span>
                <span className="shell-avatar">{user?.full_name?.charAt(0) || 'U'}</span>
                <span className="hidden lg:inline max-w-32 truncate">{user?.full_name}</span>
              </summary>
              <div className="shell-user-content">
                <p className="px-3 py-2 font-semibold">{user?.full_name}</p>
                <p className="px-3 pb-2 text-xs text-(--text-secondary)">{user?.role}</p>
                {personalTargets.map((target) => (
                  <Link
                    key={target.href}
                    href={target.href}
                    className="shell-nav-link"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    <target.icon size={16} aria-hidden="true" />
                    {target.label}
                  </Link>
                ))}
                <Link
                  href="/onboarding"
                  className="shell-nav-link"
                  onClick={(event) =>
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }
                >
                  Thiết lập ban đầu
                </Link>
                <button
                  type="button"
                  className="shell-nav-link w-full text-(--status-risk-text)"
                  onClick={logout}
                >
                  <LogOut size={16} aria-hidden="true" />
                  Đăng xuất
                </button>
              </div>
            </details>
          </div>
        </header>
        <div id="shell-content" tabIndex={-1} className="min-w-0">
          {children}
        </div>
      </div>
      {paletteOpen && <CommandPalette targets={targets} onClose={() => setPaletteOpen(false)} />}
    </>
  );
}

export function AppShell({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const { isAuthenticated, isHydrating, token } = useAuth();
  const pathname = usePathname();
  const [navigation, setNavigation] = useState<{
    token: string;
    targets: NavTarget[];
    error?: 'forbidden' | 'error';
    setupOnly?: boolean;
    retrying?: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const publicRoute = [
    '/register',
    '/forgot-password',
    '/reset-password',
    '/invite/accept',
    '/paseo',
  ].some((p) => pathname === p || pathname.startsWith(p + '/'));
  useEffect(() => {
    if (!token || publicRoute) {
      // A sign-out must not leave the previous account's navigation behind.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session transition cleanup
      setNavigation(null);
      return;
    }
    if (!isAuthenticated) {
      // Setup-scoped session (MFA enrollment): live APIs answer 403 until setup completes.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session transition cleanup
      setNavigation({ token, targets: [], setupOnly: true });
      return;
    }
    const abort = new AbortController();
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const load = async () => {
      try {
        const options = { headers: { Authorization: 'Bearer ' + token }, signal: abort.signal };
        const [profileResponse, rolesResponse] = await Promise.all([
          fetch(api + '/api/v1/me', options),
          fetch(api + '/api/v1/roles', options),
        ]);
        if (!profileResponse.ok || !rolesResponse.ok) {
          if (!abort.signal.aborted)
            setNavigation({
              token,
              targets: [],
              error: [profileResponse.status, rolesResponse.status].some(
                (status) => status === 401 || status === 403
              )
                ? 'forbidden'
                : 'error',
            });
          return;
        }
        const profile = (await profileResponse.json()).data as ShellProfile;
        const roles = (await rolesResponse.json()).data.roles as RoleConfiguration[];
        if (!Array.isArray(roles) || !profile?.role) throw new Error('Invalid navigation response');
        if (!abort.signal.aborted)
          setNavigation({ token, targets: getNavigation(resolveRolePermissions(profile, roles)) });
      } catch {
        if (!abort.signal.aborted) setNavigation({ token, targets: [], error: 'error' });
      }
    };
    void load();
    return () => abort.abort();
  }, [isAuthenticated, token, retry, publicRoute]);
  // Wrapping follows the session token, not the user object: the MFA setup-to-full
  // upgrade flips the user mid-flow and must never remount the active page.
  // The console route itself stays unframed until a full session exists so the
  // login/enrollment views keep their chromeless presentation and local state.
  const sessionScoped = pathname === '/' ? isAuthenticated : !!token;
  if (publicRoute || (!isHydrating && !sessionScoped)) return <>{children}</>;
  // While navigation (re)loads the last known navigation stays rendered so the
  // current page and its unsaved state remain mounted.
  if (isHydrating || !navigation) return <ShellSkeleton />;
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ShellChrome targets={navigation.targets}>
        {navigation.error && (
          <section role="alert" className="m-4 modern-card p-4">
            <h1 className="font-semibold">
              {navigation.error === 'forbidden'
                ? 'Bạn không có quyền tải điều hướng (403)'
                : 'Không thể tải điều hướng'}
            </h1>
            <p className="my-2">
              {navigation.error === 'forbidden'
                ? 'Đăng nhập lại hoặc liên hệ quản trị viên. Dữ liệu chưa được thay đổi.'
                : 'Kiểm tra kết nối và thử lại. Dữ liệu chưa được thay đổi.'}
            </p>
            <button
              className="btn-secondary"
              type="button"
              disabled={navigation.retrying}
              onClick={() => {
                // Retain the current page and unsaved form state during a navigation retry.
                setNavigation({ ...navigation, retrying: true });
                setRetry((value) => value + 1);
              }}
            >
              {navigation.retrying ? 'Đang tải…' : 'Thử lại'}
            </button>
          </section>
        )}
        {navigation.setupOnly && (
          <section role="status" className="m-4 modern-card p-4">
            <p className="font-semibold">
              Tài khoản cần hoàn tất thiết lập xác thực hai yếu tố trước khi truy cập ứng dụng.
            </p>
            <Link href="/settings/security" className="btn-secondary mt-2 inline-flex">
              Thiết lập ngay
            </Link>
          </section>
        )}
        {children}
      </ShellChrome>
    </SidebarProvider>
  );
}
