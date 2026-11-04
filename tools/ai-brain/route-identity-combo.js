'use strict';

const { resolveModelPrefix, UNKNOWN } = require('./route-identity-utils');

function expandComboIdentity(comboIdentity, constituentModels, candidateAccountMap = {}) {
  const { createRouteIdentity } = require('./route-identity');
  if (!comboIdentity) return null;
  const parent = comboIdentity.candidateKey ? comboIdentity : createRouteIdentity(comboIdentity);

  const branches = (constituentModels || []).map((m, index) => {
    const modelStr = typeof m === 'string' ? m : m.modelId || m.configuredModelId || m.id;
    const { upstreamProviderId, outboundModelId } = resolveModelPrefix(modelStr);

    const eligibleAccounts = candidateAccountMap[upstreamProviderId] || [];

    return createRouteIdentity({
      harness: parent.harness,
      sourceId: parent.sourceId,
      gatewayId: parent.gatewayId,
      upstreamProviderId,
      configuredModelId: modelStr,
      outboundModelId,
      accountRef: eligibleAccounts.length === 1 ? eligibleAccounts[0].accountRef : UNKNOWN,
      connectionId: eligibleAccounts.length === 1 ? eligibleAccounts[0].connectionId : UNKNOWN,
      quotaScopeId: eligibleAccounts.length === 1 ? eligibleAccounts[0].quotaScopeId : UNKNOWN,
      isCombo: false,
      metadata: {
        parentCombo: parent.configuredModelId,
        branchIndex: index + 1,
        totalCandidatesForProvider: eligibleAccounts.length,
        ...(typeof m === 'object' ? m : {}),
        ...(typeof m === 'object' ? m.metadata : {}),
        capabilities: m.capabilities ?? m.metadata?.capabilities ?? [],
        candidateAccounts: eligibleAccounts.map((a) => ({
          connectionId: a.connectionId || UNKNOWN,
          accountRef: a.accountRef || UNKNOWN,
          priority: a.priority ?? UNKNOWN,
          quotaScopeId:
            a.quotaScopeId ||
            `quota::${upstreamProviderId}::${a.accountRef || a.connectionId || UNKNOWN}`,
        })),
      },
    });
  });

  return createRouteIdentity({
    ...parent,
    isCombo: true,
    comboBranches: branches,
  });
}

module.exports = { expandComboIdentity };
