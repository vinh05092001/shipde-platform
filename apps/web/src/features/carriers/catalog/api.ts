import {
  CarrierListResponse,
  CarrierDetailResponseEnvelope,
  CanonicalStatusListResponse,
  FeeComponentListResponse,
  CompatibilityMappingListResponse,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('shipde_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error?.message || 'Yêu cầu thất bại') as Error & {
      status: number;
      code?: string;
      correlationId?: string;
      data?: any;
    };
    error.status = res.status;
    error.code = data.error?.code;
    error.correlationId = data.meta?.correlation_id;
    error.data = data;
    throw error;
  }
  return data as T;
}

export async function fetchCarriers(isActive?: boolean): Promise<CarrierListResponse> {
  const url = new URL(`${API_BASE}/api/v1/carrier-catalog/carriers`);
  if (isActive !== undefined) {
    url.searchParams.set('is_active', isActive.toString());
  }
  const res = await fetch(url.toString(), {
    headers: getAuthHeaders(),
  });
  return handleResponse<CarrierListResponse>(res);
}

export async function fetchCarrierDetail(code: string): Promise<CarrierDetailResponseEnvelope> {
  const res = await fetch(
    `${API_BASE}/api/v1/carrier-catalog/carriers/${encodeURIComponent(code)}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse<CarrierDetailResponseEnvelope>(res);
}

export async function fetchStatuses(): Promise<CanonicalStatusListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/carrier-catalog/statuses`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<CanonicalStatusListResponse>(res);
}

export async function fetchFeeComponents(): Promise<FeeComponentListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/carrier-catalog/fee-components`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<FeeComponentListResponse>(res);
}

export async function fetchCompatibility(
  domain?: string,
  carrierCode?: string,
  rawKey?: string
): Promise<CompatibilityMappingListResponse> {
  const url = new URL(`${API_BASE}/api/v1/carrier-catalog/compatibility`);
  if (domain) url.searchParams.set('domain', domain);
  if (carrierCode) url.searchParams.set('carrier_code', carrierCode);
  if (rawKey) url.searchParams.set('raw_key', rawKey);
  const res = await fetch(url.toString(), {
    headers: getAuthHeaders(),
  });
  return handleResponse<CompatibilityMappingListResponse>(res);
}
