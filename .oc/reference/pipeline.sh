# Unattended delivery loop: keeps every item moving without the coordinator in the loop.
# Each pass (every 10 min), per item in items.txt ("worktree|ITEM-ID|idgrep|pr|taskfile"):
#   new commit        -> push-review.sh (gate checks, push, review; reviewer differs in family from writer)
#   review CHANGES    -> copy review into .oc/review.txt and re-route a writer via route.js
#   review PASS       -> write PASS line to pipeline-pass.txt and exit, so the coordinator verifies SHA+CI and merges
#   writer dead, no commit -> re-route via route.js (route.js applies cooldowns / unproductive rules)
# It never merges, never force-pushes, never edits product files.
S=/c/Users/gumac/AppData/Local/Temp/claude/C--Users-gumac-AI-shipde-platform/05678e41-bc79-413b-8623-3be22ddbfec2/scratchpad
W=/c/Users/gumac/AI/shipde-platform/.worktrees; L=$W/logs/night; RL=$L/route-log.jsonl; ST=$S/pipeline-state; mkdir -p $ST
log(){ echo "$(date +%H:%M) $*" | tee -a $S/pipeline.log; }

last_launch(){ # prints "<epoch-ms> <how> <label>" of the newest launched route for an item
  [ -f $RL ] || return; grep "\"item\":\"$1\"" $RL | grep '"launch"' | tail -1 | node -e "try{const r=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Date.parse(r.at),r.launch.how.replace(/ /g,'_'),r.choice.label)}catch{}"
}
writer_alive(){ # $1=epoch-ms $2=how
  case "$2" in
    *pid_*) p=${2##*_}; tasklist //FI "PID eq $p" 2>/dev/null | grep -q " $p " && return 0
      # the launcher pid can exit while the CLI keeps working: also treat a log written in the last 3 min as alive
      lf=$(ls -t $L/route-$3-*.log 2>/dev/null | head -1); [ -n "$lf" ] && [ $(( $(date +%s) - $(stat -c %Y "$lf") )) -lt 180 ] ;;
    schtasks_ShipDe-agy*) lane=${2##*-}; f=C:/Tools/agy-runs/$lane/result.json
      fin=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('$f','utf8').replace(/^\uFEFF/,''));console.log(Date.parse(j.finishedAt)||0)}catch{console.log(0)}")
      [ "$fin" -lt "$1" ] && [ $(( $(date +%s)000 - $1 )) -lt 7200000 ] ;;
    *) return 1 ;;
  esac
}
route(){ # $1 wt $2 id $3 task
  # per-item backoff: at most one launch attempt per 8 min, and never while the last writer is still alive
  lt=$(cat $ST/$2.lastroute 2>/dev/null || echo 0); [ $(( $(date +%s) - lt )) -lt 480 ] && return
  read t how label <<<"$(last_launch $2)"; [ -n "$t" ] && writer_alive "$t" "$how" "$id" && return
  date +%s > $ST/$2.lastroute
  o=$(cd $W/p-run-main && timeout 600 node $S/route.js --item $2 --cwd "C:/Users/gumac/AI/shipde-platform/.worktrees/$1" --task "C:/Users/gumac/AI/shipde-platform/.worktrees/$1/.oc/$3" --allow-gpt 2>&1 | grep -E "^$2" | head -1)
  log "route $2: ${o:0:120}"
}

