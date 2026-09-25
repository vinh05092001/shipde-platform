'use client';

import React from 'react';
import { SessionsTab } from '@/components/sessions/SessionsTab';

export default function SessionsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <SessionsTab />
      </div>
    </div>
  );
}
