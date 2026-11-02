/**
 * Adapted from shadcn/ui sidebar (MIT, Copyright (c) 2023 shadcn).
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
 * Retains provider, icon collapse, cookie and mobile sheet patterns; only needed primitives.
 * MIT permission notice: ../shell/REFERENCE-LICENSE.md.
 */
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { Sheet } from './sheet';

const SidebarContext = createContext<{
  open: boolean;
  openMobile: boolean;
  isMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
} | null>(null);
export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider');
  return context;
}
export function SidebarProvider({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsMobile(media.matches);
      setOpenMobile(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const toggleSidebar = () => {
    if (isMobile) {
      setOpenMobile(!openMobile);
      return;
    }
    const next = !open;
    setOpen(next);
    document.cookie =
      'sidebar_state=' +
      next +
      '; path=/; max-age=604800; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  };
  return (
    <SidebarContext.Provider value={{ open, openMobile, isMobile, setOpenMobile, toggleSidebar }}>
      <div className="shell-frame" data-state={open ? 'expanded' : 'collapsed'}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}
export function Sidebar({ children }: { children: React.ReactNode }) {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <aside className="shell-sidebar" aria-label="Điều hướng ứng dụng">
        {children}
      </aside>
      <Sheet open={openMobile} onOpenChange={setOpenMobile} title="Điều hướng ứng dụng">
        <div className="shell-mobile-nav">{children}</div>
      </Sheet>
    </>
  );
}
export function SidebarTrigger() {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      className="shell-icon-button"
      aria-label={isMobile ? 'Mở điều hướng' : 'Thu gọn hoặc mở rộng điều hướng'}
      aria-expanded={isMobile ? openMobile : open}
      onClick={toggleSidebar}
    >
      <PanelLeft size={20} aria-hidden="true" />
    </button>
  );
}
export function SidebarContent({ children }: { children: React.ReactNode }) {
  return (
    <div data-sidebar="content" className="shell-sidebar-content">
      {children}
    </div>
  );
}
export function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section data-sidebar="group" aria-label={label}>
      <h2 className="shell-group-label">{label}</h2>
      {children}
    </section>
  );
}
export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return (
    <ul data-sidebar="menu" className="space-y-1">
      {children}
    </ul>
  );
}
