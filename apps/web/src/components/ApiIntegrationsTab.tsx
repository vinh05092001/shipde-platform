'use client';

import React, { useState } from 'react';
import {
  Key,
  Database,
  Truck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Send,
  Sliders,
  Radio,
  Lock,
  Plus,
  ShieldCheck,
  Eye,
  EyeOff,
  Scale,
  Copy,
  Check,
  Activity,
  Terminal,
  ShoppingBag,
  Webhook,
  Code2,
  Sparkles,
  Zap,
  Globe,
  Layers,
  ArrowRight,
  Play,
} from 'lucide-react';
import { AutomationBadge, Money } from './ui/OperationalComponents';

interface Props {
  carrierGhnTier?: 'L2' | 'L1';
  onToggleGhnTier?: (tier: 'L2' | 'L1') => void;
}

export const ApiIntegrationsTab: React.FC<Props> = ({ carrierGhnTier = 'L2', onToggleGhnTier }) => {
  const [activeSubTab, setActiveSubTab] = useState<
    'carriers' | 'pos' | 'webhooks' | 'logs' | 'rates'
  >('carriers');

  // Carrier API Credentials
  const [ghnToken, setGhnToken] = useState('tok_ghn_live_sec_991823901842');
  const [ghnShopId, setGhnShopId] = useState('189201');
  const [ghnClientId, setGhnClientId] = useState('554109');
  const [showGhnToken, setShowGhnToken] = useState(false);

  const [ghtkToken, setGhtkToken] = useState('tok_ghtk_live_partner_448102394');
  const [ghtkPartnerId, setGhtkPartnerId] = useState('PARTNER_ANAN_VN');
  const [showGhtkToken, setShowGhtkToken] = useState(false);

  const [vtpToken, setVtpToken] = useState('tok_vtp_v2_9981240182');
  const [vtpCustomerCode, setVtpCustomerCode] = useState('VTP_CUST_ANAN_88');
  const [showVtpToken, setShowVtpToken] = useState(false);

  const [jtToken, setJtToken] = useState('tok_jt_express_sec_771203');
  const [jtCustId, setJtCustId] = useState('JT_VN_9921');
  const [showJtToken, setShowJtToken] = useState(false);

  // POS / E-commerce Channels Credentials
  const [pancakeApiKey, setPancakeApiKey] = useState('pk_live_pancake_pos_88291039');
  const [pancakeShopId, setPancakeShopId] = useState('shop_anan_9901');

  const [kiotApiKey, setKiotApiKey] = useState('kiot_live_sec_8819230192');
  const [kiotRetailer, setKiotRetailer] = useState('anan_boutique_hcm');

  const [tiktokAppKey, setTiktokAppKey] = useState('tt_shop_open_app_99182');
  const [tiktokCipher, setTiktokCipher] = useState('cipher_vn_live_sec_771');

  // Webhook Simulator State
  const [simCarrier, setSimCarrier] = useState('GHN');
  const [simTracking, setSimTracking] = useState('GHN88291042');
  const [simEvent, setSimEvent] = useState('DELIVERY_FAIL');
  const [simReason, setSimReason] = useState('Khách không nghe máy lần 1');
  const [simResponse, setSimResponse] = useState<string | null>(null);

  // Realtime Live Logs
  const [liveLogs, setLiveLogs] = useState([
    {
      id: 'log_1',
      time: '10:22:15',
      source: 'GHN Open API',
      event: 'ORDER_STATUS_CHANGED',
      tracking: 'GHN88291042',
      status: 200,
      duration: '42ms',
      signature: 'Valid (SHA-256 HMAC)',
    },
    {
      id: 'log_2',
      time: '10:20:04',
      source: 'Pancake POS',
      event: 'SYNC_NEW_ORDERS',
      tracking: 'ORD_ANAN_104',
      status: 200,
      duration: '115ms',
      signature: 'Valid',
    },
    {
      id: 'log_3',
      time: '10:15:48',
      source: 'GHTK Partner',
      event: 'WEBHOOK_DELIVERY_UPDATE',
      tracking: 'GHTK77129031',
      status: 200,
      duration: '58ms',
      signature: 'Valid',
    },
    {
      id: 'log_4',
      time: '10:08:12',
      source: 'Viettel Post',
      event: 'TRACKING_PING',
      tracking: 'VTP99812401',
      status: 200,
      duration: '65ms',
      signature: 'Valid',
    },
  ]);

  // Rate Cards
  const [rateCards, setRateCards] = useState([
    {
      id: 'rc_ghn',
      carrier: 'GHN Express',
      tier: 'Hợp Đồng VIP 2026',
      intraFee: 22000,
      interFee: 32000,
      addKgFee: 5000,
      status: 'ACTIVE',
    },
    {
      id: 'rc_ghtk',
      carrier: 'GHTK',
      tier: 'Hợp Đồng Chuẩn 2026',
      intraFee: 24000,
      interFee: 34000,
      addKgFee: 6000,
      status: 'ACTIVE',
    },
    {
      id: 'rc_vtp',
      carrier: 'Viettel Post',
      tier: 'Hợp Đồng Thương Mại 2026',
      intraFee: 21500,
      interFee: 31000,
      addKgFee: 4500,
      status: 'ACTIVE',
    },
  ]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleFireWebhookTest = () => {
    const newLog = {
      id: `log_${Date.now()}`,
      time: new Date().toLocaleTimeString('vi-VN'),
      source: `${simCarrier} Webhook`,
      event: simEvent,
      tracking: simTracking,
      status: 200,
      duration: '35ms',
      signature: 'Valid (SHA-256 HMAC)',
    };

    setLiveLogs((prev) => [newLog, ...prev]);
    setSimResponse(
      JSON.stringify(
        {
          status: 'success',
          http_code: 200,
          received_event: simEvent,
          tracking_code: simTracking,
          signature_verified: true,
          processed_at: new Date().toISOString(),
          message: `Đã tiếp nhận webhook từ ${simCarrier}. Hệ thống đã cập nhật trạng thái đơn hàng & ghi nhật ký audit.`,
        },
        null,
        2
      )
    );
    showToast(
      `✓ [Webhook Simulator] Đã bắn thử nghiệm thành công sự kiện [${simEvent}] cho mã ${simTracking} (HTTP 200 OK).`
    );
  };

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toastMessage}</span>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-600" />
              Trung Tâm Khai Báo API, Đa Hãng Vận Chuyển & Webhooks (CN-01..CN-23)
            </h2>
            <span className="badge-ok text-xs">Multi-Carrier Hub</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Hỗ trợ kết nối toàn diện: GHN, GHTK, Viettel Post, J&T, VNPost, Pancake POS, KiotViet,
            TikTok Shop, Haravan, Sapo & Webhook Simulator
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Mã hóa AES-256 GCM & HMAC SHA-256</span>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-slate-200 bg-white px-2 rounded-xl border text-xs font-semibold gap-1 p-1 overflow-x-auto custom-scrollbar">
        {[
          {
            id: 'carriers',
            label: '1. Hãng Vận Chuyển (GHN, GHTK, VTP, J&T, VNPost)',
            icon: Truck,
          },
          {
            id: 'pos',
            label: '2. Nguồn Đơn POS & Sàn TMĐT (Pancake, KiotViet, TikTok, Haravan)',
            icon: ShoppingBag,
          },
          { id: 'webhooks', label: '3. Quản Lý Webhooks & Trình Bắn Test Giả Lập', icon: Webhook },
          { id: 'logs', label: '4. Nhật Ký Webhook & API Calls Thời Gian Thực', icon: Terminal },
          { id: 'rates', label: '5. Cài Đặt Biểu Giá Cước Hợp Đồng (BR-51)', icon: Scale },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveSubTab(t.id as any)}
              className={`py-2 px-3.5 rounded-lg transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === t.id
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: CARRIERS (GHN, GHTK, VIETTEL POST, J&T, VNPOST) */}
      {activeSubTab === 'carriers' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* GHN */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-orange-500">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">
                    Giao Hàng Nhanh (GHN Express)
                  </h4>
                  <AutomationBadge tier={carrierGhnTier} carrierCode="GHN" />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Open API v2 · Tự động gọi API thực thi cứu đơn L2
                </p>
              </div>
              <span className="badge-ok text-[11px]">Đang hoạt động</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  API Token Hãng (Secret):
                </label>
                <div className="relative">
                  <input
                    type={showGhnToken ? 'text' : 'password'}
                    value={ghnToken}
                    onChange={(e) => setGhnToken(e.target.value)}
                    className="modern-input w-full font-mono pr-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGhnToken(!showGhnToken)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showGhnToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Shop ID:</label>
                  <input
                    type="text"
                    value={ghnShopId}
                    onChange={(e) => setGhnShopId(e.target.value)}
                    className="modern-input w-full font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Client ID:</label>
                  <input
                    type="text"
                    value={ghnClientId}
                    onChange={(e) => setGhnClientId(e.target.value)}
                    className="modern-input w-full font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Webhook URL Endpoint:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value="https://api.shipde.net/v1/webhooks/ghn/wh_anan_99"
                    className="modern-input w-full font-mono text-[11px] bg-slate-50 text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard('https://api.shipde.net/v1/webhooks/ghn/wh_anan_99', 'ghn')
                    }
                    className="btn-secondary px-2 text-xs"
                  >
                    {copiedUrl === 'ghn' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() =>
                    onToggleGhnTier && onToggleGhnTier(carrierGhnTier === 'L2' ? 'L1' : 'L2')
                  }
                  className="btn-secondary text-[11px] py-1 text-slate-600"
                >
                  <Sliders className="w-3 h-3" />
                  <span>{carrierGhnTier === 'L2' ? 'Hạ cấp xuống L1' : 'Nâng lên L2 API'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => showToast('✓ [GHN Express] Kết nối API thành công (Ping: 42ms).')}
                  className="btn-primary text-xs"
                >
                  Ping Test & Lưu GHN
                </button>
              </div>
            </div>
          </div>

          {/* GHTK */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-emerald-600">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">Giao Hàng Tiết Kiệm (GHTK)</h4>
                  <AutomationBadge tier="L1" carrierCode="GHTK" />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Partner Token · Chế độ tạo hồ sơ dán cổng L1 Assist
                </p>
              </div>
              <span className="badge-ok text-[11px]">Đang hoạt động</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Partner Token GHTK:
                </label>
                <div className="relative">
                  <input
                    type={showGhtkToken ? 'text' : 'password'}
                    value={ghtkToken}
                    onChange={(e) => setGhtkToken(e.target.value)}
                    className="modern-input w-full font-mono pr-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGhtkToken(!showGhtkToken)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showGhtkToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Partner ID / Client Key:
                </label>
                <input
                  type="text"
                  value={ghtkPartnerId}
                  onChange={(e) => setGhtkPartnerId(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Webhook URL Endpoint:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value="https://api.shipde.net/v1/webhooks/ghtk/wh_anan_99"
                    className="modern-input w-full font-mono text-[11px] bg-slate-50 text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard('https://api.shipde.net/v1/webhooks/ghtk/wh_anan_99', 'ghtk')
                    }
                    className="btn-secondary px-2 text-xs"
                  >
                    {copiedUrl === 'ghtk' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400 italic">
                  * L1 Assist theo Catalog Trang 8
                </span>
                <button
                  type="button"
                  onClick={() => showToast('✓ [GHTK Partner] Kết nối thành công (Ping: 65ms).')}
                  className="btn-primary text-xs"
                >
                  Ping Test & Lưu GHTK
                </button>
              </div>
            </div>
          </div>

          {/* VIETTEL POST */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-red-600">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">Viettel Post (VTP)</h4>
                  <AutomationBadge tier="L2" carrierCode="VTP" />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Open API v2 · Tự động đọc cước & webhook hành trình
                </p>
              </div>
              <span className="badge-ok text-[11px]">Đã kết nối</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Viettel Post Access Token:
                </label>
                <div className="relative">
                  <input
                    type={showVtpToken ? 'text' : 'password'}
                    value={vtpToken}
                    onChange={(e) => setVtpToken(e.target.value)}
                    className="modern-input w-full font-mono pr-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVtpToken(!showVtpToken)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showVtpToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Customer Code / Mã Khách Hàng:
                </label>
                <input
                  type="text"
                  value={vtpCustomerCode}
                  onChange={(e) => setVtpCustomerCode(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Webhook URL Endpoint:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value="https://api.shipde.net/v1/webhooks/viettelpost/wh_anan_99"
                    className="modern-input w-full font-mono text-[11px] bg-slate-50 text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        'https://api.shipde.net/v1/webhooks/viettelpost/wh_anan_99',
                        'vtp'
                      )
                    }
                    className="btn-secondary px-2 text-xs"
                  >
                    {copiedUrl === 'vtp' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => showToast('✓ [Viettel Post] Kết nối API thành công (Ping: 48ms).')}
                  className="btn-primary text-xs"
                >
                  Ping Test & Lưu VTP
                </button>
              </div>
            </div>
          </div>

          {/* J&T EXPRESS */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-rose-500">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">J&T Express</h4>
                  <AutomationBadge tier="L1" carrierCode="J&T" />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  J&T Open Platform · Đồng bộ sao kê & Webhook
                </p>
              </div>
              <span className="badge-ok text-[11px]">Đã kết nối</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  J&T Customer Secret Key:
                </label>
                <div className="relative">
                  <input
                    type={showJtToken ? 'text' : 'password'}
                    value={jtToken}
                    onChange={(e) => setJtToken(e.target.value)}
                    className="modern-input w-full font-mono pr-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowJtToken(!showJtToken)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showJtToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Customer ID / Mã Hợp Đồng:
                </label>
                <input
                  type="text"
                  value={jtCustId}
                  onChange={(e) => setJtCustId(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Webhook URL Endpoint:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value="https://api.shipde.net/v1/webhooks/jtexpress/wh_anan_99"
                    className="modern-input w-full font-mono text-[11px] bg-slate-50 text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        'https://api.shipde.net/v1/webhooks/jtexpress/wh_anan_99',
                        'jt'
                      )
                    }
                    className="btn-secondary px-2 text-xs"
                  >
                    {copiedUrl === 'jt' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => showToast('✓ [J&T Express] Kết nối API thành công (Ping: 52ms).')}
                  className="btn-primary text-xs"
                >
                  Ping Test & Lưu J&T
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: POS & E-COMMERCE (PANCAKE, KIOTVIET, TIKTOK, HARAVAN, SAPO) */}
      {activeSubTab === 'pos' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pancake POS */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-blue-600">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">Pancake POS (CN-01)</h4>
                  <span className="badge-ok text-xs">Nguồn chính</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tự động đồng bộ đơn hàng, số điện thoại người nhận & mã vận đơn
                </p>
              </div>
              <span className="badge-ok text-[11px]">Active</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Pancake API Access Token:
                </label>
                <input
                  type="password"
                  value={pancakeApiKey}
                  onChange={(e) => setPancakeApiKey(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Pancake Shop ID / Page ID:
                </label>
                <input
                  type="text"
                  value={pancakeShopId}
                  onChange={(e) => setPancakeShopId(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() =>
                    showToast('✓ [Pancake POS] Đồng bộ tức thì 24 đơn mới thành công.')
                  }
                  className="btn-primary text-xs"
                >
                  Đồng Bộ Đơn Ngay
                </button>
              </div>
            </div>
          </div>

          {/* KiotViet */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-blue-500">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">KiotViet Open API</h4>
                  <span className="badge-ok text-xs">Connected</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đồng bộ doanh thu, tiền COD và kho hàng chi nhánh
                </p>
              </div>
              <span className="badge-ok text-[11px]">Active</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Client Secret Key:
                </label>
                <input
                  type="password"
                  value={kiotApiKey}
                  onChange={(e) => setKiotApiKey(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Retailer Alias (Tên Gian Hàng):
                </label>
                <input
                  type="text"
                  value={kiotRetailer}
                  onChange={(e) => setKiotRetailer(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() =>
                    showToast('✓ [KiotViet] Đã xác thực API Client Secret thành công.')
                  }
                  className="btn-primary text-xs"
                >
                  Lưu & Đồng Bộ KiotViet
                </button>
              </div>
            </div>
          </div>

          {/* TikTok Shop */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-slate-900">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">TikTok Shop Partner API</h4>
                  <span className="badge-ok text-xs">Live Channel</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tự động nhận đơn hàng livestream và đối chiếu tiền cấn trừ sàn
                </p>
              </div>
              <span className="badge-ok text-[11px]">Active</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  App Key / Partner ID:
                </label>
                <input
                  type="text"
                  value={tiktokAppKey}
                  onChange={(e) => setTiktokAppKey(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Shop Cipher Secret:
                </label>
                <input
                  type="password"
                  value={tiktokCipher}
                  onChange={(e) => setTiktokCipher(e.target.value)}
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => showToast('✓ [TikTok Shop] Kết nối API thành công.')}
                  className="btn-primary text-xs"
                >
                  Lưu TikTok Shop
                </button>
              </div>
            </div>
          </div>

          {/* Haravan & Sapo */}
          <div className="modern-card p-6 space-y-4 border-t-4 border-t-purple-600">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-slate-900">Haravan & Sapo Omnichannel</h4>
                  <span className="badge-muted text-xs">Sẵn sàng kết nối</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đồng bộ đơn hàng website và các kênh bán lẻ đa sàn
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Haravan Access Token / App Secret:
                </label>
                <input
                  type="password"
                  placeholder="hrv_live_sec_••••••••••••"
                  className="modern-input w-full font-mono text-xs"
                />
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => showToast('✓ Đã kích hoạt kết nối Haravan / Sapo.')}
                  className="btn-secondary text-xs"
                >
                  Kích Hoạt Kênh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: WEBHOOKS & INTERACTIVE SIMULATOR */}
      {activeSubTab === 'webhooks' && (
        <div className="space-y-6">
          {/* Webhook Security Rules Card */}
          <div className="modern-card p-5 bg-blue-50/40 border border-blue-100 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-bold text-blue-950 block">
                Cơ Chế Bảo Mật Webhook Chuẩn Doanh Nghiệp (HMAC SHA-256):
              </span>
              <p className="text-blue-800">
                Mọi webhook từ hãng gửi về đều được xác thực chữ ký SHA-256 HMAC qua Header{' '}
                <code className="bg-white px-1.5 py-0.5 rounded border border-blue-200 font-mono">
                  X-ShipDe-Signature
                </code>
                . Các gói tin gửi trùng lặp sẽ được tự động lọc bỏ an toàn nhờ cơ chế khử trùng lặp
                lũy đẳng (BR-02 / BR-40).
              </p>
            </div>
          </div>

          {/* Interactive Webhook Simulator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 modern-card p-6 space-y-4">
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900">
                    Trình Bắn Webhook Thử Nghiệm (Live Simulator)
                  </h3>
                </div>
                <span className="badge-info text-xs">Sandbox Mode</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Chọn Hãng Bắn Webhook:
                    </label>
                    <select
                      value={simCarrier}
                      onChange={(e) => setSimCarrier(e.target.value)}
                      className="modern-input w-full text-xs font-semibold"
                    >
                      <option value="GHN">Giao Hàng Nhanh (GHN)</option>
                      <option value="GHTK">Giao Hàng Tiết Kiệm (GHTK)</option>
                      <option value="Viettel Post">Viettel Post</option>
                      <option value="J&T">J&T Express</option>
                      <option value="Pancake POS">Pancake POS</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Mã Vận Đơn Giả Lập:
                    </label>
                    <input
                      type="text"
                      value={simTracking}
                      onChange={(e) => setSimTracking(e.target.value)}
                      className="modern-input w-full font-mono uppercase font-bold text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Sự Kiện Webhook:
                  </label>
                  <select
                    value={simEvent}
                    onChange={(e) => setSimEvent(e.target.value)}
                    className="modern-input w-full text-xs font-semibold"
                  >
                    <option value="DELIVERY_FAIL">
                      1. Giao thất bại (DELIVERY_FAIL $\rightarrow$ Kích hoạt cứu đơn)
                    </option>
                    <option value="PICKUP_DELAY">
                      2. Chậm lấy hàng (PICKUP_DELAY $\rightarrow$ SLA 6h)
                    </option>
                    <option value="DELIVERED">
                      3. Giao thành công (DELIVERED $\rightarrow$ Chờ đối soát COD)
                    </option>
                    <option value="RETURNING">4. Đang hoàn hàng về kho (RETURNING)</option>
                    <option value="DAMAGED_RETURN">
                      5. Hàng hoàn hư hỏng (DAMAGED $\rightarrow$ Mở khiếu nại)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Lý Do Shipper Báo:
                  </label>
                  <input
                    type="text"
                    value={simReason}
                    onChange={(e) => setSimReason(e.target.value)}
                    className="modern-input w-full text-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleFireWebhookTest}
                  className="btn-primary w-full h-11 justify-center text-xs font-bold shadow-md shadow-blue-500/20 mt-2"
                >
                  <Zap className="w-4 h-4" />
                  <span>Bắn Webhook Vào Hệ Thống (HTTP POST)</span>
                </button>
              </div>
            </div>

            {/* Response Preview Box */}
            <div className="lg:col-span-6 modern-card p-6 flex flex-col justify-between space-y-4 bg-slate-900 text-white">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono font-bold text-xs text-slate-200">
                    Server Response Payload (JSON)
                  </span>
                </div>
                <span className="badge-ok text-[10px]">HTTP 200 OK</span>
              </div>

              <div className="flex-1 font-mono text-[11px] text-emerald-400 bg-slate-950 p-4 rounded-xl overflow-x-auto custom-scrollbar leading-relaxed">
                {simResponse ||
                  `// Nhấp "Bắn Webhook Vào Hệ Thống" để xem phản hồi JSON thời gian thực...
{
  "status": "ready_for_test",
  "endpoint": "https://api.shipde.net/v1/webhooks/${simCarrier.toLowerCase()}/wh_anan_99",
  "signature_type": "HMAC-SHA256"
}`}
              </div>

              <div className="text-[10px] text-slate-400 font-mono flex justify-between items-center pt-2 border-t border-slate-800">
                <span>Latency: ~35ms</span>
                <span>Idempotent: Enabled</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: REALTIME LIVE LOGS */}
      {activeSubTab === 'logs' && (
        <div className="modern-card overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-sm text-slate-900">
                Nhật Ký Gọi API & Webhooks Thời Gian Thực ({liveLogs.length} sự kiện)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tự động ghi vết toàn bộ sự kiện nhận từ hãng và POS phục vụ kiểm toán
              </p>
            </div>
            <button
              type="button"
              onClick={() => showToast('✓ Đã làm mới nhật ký API.')}
              className="btn-secondary text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Làm mới log</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Thời Gian</th>
                  <th>Nguồn Phát Sinh</th>
                  <th>Loại Sự Kiện (Event)</th>
                  <th>Mã Vận Đơn</th>
                  <th>Mã Phản Hồi</th>
                  <th>Thời Gian Xử Lý</th>
                  <th>Xác Thực Chữ Ký</th>
                </tr>
              </thead>
              <tbody>
                {liveLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-mono text-xs text-slate-500">{log.time}</td>
                    <td className="font-bold text-xs text-slate-900">{log.source}</td>
                    <td>
                      <span className="badge-info font-mono text-[10px]">{log.event}</span>
                    </td>
                    <td className="font-mono font-bold text-xs text-blue-600">{log.tracking}</td>
                    <td>
                      <span className="badge-ok font-mono text-[10px]">{log.status} OK</span>
                    </td>
                    <td className="font-mono text-xs text-slate-500">{log.duration}</td>
                    <td>
                      <span className="text-xs text-emerald-700 font-semibold">
                        {log.signature}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: RATE CARDS (BR-51) */}
      {activeSubTab === 'rates' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Scale className="w-4 h-4 text-blue-600" />
                <span>Biểu Giá Hợp Đồng Cước Hãng (Cơ Sở Phép Dò D2 · BR-51)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nếu chưa cấu hình biểu giá, hệ thống sẽ không tự ý kết luận sai lệch cước bừa bãi
              </p>
            </div>
            <button
              type="button"
              onClick={() => showToast('✓ Mở modal tạo thêm biểu giá hợp đồng mới.')}
              className="btn-primary text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm Biểu Giá Mới</span>
            </button>
          </div>

          <div className="modern-card overflow-hidden">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Hãng Vận Chuyển</th>
                  <th>Tên Gói Hợp Đồng</th>
                  <th className="text-right">Cước Nội Tỉnh (&lt;1kg)</th>
                  <th className="text-right">Cước Liên Tỉnh (&lt;1kg)</th>
                  <th className="text-right">Phụ Phí (+0.5kg)</th>
                  <th>Trạng Thái Áp Dụng</th>
                  <th className="text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {rateCards.map((rc) => (
                  <tr key={rc.id}>
                    <td className="font-bold text-slate-900 text-xs">{rc.carrier}</td>
                    <td className="font-semibold text-slate-700 text-xs">{rc.tier}</td>
                    <td className="text-right font-mono font-bold text-xs">
                      <Money amount={rc.intraFee} state="confirmed" />
                    </td>
                    <td className="text-right font-mono font-bold text-xs">
                      <Money amount={rc.interFee} state="confirmed" />
                    </td>
                    <td className="text-right font-mono text-xs">
                      <Money amount={rc.addKgFee} state="confirmed" />
                    </td>
                    <td>
                      <span className="badge-ok text-[10px]">Đang áp dụng (Phép dò D2)</span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => showToast(`✓ Đang mở chỉnh sửa biểu giá ${rc.carrier}.`)}
                        className="btn-secondary text-[11px] py-1"
                      >
                        Chỉnh sửa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
