import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { CarrierAccount, CarrierCode, CarrierCapabilityTier } from '@/types/domain';

export async function GET(req: NextRequest) {
  return NextResponse.json({ success: true, data: db.carrierAccounts });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, carrier_code, account_name, token, client_id, capability_tier, account_id } = body;

    // Toggle / Update Capability Tier (E2E-10, BR-19)
    if (action === 'TOGGLE_TIER') {
      const acc = db.carrierAccounts.find((a) => a.id === account_id || a.carrier_code === carrier_code);
      if (!acc) {
        return NextResponse.json({ error: { code: 'account_not_found', message: 'Không tìm thấy tài khoản hãng' } }, { status: 404 });
      }

      acc.capability_tier =
        acc.capability_tier === CarrierCapabilityTier.L2_EXECUTE
          ? CarrierCapabilityTier.L1_ASSIST
          : CarrierCapabilityTier.L2_EXECUTE;

      return NextResponse.json({
        success: true,
        message: `Đã cập nhật mức năng lực ${acc.carrier_code} sang [${acc.capability_tier}] tức thì mà không cần deploy code.`,
        data: acc,
      });
    }

    // Add New Carrier Account / Test Connection
    if (action === 'CONNECT_CARRIER') {
      if (!carrier_code || !token) {
        return NextResponse.json({ error: { code: 'validation_error', message: 'Vui lòng cung cấp mã hãng và API Token' } }, { status: 400 });
      }

      const maskedToken = `${carrier_code.toLowerCase()}_token_••••••••••••${token.slice(-4) || '9999'}`;

      const newAccount: CarrierAccount = {
        id: `acc_${carrier_code.toLowerCase()}_${Date.now()}`,
        merchant_id: db.merchant.id,
        carrier_code: carrier_code as CarrierCode,
        account_name: account_name || `${carrier_code} Express - Mới`,
        capability_tier:
          carrier_code === 'GHN' ? CarrierCapabilityTier.L2_EXECUTE : CarrierCapabilityTier.L1_ASSIST,
        is_active: true,
        credentials_masked: maskedToken,
        created_at: new Date(),
      };

      db.carrierAccounts.push(newAccount);

      return NextResponse.json({
        success: true,
        message: `Kết nối thành công tài khoản ${carrier_code} với mức năng lực ${newAccount.capability_tier}`,
        data: newAccount,
      });
    }

    return NextResponse.json({ error: { code: 'bad_request', message: 'Hành động không hợp lệ' } }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: { code: 'server_error', message: error.message } }, { status: 500 });
  }
}
