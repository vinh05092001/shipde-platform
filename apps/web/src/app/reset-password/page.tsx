'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ResetPasswordView } from '@/components/auth/ResetPasswordView';

export default function ResetPasswordPage() {
  const router = useRouter();

  return (
    <ResetPasswordView
      onBackToLogin={() => {
        router.push('/');
      }}
    />
  );
}