while :; do
  while IFS='|' read wt id grepid pr task; do
    [ -z "$wt" ] || [ "${wt:0:1}" = "#" ] && continue
    d=$W/$wt; b=$(git -C $d branch --show-current 2>/dev/null) || continue
    if [ -f $ST/$id.lanes ]; then  # parallel lanes in flight: wait until each committed or 2h passed, then merge them
      age=$(( $(date +%s) - $(stat -c %Y $ST/$id.lanes) )); done_all=1
      for lw in $(cat $ST/$id.lanes); do [ "$(git -C $W/$lw rev-list --count $b..HEAD 2>/dev/null || echo 0)" -gt 0 ] || done_all=0; done
      [ $done_all = 0 ] && [ $age -lt 7200 ] && continue
      for lw in $(cat $ST/$id.lanes); do lb=$(git -C $W/$lw branch --show-current)
        if [ "$(git -C $d rev-list --count HEAD..$lb)" -gt 0 ]; then git -C $d merge -q --no-edit $lb 2>/dev/null && log "lane $lw merged" || { git -C $d merge --abort; log "lane $lw CONFLICT, dropped"; }; fi
        cmd //c rmdir "$(cygpath -w $W/$lw/node_modules)" 2>/dev/null; git -C $d worktree remove --force $W/$lw 2>/dev/null; git -C $d branch -D $lb >/dev/null 2>&1
      done; rm -f $ST/$id.lanes
    fi
    ahead=$(git -C $d rev-list --count origin/$b..HEAD 2>/dev/null || git -C $d rev-list --count origin/main..HEAD)
    read t how label <<<"$(last_launch $id)"
    if [ "${ahead:-0}" -gt 0 ] && [ "$pr" = "-" ] && ! git -C $d diff --name-only origin/main...HEAD | grep -q "work-items/$id.md"; then route $wt $id $task; continue; fi  # not a complete first delivery yet
    if [ "${ahead:-0}" -gt 0 ] && [ "$pr" = "-" ]; then echo "NEED_PR $wt $id" >> $S/pipeline-pass.txt; log "NEED_PR $id"; exit 0; fi
    hs=$(git -C $d rev-parse HEAD); unrev=0; [ "$pr" != "-" ] && [ "$(cat $ST/$id.reviewed 2>/dev/null)" != "$hs" ] && unrev=1  # pushed head never reviewed
    if [ "${ahead:-0}" -gt 0 ] || [ $unrev = 1 ]; then
      n=$(cat $ST/$id.n 2>/dev/null || echo 0); n=$((n+1)); echo $n > $ST/$id.n; tag="pl-$(echo $id | tr 'A-Z' 'a-z')-$n"
      prev=$(cat $ST/$id.prev 2>/dev/null || echo -)
      if echo "$label" | grep -qiE 'gpt|astra|terra|luna|codex'; then export OC=amd-radeon/DeepSeek-V4.1-Flash; else unset OC; fi
      o=$(bash $S/push-review.sh $wt $grepid $pr $tag $prev 2>&1 | tail -1); unset OC
      log "review $id #$pr: ${o:0:110}"
      echo "$(date -Iseconds),$id,$pr,$n,${label:-?},$(echo "$o" | grep -oE "VERDICT: [A-Z_]+|CI gate|SKIP|CONFLICT" | head -1),$(echo "$o" | grep -oE "tokens=[0-9,]*" | tr -d "tokens=,")" >> $S/metrics.csv
      if echo "$o" | grep -q "^CONFLICT"; then route $wt $id $task; continue; fi  # task-fix starts by merging main
      if echo "$o" | grep -q "^SKIP"; then  # gate refused the push (bad commit subject, gate file, or diff --check): send the reason back
        { echo "VERDICT: CHANGES_REQUIRED"; echo; echo "1. **P1 — push gate refused this branch ($o).** Fix before anything else:"; git -C $d diff --check origin/main...HEAD | head -20; git -C $d diff --name-only origin/main...HEAD | grep -E '(allowlist|semgrep|^\.github/|baseline\.json)'; echo "Commit subjects must contain $grepid; leftover conflict markers must be resolved."; } > $d/.oc/review.txt
        route $wt $id $task; continue; fi
      rf=$L/review-$tag.txt; git -C $d rev-parse HEAD > $ST/$id.reviewed
      if head -1 $rf 2>/dev/null | grep -q "VERDICT: PASS"; then echo "PASS $pr $tag $(grep -m1 'Reviewed SHA' $rf)" >> $S/pipeline-pass.txt; log "PASS $id #$pr"; exit 0; fi
      if grep -q "CHANGES_REQUIRED" $rf 2>/dev/null && [ $n -ge 4 ] && ! grep -q "CI gate" <<<"$o"; then cp $rf $d/.oc/review.txt; echo "STUCK $pr $id rounds=$n" >> $S/pipeline-pass.txt; log "STUCK $id after $n rounds"; exit 0; fi
      if grep -q "CHANGES_REQUIRED" $rf 2>/dev/null; then cp $rf $d/.oc/review.txt; { echo; echo "## Round $n review ($tag, writer was ${label:-unknown})"; cat $rf; } >> $d/.oc/history.md; echo review-$tag.txt > $ST/$id.prev
        f=$(bash $S/fanout.sh $wt $id $task 2>&1 | tail -1); log "fanout $id: $f"; [ "${f%% *}" = FANOUT ] || route $wt $id $task; fi
    elif [ -n "$t" ] && writer_alive "$t" "$how" "$id"; then :
    elif echo "$how" | grep -q "^codex" && [ -n "$(git -C $d status --porcelain -- . ':!.oc' ':!.oc-codex-task.md' ':!.serena' | head -1)" ]; then
      # Codex's workspace-write sandbox cannot write the worktree's git metadata (it lives in the main .git), so a Codex
      # writer can edit but never commit. The coordinator commits that output (allowed mechanical git) and the normal
      # gates (push-review: subject/gate-file/diff-check, CI, reviewer) judge it.
      git -C $d add -A -- . ':!.oc' ':!.oc-codex-task.md' ':!.serena' && git -C $d commit -q -m "[$id] Address review: writer output (${label:-codex})" && log "committed codex output for $id"
    else route $wt $id $task
    fi
  done < $S/items.txt
  sleep 120  # short pass: dead writers are replaced within ~2 min
done
