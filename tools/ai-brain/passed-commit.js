const { spawnSync: defaultSpawnSync } = require('child_process');

function importPassedCommit({
  hostRepo,
  workerRoot,
  workItemId,
  sha,
  spawnSync = defaultSpawnSync,
}) {
  if (!hostRepo || !workerRoot || !workItemId || !sha) {
    return { ok: false, code: 'ARGUMENT_MISSING' };
  }
  const ref = `refs/shipde/passed/${workItemId}/${sha}`;
  const fetchRes = spawnSync('git', [
    '-C',
    hostRepo,
    'fetch',
    '--no-tags',
    workerRoot,
    `${sha}:${ref}`,
  ]);
  if (fetchRes.status !== 0) {
    return { ok: false, code: 'IMPORT_FETCH_FAILED' };
  }
  const verifyRes = spawnSync('git', ['-C', hostRepo, 'cat-file', '-e', `${sha}^{commit}`]);
  if (verifyRes.status !== 0) {
    return { ok: false, code: 'IMPORT_VERIFY_FAILED' };
  }
  return { ok: true, ref };
}

function hasCommit(hostRepo, sha, spawnSync = defaultSpawnSync) {
  if (!hostRepo || !sha) return false;
  const res = spawnSync('git', ['-C', hostRepo, 'cat-file', '-e', `${sha}^{commit}`]);
  return res.status === 0;
}

module.exports = { importPassedCommit, hasCommit };
