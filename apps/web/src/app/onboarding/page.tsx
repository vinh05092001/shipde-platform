'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { useAuth } from '@/context/AuthContext';
import { OnboardingStepId, type OnboardingStateResponseDto } from '@shipde/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface OnboardingPageProps {
  initialState?: OnboardingStateResponseDto | null;
  initialLoading?: boolean;
  initialCanEdit?: boolean;
  initialError?: string | null;
  initialToken?: string | null;
}

export default function OnboardingPage({
  initialState = null,
  initialLoading = false,
  initialCanEdit,
  initialError = null,
  initialToken = null,
}: OnboardingPageProps) {
  const { user } = useAuth();
  const token =
    initialToken !== null
      ? initialToken
      : typeof window !== 'undefined'
        ? localStorage.getItem('shipde_token')
        : null;

  const [state, setState] = useState<OnboardingStateResponseDto | null>(initialState);
  const [loading, setLoading] = useState<boolean>(initialState ? false : (initialLoading ?? true));
  const [error, setError] = useState<string | null>(initialError);

  const fetchOnboardingState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/onboarding`, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Bạn không có quyền truy cập quy trình thiết lập của cửa hàng.');
        }
        if (res.status === 401) {
          throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson?.error?.message || errJson?.message || 'Không thể tải quy trình thiết lập'
        );
      }

      const json = await res.json();
      if (json.success && json.data) {
        setState(json.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải thông tin thiết lập ban đầu');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial onboarding state fetch
      void fetchOnboardingState();
    }
  }, [initialState, fetchOnboardingState]);

  const handleCompleteStep = async (stepId: OnboardingStepId, data?: Record<string, any>) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/onboarding/steps/${stepId}/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(
        errJson?.error?.message || errJson?.message || `Không thể hoàn thành bước ${stepId}`
      );
    }

    const json = await res.json();
    if (json.success && json.data) {
      setState(json.data);
    }
  };

  const handleSkipStep = async (stepId: OnboardingStepId) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/onboarding/steps/${stepId}/skip`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(
        errJson?.error?.message || errJson?.message || `Không thể bỏ qua bước ${stepId}`
      );
    }

    const json = await res.json();
    if (json.success && json.data) {
      setState(json.data);
    }
  };

  const handleReset = async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/onboarding/reset`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(
        errJson?.error?.message || errJson?.message || 'Không thể khởi tạo lại quy trình'
      );
    }

    const json = await res.json();
    if (json.success && json.data) {
      setState(json.data);
    }
  };

  const handleDismiss = async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/v1/onboarding/dismiss`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(
        errJson?.error?.message || errJson?.message || 'Không thể đóng hướng dẫn thiết lập'
      );
    }

    const json = await res.json();
    if (json.success && json.data) {
      setState(json.data);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại Bảng Điều Khiển</span>
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-bold text-slate-700">Thiết Lập Ban Đầu (SCR-ONB-01)</span>
        </div>

        {/* Main Flow Component */}
        <OnboardingFlow
          initialState={state}
          initialLoading={loading}
          initialError={error}
          initialCanEdit={initialCanEdit}
          onRefresh={fetchOnboardingState}
          onCompleteStep={handleCompleteStep}
          onSkipStep={handleSkipStep}
          onReset={handleReset}
          onDismiss={handleDismiss}
        />
      </div>
    </div>
  );
}
