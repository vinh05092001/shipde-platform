// Reads what a source itself says a key may call today. GET only; returns model
// IDs, access tiers and allowance numbers, never the key or a raw response body.
async function readSourceAccess(source, opts = {}) {
  const declared = source?.freeAllowance;
  const env = source?.credential?.env;
  const key = (opts.env || process.env)[env];
  if (!declared || !source.endpoint || !key) return null;
  const doFetch = opts.fetch || fetch;
  const get = async (path) => {
    const res = await doFetch(source.endpoint + path, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.status === 200 ? res.json() : null;
  };
  try {
    const [models, usage] = await Promise.all([get(declared.modelsPath), get(declared.usagePath)]);
    if (!Array.isArray(models?.data) || !usage?.free_tokens) return null;
    return {
      readAt: new Date().toISOString(),
      models: models.data.map((m) => ({ id: m.id, tier: m.access_tier || 'UNKNOWN' })),
      freeTokens: {
        limitPerDay: usage.free_tokens.limit_per_day ?? null,
        remaining: usage.free_tokens.remaining ?? null,
      },
    };
  } catch {
    return null;
  }
}

// A route may spend only an allowance the source reported for that exact model.
// Anything unproven stays UNKNOWN, which no ticket may spend.
function budgetOf(modelId, access) {
  const model = access?.models?.find((m) => m.id === modelId);
  if (!model) return { modelListing: 'CONFIGURED_NOT_LIVE', budget: 'UNKNOWN' };
  const remaining = access.freeTokens?.remaining;
  const free = model.tier === 'free' && Number(remaining) > 0;
  return {
    modelListing: 'LIVE',
    accessTier: model.tier,
    budget: free ? 'FREE_ALLOWANCE' : 'UNKNOWN',
    ...(free ? { budgetRemainingTokens: Number(remaining), budgetReadAt: access.readAt } : {}),
  };
}

module.exports = { readSourceAccess, budgetOf };
