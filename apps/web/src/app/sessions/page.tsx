'use client';

import React, { useState } from 'react';
import { SessionsTab } from '@/components/sessions/SessionsTab';

export default function SessionsPage() {
  const [toast, setToast] = useState<string | null>(null);

  const handleToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-50 relative" data-testid="sessions-page-wrapper">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <SessionsTab onToast={handleToast} />
      </div>

      {toast && (
        <div
          role="status"
          data-testid="session-toast"
          className="fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg transition-opacity text-xs font-medium"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
