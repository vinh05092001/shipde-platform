'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AdminCreateShopView } from '@/components/auth/AdminCreateShopView';

export default function AdminCreateShopPage() {
  const router = useRouter();

  return (
    <AdminCreateShopView
      onBack={() => {
        router.push('/');
      }}
    />
  );
}