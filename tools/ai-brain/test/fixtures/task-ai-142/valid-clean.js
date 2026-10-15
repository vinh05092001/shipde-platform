'use strict';

// Live dynamic routing: models and capacities loaded from live sources
function selectCandidate(liveCatalogue, routeHealth, taskProfile) {
  const candidates = liveCatalogue.filter((item) => routeHealth.isHealthy(item.id));
  return candidates[0] || null;
}

module.exports = {
  selectCandidate,
};
