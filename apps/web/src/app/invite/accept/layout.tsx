import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  other: {
    'Cache-Control': 'no-store',
  },
};

export default function AcceptInviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
