/**
 * Reusable Data Table & Dashboard Shell — Test Fixture Data.
 *
 * NOTE: All data in this module is mock fixture data for demonstration and testing.
 * Complies with BR-UI-05 (Fixture Isolation) and AGENTS.md.
 */

import { DataTableFilterOption } from '@/components/data-table';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
} from 'lucide-react';

export interface FixtureShipment {
  id: string;
  trackingCode: string;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  carrier: 'GHN' | 'GHTK' | 'VTP';
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CLAIM_PENDING';
  codAmount: number;
  feeAmount: number;
  weightGrams: number;
  createdAt: string;
}

export const FIXTURE_SHIPMENTS: FixtureShipment[] = [
  {
    id: 'fix-ord-001',
    trackingCode: 'GHN982341201VN',
    orderNumber: 'ORD-20261031-01',
    recipientName: 'Nguyễn Văn An',
    recipientPhone: '0901***123',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 350000,
    feeAmount: 22000,
    weightGrams: 500,
    createdAt: '2026-10-31 08:30:00',
  },
  {
    id: 'fix-ord-002',
    trackingCode: 'GHTK74219082VN',
    orderNumber: 'ORD-20261031-02',
    recipientName: 'Trần Thị Mai',
    recipientPhone: '0912***456',
    carrier: 'GHTK',
    status: 'IN_TRANSIT',
    codAmount: 520000,
    feeAmount: 32000,
    weightGrams: 1200,
    createdAt: '2026-10-31 09:15:00',
  },
  {
    id: 'fix-ord-003',
    trackingCode: 'VTP391204851VN',
    orderNumber: 'ORD-20261031-03',
    recipientName: 'Lê Hoàng Nam',
    recipientPhone: '0983***789',
    carrier: 'VTP',
    status: 'PENDING',
    codAmount: 180000,
    feeAmount: 18000,
    weightGrams: 300,
    createdAt: '2026-10-31 10:00:00',
  },
  {
    id: 'fix-ord-004',
    trackingCode: 'GHN512938472VN',
    orderNumber: 'ORD-20261031-04',
    recipientName: 'Phạm Minh Đức',
    recipientPhone: '0934***321',
    carrier: 'GHN',
    status: 'FAILED',
    codAmount: 490000,
    feeAmount: 25000,
    weightGrams: 800,
    createdAt: '2026-10-30 14:20:00',
  },
  {
    id: 'fix-ord-005',
    trackingCode: 'GHTK12948293VN',
    orderNumber: 'ORD-20261031-05',
    recipientName: 'Hoàng Bích Thủy',
    recipientPhone: '0977***654',
    carrier: 'GHTK',
    status: 'CLAIM_PENDING',
    codAmount: 890000,
    feeAmount: 45000,
    weightGrams: 2100,
    createdAt: '2026-10-30 16:45:00',
  },
  {
    id: 'fix-ord-006',
    trackingCode: 'GHN672391024VN',
    orderNumber: 'ORD-20261031-06',
    recipientName: 'Đặng Quốc Huy',
    recipientPhone: '0909***999',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 240000,
    feeAmount: 20000,
    weightGrams: 400,
    createdAt: '2026-10-30 17:10:00',
  },
  {
    id: 'fix-ord-007',
    trackingCode: 'VTP839102948VN',
    orderNumber: 'ORD-20261031-07',
    recipientName: 'Vũ Thanh Hằng',
    recipientPhone: '0945***888',
    carrier: 'VTP',
    status: 'IN_TRANSIT',
    codAmount: 670000,
    feeAmount: 28000,
    weightGrams: 1000,
    createdAt: '2026-10-29 11:30:00',
  },
  {
    id: 'fix-ord-008',
    trackingCode: 'GHTK90283741VN',
    orderNumber: 'ORD-20261031-08',
    recipientName: 'Bùi Anh Tuấn',
    recipientPhone: '0966***777',
    carrier: 'GHTK',
    status: 'DELIVERED',
    codAmount: 410000,
    feeAmount: 24000,
    weightGrams: 600,
    createdAt: '2026-10-29 15:00:00',
  },
];

export const STATUS_OPTIONS: DataTableFilterOption[] = [
  { label: 'Chờ lấy hàng', value: 'PENDING', icon: Clock, count: 1 },
  { label: 'Đang giao', value: 'IN_TRANSIT', icon: Truck, count: 2 },
  { label: 'Giao thành công', value: 'DELIVERED', icon: CheckCircle2, count: 3 },
  { label: 'Giao thất bại', value: 'FAILED', icon: XCircle, count: 1 },
  { label: 'Chờ bồi thường', value: 'CLAIM_PENDING', icon: AlertCircle, count: 1 },
];

export const CARRIER_OPTIONS: DataTableFilterOption[] = [
  { label: 'Giao Hàng Nhanh (GHN)', value: 'GHN', count: 3 },
  { label: 'Giao Hàng Tiết Kiệm (GHTK)', value: 'GHTK', count: 3 },
  { label: 'Viettel Post (VTP)', value: 'VTP', count: 2 },
];
