'use client';

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { ResetPasswordView } from '@/components/auth/ResetPasswordView';

/**
 * ResetPasswordView reads the token from the query string with
 * useSearchParams(), which Next cannot resolve while prerendering: the build
 * failed with "useSearchParams() should be wrapped in a suspense boundary" and
 * refused to export this route at all. The boundary is what lets the page be
 * prerendered and then filled in on the client once the URL is known.
 *
 * The fallback is the same "verifying" state the view itself shows first, so a
 * visitor sees one continuous message rather than a blank frame that swaps.
 */
function ResetPasswordFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm font-medium text-gray-500">Đang kiểm tra liên kết đặt lại mật khẩu…</p>
    </div>
  );
}

function ResetPasswordContent() {
  const router = useRouter();

  return (
    <ResetPasswordView
      onBackToLogin={() => {
        router.push('/');
      }}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
