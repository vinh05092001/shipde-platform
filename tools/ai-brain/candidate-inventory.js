'use strict';
const fs = require('fs');
const path = require('path');

/** Read one coherent intake snapshot; never mix accounts from unrelated runs. */
function readCandidateInventory(options = {}) {
  const o = options;
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const loadSnapshot = (catalogueFile, accountsFile, sourceFile) => {
    if (
      !catalogueFile ||
      !fs.existsSync(catalogueFile) ||
      !accountsFile ||
      !fs.existsSync(accountsFile)
    )
      throw Error('Invalid candidate snapshot');
    if (!sourceFile || !fs.existsSync(sourceFile)) throw Error('Invalid source inventory');
    const catalogue = read(catalogueFile);
    const accounts = read(accountsFile);
    if (!Array.isArray(catalogue) || !Array.isArray(accounts))
      throw Error('Invalid candidate snapshot');
    const sourceModels = read(sourceFile);
    if (!sourceModels || typeof sourceModels !== 'object' || Array.isArray(sourceModels))
      throw Error('Invalid source inventory');
    return { catalogue, accounts, sourceModels };
  };
  const snapshot = (dir) =>
    loadSnapshot(
      path.join(dir, 'catalogue.json'),
      path.join(dir, 'accounts.json'),
      path.join(dir, 'catalogue-sources.json')
    );
  if (o.catalogueFile || o.sourceModelsFile) {
    const catalogueFile =
      o.catalogueFile ||
      (o.sourceModelsFile && path.join(path.dirname(o.sourceModelsFile), 'catalogue.json'));
    const sourceFile =
      o.sourceModelsFile ||
      (catalogueFile && path.join(path.dirname(catalogueFile), 'catalogue-sources.json'));
    const accountsFile = path.join(path.dirname(catalogueFile || sourceFile), 'accounts.json');
    return loadSnapshot(catalogueFile, accountsFile, sourceFile);
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
  return {};
}
module.exports = { readCandidateInventory };
