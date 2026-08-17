import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ship Dễ — Nền Tảng Điều Hành & Kiểm Soát Vận Chuyển',
  description: 'Kiểm soát cước phí, đối soát COD và cứu đơn giao thất bại cho Shop Online',
};

import { AuthProvider } from '@/context/AuthContext';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
