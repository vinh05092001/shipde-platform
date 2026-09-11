import assert from 'node:assert/strict';
import { CarrierMockFactory } from './carrier-mock-factory.js';
import { CarrierMockError } from './base-mock.js';

async function runCarrierMockTests() {
  console.log('🧪 Testing Carrier Mocks (GHN, GHTK, VIETTEL_POST)...');

  const carriers = ['GHN', 'GHTK', 'VIETTEL_POST'];

  for (const code of carriers) {
    const carrier = CarrierMockFactory.getCarrier(code);
    carrier.setMode('SUCCESS');

    // 1. Success Quote
    const quote = await carrier.calculateQuote({
      carrierCode: code,
      origin: {
        name: 'Shop A',
        phone: '0901234567',
        address: '123 Le Loi',
        ward: 'Ben Nghe',
        district: 'Quan 1',
        province: 'TP. Ho Chi Minh',
      },
      destination: {
        name: 'Khach B',
        phone: '0987654321',
        address: '456 Tran Phu',
        ward: 'Dien Bien',
        district: 'Ba Dinh',
        province: 'Ha Noi',
      },
      parcel: { weightGrams: 500 },
      codAmountVnd: 250000,
    });

    assert.equal(quote.carrierCode, code);
    assert.ok(quote.totalFeeVnd > 0);
    assert.ok(quote.serviceName.length > 0);

    // 2. Success Order Creation
    const order = await carrier.createOrder({
      carrierCode: code,
      clientOrderCode: `ORD_${Date.now()}`,
      sender: {
        name: 'Shop A',
        phone: '0901234567',
        address: '123 Le Loi',
        ward: 'Ben Nghe',
        district: 'Quan 1',
        province: 'TP. Ho Chi Minh',
      },
      recipient: {
        name: 'Khach B',
        phone: '0987654321',
        address: '456 Tran Phu',
        ward: 'Dien Bien',
        district: 'Ba Dinh',
        province: 'Ha Noi',
      },
      parcel: { weightGrams: 500 },
      codAmountVnd: 250000,
    });

    assert.ok(order.trackingCode.length > 0);
    assert.ok(order.carrierOrderId.length > 0);

    // 3. Success Tracking
    const tracking = await carrier.getTracking(order.trackingCode);
    assert.equal(tracking.trackingCode, order.trackingCode);
    assert.ok(tracking.events.length > 0);

    // 4. Success Cancellation
    const cancel = await carrier.cancelOrder(order.trackingCode);
    assert.equal(cancel.cancelled, true);

    // 5. Validation Error Mode
    carrier.setMode('VALIDATION_ERROR');
    await assert.rejects(
      async () => {
        await carrier.calculateQuote({
          carrierCode: code,
          origin: { name: '', phone: '', address: '', ward: '', district: '', province: '' },
          destination: { name: '', phone: '', address: '', ward: '', district: '', province: '' },
          parcel: { weightGrams: 500 },
        });
      },
      (err: any) =>
        err instanceof CarrierMockError &&
        err.code === 'CARRIER_VALIDATION_ERROR' &&
        err.statusCode === 422
    );

    // 6. Rate Limit Mode
    carrier.setMode('RATE_LIMIT');
    await assert.rejects(
      async () => {
        await carrier.getTracking('dummy');
      },
      (err: any) =>
        err instanceof CarrierMockError &&
        err.code === 'CARRIER_RATE_LIMIT' &&
        err.statusCode === 429
    );

    // 7. Timeout Mode
    carrier.setMode('TIMEOUT');
    await assert.rejects(
      async () => {
        await carrier.cancelOrder('dummy');
      },
      (err: any) =>
        err instanceof CarrierMockError && err.code === 'CARRIER_TIMEOUT' && err.statusCode === 504
    );

    // Reset mode
    carrier.setMode('SUCCESS');
  }

  console.log('✅ All Carrier Mock tests passed successfully.');
}

runCarrierMockTests().catch((err) => {
  console.error('❌ Carrier Mock test failed:', err);
  process.exit(1);
});
