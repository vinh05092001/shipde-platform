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
 */

import {
  LayoutDashboard,
  Package,
  Truck,
  AlertTriangle,
  FileSpreadsheet,
  ShieldCheck,
  Building2,
  Users,
  Settings,
} from 'lucide-react';
import type { NavSection } from './types';

export const DEFAULT_NAV_SECTIONS: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      {
        title: 'Bàn làm việc (Dashboard)',
        href: '/',
        icon: LayoutDashboard,
        permissions: [
          'order:view_create',
          'reconciliation:run_review_audit',
          'shipment:track_exceptions',
        ],
      },
    ],
  },
  {
    title: 'ĐIỀU HÀNH & VẬN ĐƠN',
    items: [
      {
        title: 'Quản lý vận đơn',
        href: '/shipments',
        icon: Package,
        permissions: ['order:view_create', 'shipment:track_exceptions'],
      },
      {
        title: 'Kết nối hãng vận chuyển',
        href: '/carriers',
        icon: Truck,
        permissions: ['iam:connect_observe_token'],
      },
      {
        title: 'Cứu đơn giao thất bại',
        href: '/exceptions',
        icon: AlertTriangle,
        permissions: ['shipment:track_exceptions'],
      },
    ],
  },
  {
    title: 'ĐỐI SOÁT & TÀI CHÍNH',
    items: [
      {
        title: 'Bảng kê & Đối soát',
        href: '/reconciliation',
        icon: FileSpreadsheet,
        permissions: ['reconciliation:run_review_audit'],
      },
      {
        title: 'Hồ sơ khiếu nại',
        href: '/claims',
        icon: ShieldCheck,
        permissions: ['claim:verify_submit'],
      },
    ],
  },
  {
    title: 'HỆ THỐNG & CÀI ĐẶT',
    items: [
      {
        title: 'Chi nhánh & Kho hàng',
        href: '/settings/warehouses',
        icon: Building2,
        permissions: ['iam:shop_view', 'iam:shop_config'],
      },
      {
        title: 'Phân quyền & Thành viên',
        href: '/settings/users',
        icon: Users,
        permissions: ['iam:manage_users'],
      },
      {
        title: 'Cài đặt hệ thống',
        href: '/settings',
        icon: Settings,
        permissions: ['iam:shop_config'],
      },
    ],
  },
];
