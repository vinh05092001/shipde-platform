# agy pool producer

`worker-core.ps1` is the script the `\ShipDe\ShipDe-agyNN` scheduled task runs (deployed at
`C:\Tools\agy-pool\worker-core.ps1`). It reads `job.json`, runs agy and publishes
`result.json` atomically. The controller (`tools/ai-brain/agy-pool-runtime.js`) accepts a
result only when its `jobId` equals the job it submitted, so this script must echo
`job.jobId` into `result.json`. Every agy call is bounded by `job.printTimeoutSec`, which the
controller stamps from `dispatch.agyPoolTimeoutMs`; a job without it is refused.

`-RunsDir` (or `AGY_POOL_RUNS_DIR`) and `-AgyExe` (or `AGY_POOL_AGY_EXE`) default to the
deployed layout; tests override them. After changing this file, copy it to the deployed
path. `tools/ai-brain/test/task-ai-142-agy-pool-producer.test.js` runs it end to end
behind the real `submitJob`.
