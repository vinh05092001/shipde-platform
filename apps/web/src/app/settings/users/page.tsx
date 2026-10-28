'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Users, Shield } from 'lucide-react';
import { UserManagementTab } from '@/components/UserManagementTab';

export default function UsersSettingsPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại Bảng Điều Khiển</span>
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-bold text-slate-700">Cài đặt Cửa hàng & Phân quyền</span>
        </div>

        {/* Page Content */}
        <UserManagementTab />
      </div>
    </div>
  );
}
