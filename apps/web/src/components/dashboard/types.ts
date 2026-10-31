/**
 * Ported from Kiranism/next-shadcn-dashboard-starter (MIT License)
 * Source: https://github.com/Kiranism/next-shadcn-dashboard-starter
 * License: MIT
 *
 * Types for Dashboard Shell, Sidebar, Navigation, and Header.
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  active?: boolean;
}

export interface NavItem {
  title: string;
  href: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeVariant?: 'default' | 'warn' | 'risk' | 'ok';
  disabled?: boolean;
  external?: boolean;
  children?: NavItem[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export interface DashboardUser {
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  shopName?: string;
}

export interface DashboardLayoutProps {
  children: React.ReactNode;
  navSections?: NavSection[];
  currentUser?: DashboardUser;
  breadcrumbs?: BreadcrumbItem[];
  shopName?: string;
  onSignOut?: () => void;
  headerActions?: React.ReactNode;
}
