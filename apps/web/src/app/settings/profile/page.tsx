'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProfileSettingsTab } from '@/components/ProfileSettingsTab';

export default function ProfileSettingsPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
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
          <span className="text-xs font-bold text-slate-700">Hồ sơ cá nhân & Cài đặt</span>
        </div>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Hồ sơ cá nhân</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý thông tin liên hệ, ngôn ngữ, múi giờ và các kênh thông báo vận hành của bạn.
          </p>
        </div>

        {/* Page Content */}
        <ProfileSettingsTab />
      </div>
    </div>
  );
}
