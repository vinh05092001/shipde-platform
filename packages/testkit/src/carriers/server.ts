import http from 'node:http';
import { CarrierMockFactory } from './carrier-mock-factory.js';

const PORT = process.env.MOCK_CARRIER_PORT ? parseInt(process.env.MOCK_CARRIER_PORT, 10) : 4000;

export function createMockCarrierServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    // Route: /carriers/:carrierCode/:action
    if (parts[0] === 'carriers' && parts[1]) {
      const carrierCode = parts[1].toUpperCase();
      const action = parts[2];

      try {
        const carrier = CarrierMockFactory.getCarrier(carrierCode);

        if (action === 'quote' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', async () => {
            try {
              const params = body ? JSON.parse(body) : {};
              const quote = await carrier.calculateQuote(params);
              res.writeHead(200);
              res.end(JSON.stringify(quote));
            } catch (err: any) {
              res.writeHead(err.statusCode || 400);
              res.end(JSON.stringify({ error: err.message, code: err.code }));
            }
          });
          return;
        }

        if (action === 'orders' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', async () => {
            try {
              const params = body ? JSON.parse(body) : {};
              const order = await carrier.createOrder(params);
              res.writeHead(201);
              res.end(JSON.stringify(order));
            } catch (err: any) {
              res.writeHead(err.statusCode || 400);
              res.end(JSON.stringify({ error: err.message, code: err.code }));
            }
          });
          return;
        }

        if (action === 'tracking' && req.method === 'GET') {
          const code = url.searchParams.get('code') || 'DEFAULT';
          const tracking = await carrier.getTracking(code);
          res.writeHead(200);
          res.end(JSON.stringify(tracking));
          return;
        }
      } catch (err: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // Health / info
    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'mock-carriers',
          carriers: ['GHN', 'GHTK', 'VIETTEL_POST'],
        })
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const server = createMockCarrierServer();
  server.listen(PORT, () => {
    console.log(`🚚 Mock Carrier Gateway is running at http://localhost:${PORT}`);
    console.log(`   Carriers supported: GHN, GHTK, VIETTEL_POST`);
  });
}
