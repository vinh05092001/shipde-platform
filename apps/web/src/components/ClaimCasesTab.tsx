'use client';

import React, { useState } from 'react';
import { UIClaimItem } from './types';
import { TrackingCode, Money, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import {
  FileText,
  Clock,
  Download,
  Plus,
  Search,
  ShieldCheck,
  AlertTriangle,
  Send,
  Archive,
} from 'lucide-react';

interface Props {
  claims: UIClaimItem[];
  onUpdateClaim: (updated: UIClaimItem) => void;
  selectedClaimId?: string | null;
  selectedClaimCode?: string | null;
  onClearSelection?: () => void;
}

export const ClaimCasesTab: React.FC<Props> = ({
  claims,
  onUpdateClaim,
  selectedClaimId,
  selectedClaimCode,
  onClearSelection,
}) => {
  const [dismissedClaim, setDismissedClaim] = useState(false);
  const [prevSelectedClaimCode, setPrevSelectedClaimCode] = useState(selectedClaimCode);
  const [prevSelectedClaimId, setPrevSelectedClaimId] = useState(selectedClaimId);

  if (prevSelectedClaimCode !== selectedClaimCode || prevSelectedClaimId !== selectedClaimId) {
    setPrevSelectedClaimCode(selectedClaimCode);
    setPrevSelectedClaimId(selectedClaimId);
    setDismissedClaim(false);
  }

  const activeClaimId = dismissedClaim ? null : selectedClaimId;
  const activeClaimCode = dismissedClaim ? null : selectedClaimCode;

  const [userSearchQuery, setUserSearchQuery] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleDownloadProofZip = (claim: UIClaimItem) => {
    setToastMessage(
      `✓ Đang tải gói chứng cứ tự động [claim_${claim.tracking_code}_sha256.zip] gồm: Lịch sử hành trình, ghi âm CSKH, ảnh chụp nhận kho và sao kê (CN-16).`
    );
    setTimeout(() => setToastMessage(null), 4500);
  };

  const handleAcceptClaim = (claim: UIClaimItem) => {
    const updated = {
      ...claim,
      status: 'ACCEPTED' as any,
      accepted_amount: claim.requested_amount,
    };
    onUpdateClaim(updated);
    setToastMessage(
      `✓ Hãng đã chấp thuận bồi thường ${claim.requested_amount.toLocaleString('vi-VN')} đ cho đơn ${claim.tracking_code}.`
    );
    setTimeout(() => setToastMessage(null), 4000);
  };

  const allClaims = [...claims];
  const isClaimActivated = Boolean(activeClaimId || activeClaimCode);
  const matchedClaim = isClaimActivated
    ? allClaims.find(
        (c) =>
          (activeClaimId && c.id === activeClaimId) ||
          (activeClaimCode &&
            (c.tracking_code === activeClaimCode || c.carrier_ticket === activeClaimCode))
      )
    : null;
  const isClaimNotFound = isClaimActivated && !matchedClaim;

  const effectiveQuery = userSearchQuery ?? (activeClaimCode || '');
  const setSearchQuery = (term: string) => setUserSearchQuery(term);

  const handleClearClaimSelection = () => {
    setDismissedClaim(true);
    setUserSearchQuery('');
    onClearSelection?.();
  };

  const filteredClaims = allClaims.filter(
    (c) =>
      c.tracking_code.toLowerCase().includes(effectiveQuery.toLowerCase()) ||
      (c.carrier_ticket && c.carrier_ticket.toLowerCase().includes(effectiveQuery.toLowerCase()))
  );

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toastMessage}</span>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Activated Claim Not Found Alert (Real Not-Found State with Recovery) */}
      {isClaimNotFound && (
        <div
          data-testid="activated-claim-not-found"
          className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <div className="font-bold text-xs sm:text-sm">
                Không tìm thấy hồ sơ khiếu nại{' '}
                <span className="font-mono underline">{selectedClaimCode || selectedClaimId}</span>
              </div>
              <div className="text-xs text-amber-700">
                Hồ sơ không tồn tại trong danh sách khiếu nại hiện tại hoặc nằm ngoài phạm vi truy
                cập của bạn.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearClaimSelection}
              className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 rounded-lg text-xs font-semibold hover:bg-amber-100 transition"
            >
              Quay lại danh sách
            </button>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Quản Lý Hồ Sơ Khiếu Nại Hãng (CN-16 · CN-17)
            </h2>
            <span className="badge-ok text-xs">Thời Hiệu BR-37</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tự động tập hợp chứng cứ và giám sát hạn chót khiếu nại trước thời hiệu 48 giờ để không
            bị mất quyền đòi tiền
          </p>
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={effectiveQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo mã vận đơn hoặc ticket..."
            className="modern-input pl-9 w-full text-xs"
          />
        </div>
      </div>

      {/* Main Claims Table */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Mã Vận Đơn</th>
                <th>Mã Ticket Hãng</th>
                <th>Loại Khiếu Nại</th>
                <th className="text-right">Tiền Yêu Cầu</th>
                <th className="text-right">Hãng Chấp Thuận</th>
                <th>Thời Hiệu Còn Lại (BR-37)</th>
                <th>Trạng Thái</th>
                <th className="text-right">Thao Tác Chứng Cứ</th>
              </tr>
            </thead>
            <tbody>
              {filteredClaims.map((c) => {
                const isUrgent = c.hours_left <= 48 && c.status !== 'CLOSED';
                const isSelected = Boolean(
                  matchedClaim &&
                  ((activeClaimId && c.id === activeClaimId) ||
                    (activeClaimCode &&
                      (c.tracking_code === activeClaimCode ||
                        c.carrier_ticket === activeClaimCode)))
                );
                const selectedKey = activeClaimId || activeClaimCode;
                return (
                  <tr
                    key={c.id}
                    data-selected={isSelected ? 'true' : undefined}
                    data-testid={isSelected ? `selected-claim-${selectedKey}` : undefined}
                    className={
                      isSelected ? 'bg-orange-50/70 border-l-4 border-l-[#c23807]' : undefined
                    }
                  >
                    <td>
                      <TrackingCode code={c.tracking_code} />
                    </td>
                    <td className="font-mono text-xs font-semibold text-slate-700">
                      {c.carrier_ticket || 'Chờ sinh ticket'}
                    </td>
                    <td>
                      <span className="text-xs font-medium text-slate-800">
                        {c.claim_type === 'FEE'
                          ? 'Lệch cước hợp đồng'
                          : c.claim_type === 'DAMAGED'
                            ? 'Hàng hoàn hư hỏng'
                            : c.claim_type === 'LOST'
                              ? 'Thất lạc kiện'
                              : 'Lệch COD'}
                      </span>
                    </td>
                    <td className="text-right font-bold text-xs">
                      <Money amount={c.requested_amount} state="confirmed" />
                    </td>
                    <td className="text-right text-xs">
                      <Money amount={c.accepted_amount} state="pending" />
                    </td>
                    <td>
                      <span
                        className={
                          isUrgent
                            ? 'badge-risk font-mono font-bold text-[10px]'
                            : 'badge-muted font-mono text-[10px]'
                        }
                      >
                        {isUrgent ? `CÒN ${c.hours_left}H (!)` : `Còn ${c.hours_left}h`}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDownloadProofZip(c)}
                          className="btn-secondary text-[11px] py-1"
                          title="Tải gói file ZIP bằng chứng SHA-256 (CN-16)"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải ZIP</span>
                        </button>

                        {c.status === 'SUBMITTED' && (
                          <button
                            type="button"
                            onClick={() => handleAcceptClaim(c)}
                            className="btn-primary text-[11px] py-1 bg-emerald-600 hover:bg-emerald-700 border-emerald-700"
                          >
                            Hãng chấp thuận
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
