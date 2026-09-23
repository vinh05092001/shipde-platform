'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ForgotPasswordView } from '@/components/auth/ForgotPasswordView';

export default function ForgotPasswordPage() {
  const router = useRouter();

  return (
    <ForgotPasswordView
      onBackToLogin={() => {
        router.push('/');
      }}
    />
  );
}
