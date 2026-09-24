'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import LoginView from '@/components/auth/LoginView';

export default function LoginPage() {
  const router = useRouter();

  return (
    <LoginView
      onSwitchToRegister={() => {
        router.push('/register');
      }}
    />
  );
}
