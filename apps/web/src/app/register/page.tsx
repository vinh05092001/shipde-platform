'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { RegisterView } from '@/components/auth/RegisterView';

export default function RegisterPage() {
  const router = useRouter();

  return (
    <RegisterView
      onSwitchToLogin={() => {
        router.push('/');
      }}
    />
  );
}
