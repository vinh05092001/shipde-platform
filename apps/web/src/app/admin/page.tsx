'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ShieldAlert, ArrowRight, Store } from 'lucide-react';

export default function AdminPage() {
  const router = useRouter();
  const { user, isAuthenticated, isHydrating } = useAuth();

  const isPlatformAdmin = Boolean(
    user &&
    ((user.role as string) === 'BACKOFFICE' ||
      (user.role as string) === 'PLATFORM_ADMIN' ||
      (user.role as string) === 'ADMIN')
  );

  useEffect(() => {
    if (isAuthenticated && user && isPlatformAdmin) {
      router.replace('/admin/shops');
    }
  }, [isAuthenticated, user, isPlatformAdmin, router]);

  // AC-ADMIN-15: Signed-out or unauthorized users reach forbidden state immediately on first paint
  if (!isAuthenticated || !user || !isPlatformAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div
          data-testid="state-forbidden"
          className="max-w-md w-full bg-white rounded-xl shadow-lg border border-red-200 p-8 text-center"
        >
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            Truy cập bị từ chối (403 Forbidden)
          </h1>
          <p className="text-slate-600 text-sm mb-6 leading-relaxed">
            Bạn cần đăng nhập với quyền Quản trị viên (Operator) để truy cập Admin Console.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors text-sm"
          >
            Đăng nhập ngay
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-spin">
          <Store className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-slate-600">
          Đang chuyển hướng tới Quản lý Cửa hàng...
        </p>
      </div>
    </div>
  );
}
