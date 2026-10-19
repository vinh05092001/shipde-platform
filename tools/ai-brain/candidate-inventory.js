'use strict';
const fs = require('fs');
const path = require('path');

/** Read one coherent intake snapshot; never mix accounts from unrelated runs. */
function readCandidateInventory(options = {}) {
  const o = options;
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const snapshot = (dir) => {
    const catalogue = read(path.join(dir, 'catalogue.json'));
    const accounts = read(path.join(dir, 'accounts.json'));
    if (!Array.isArray(catalogue) || !Array.isArray(accounts))
      throw Error('Invalid candidate snapshot');
    const sourceFile = path.join(dir, 'catalogue-sources.json');
    const sourceModels = fs.existsSync(sourceFile) ? read(sourceFile) : {};
    if (!sourceModels || typeof sourceModels !== 'object' || Array.isArray(sourceModels))
      throw Error('Invalid source inventory');
    return { catalogue, accounts, sourceModels };
  };
  if (o.catalogueFile || o.sourceModelsFile) {
    const catalogueFile = o.catalogueFile;
    const sourceFile =
      o.sourceModelsFile || path.join(path.dirname(catalogueFile), 'catalogue-sources.json');
    const accountsFile = path.join(path.dirname(catalogueFile || sourceFile), 'accounts.json');
    return {
      catalogue: catalogueFile ? read(catalogueFile) : undefined,
      sourceModels: fs.existsSync(sourceFile) ? read(sourceFile) : {},
      accounts: fs.existsSync(accountsFile) ? read(accountsFile) : [],
    };
  }
  if (o.useLatestIntake) {
    const root = path.join(o.rootDir, 'tools', 'ai-brain', 'data', 'intake');
    if (fs.existsSync(root)) {
      const runs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          dir: path.join(root, entry.name),
          name: entry.name,
          time: fs.statSync(path.join(root, entry.name)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
      for (const run of runs) {
        try {
          return snapshot(run.dir);
        } catch {
          /* Partial runs cannot mix with another snapshot. */
        }
      }
    }
  }
  return { accounts: [] };
}
module.exports = { readCandidateInventory };
