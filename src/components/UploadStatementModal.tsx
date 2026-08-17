'use client';

import React, { useState } from 'react';
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Money } from './ui/OperationalComponents';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (result: any) => void;
}

export const UploadStatementModal: React.FC<Props> = ({ isOpen, onClose, onUploadComplete }) => {
  const [carrierCode, setCarrierCode] = useState<'GHN' | 'GHTK' | 'VTP'>('GHN');
  const [fileName, setFileName] = useState('sao_ke_ghn_ky_01_08_2026.xlsx');
  const [fileSize, setFileSize] = useState('142 KB');
  const [checksum, setChecksum] = useState('80cff0c5191ac087a3b4c12d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f');
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPLOAD_STATEMENT',
          carrier_code: carrierCode,
          file_name: fileName,
          file_checksum: checksum,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Lỗi nạp sao kê');
      }

      onUploadComplete(data.data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Nạp File Sao Kê Đối Soát (CN-13)</h3>
              <p className="text-[11px] text-slate-500">Đối chiếu tự động 6 phép dò sai lệch cước và tiền thu hộ COD</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Hãng Vận Chuyển Xuất File:</label>
            <select
              value={carrierCode}
              onChange={(e: any) => {
                setCarrierCode(e.target.value);
                setFileName(`sao_ke_${e.target.value.toLowerCase()}_ky_01_08_2026.xlsx`);
              }}
              className="modern-input w-full font-semibold text-xs"
            >
              <option value="GHN">Giao Hàng Nhanh (GHN Express)</option>
              <option value="GHTK">Giao Hàng Tiết Kiệm (GHTK)</option>
              <option value="VTP">Viettel Post (VTP)</option>
            </select>
          </div>

          <div className="p-4 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 flex flex-col items-center justify-center text-center space-y-2">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <span className="font-mono font-bold text-xs text-slate-900 block">{fileName}</span>
              <span className="text-[11px] text-slate-500 font-mono">Dung lượng: {fileSize} · Định dạng Excel .XLSX</span>
            </div>
          </div>

          <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>Khóa chống nạp trùng sao kê (BR-02):</span>
            </div>
            <div className="font-mono text-[10px] text-slate-500 break-all">
              SHA-256 Checksum: {checksum}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="btn-primary text-xs"
            >
              {uploading ? 'Đang phân tích 6 phép dò...' : 'Nạp & Phân Tích Sai Lệch Ngay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
