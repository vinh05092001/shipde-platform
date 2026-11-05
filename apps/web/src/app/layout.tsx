import type { Metadata } from 'next';
import './globals.css';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { AppShell, ShellSkeleton } from '@/components/shell/AppShell';

export const metadata: Metadata = {
  title: 'Ship Dễ — Nền Tảng Điều Hành & Kiểm Soát Vận Chuyển',
  description: 'Kiểm soát cước phí, đối soát COD và cứu đơn giao thất bại cho Shop Online',
};

import { AuthProvider } from '@/context/AuthContext';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';
  return (
    <html lang="vi">
      <body className="antialiased">
        <NuqsAdapter>
          <AuthProvider>
            <Suspense fallback={<ShellSkeleton />}>
              <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
            </Suspense>
          </AuthProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
