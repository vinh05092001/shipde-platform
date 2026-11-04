import { createServer } from 'node:http';
const m = await import('../scripts/ai/research.mjs');
console.log('exports', Object.keys(m));
