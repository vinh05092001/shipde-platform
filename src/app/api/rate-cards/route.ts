import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { RateCard, RateTier } from '@/types/domain';

export async function GET(req: NextRequest) {
  return NextResponse.json({ success: true, data: db.rateCards });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { carrier_account_id, volumetric_divisor, cod_payout_sla_days, tiers } = body;

    if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'Biểu giá phải có ít nhất 1 bậc cước' } },
        { status: 400 }
      );
    }

    const rateCardId = `rc_${Date.now()}`;
    const newTiers: RateTier[] = tiers.map((t: any, idx: number) => ({
      id: `tier_${rateCardId}_${idx + 1}`,
      rate_card_id: rateCardId,
      route_type: t.route_type || 'INTRA_PROVINCE',
      weight_from_g: Number(t.weight_from_g) || 0,
      weight_to_g: Number(t.weight_to_g) || 500,
      base_fee: Number(t.base_fee) || 22000,
      step_fee: Number(t.step_fee) || 5000,
      step_weight_g: Number(t.step_weight_g) || 500,
    }));

    const newRateCard: RateCard = {
      id: rateCardId,
      merchant_id: db.merchant.id,
      carrier_account_id: carrier_account_id || db.carrierAccounts[0]?.id || 'acc_ghn_01',
      version: 1,
      effective_from: new Date(),
      effective_to: null,
      volumetric_divisor: Number(volumetric_divisor) || 5000,
      cod_payout_sla_days: Number(cod_payout_sla_days) || 3,
      checksum: `sha256_rc_${Date.now()}`,
      tiers: newTiers,
    };

    db.rateCards.unshift(newRateCard);

    return NextResponse.json({
      success: true,
      message: 'Cấu hình biểu giá hợp đồng thành công (CN-25)',
      data: newRateCard,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
