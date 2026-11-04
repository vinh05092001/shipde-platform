# usage: push-review.sh <worktree> <idgrep> <pr> <tag> <prev|->  ; contamination/gate check, push, review; split on content-block
S=/c/Users/gumac/AppData/Local/Temp/claude/C--Users-gumac-AI-shipde-platform/05678e41-bc79-413b-8623-3be22ddbfec2/scratchpad; W=/c/Users/gumac/AI/shipde-platform/.worktrees; L=$W/logs/night
cd $W/$1; git fetch -q origin main; b=$(git branch --show-current); bad=0
for h in $(git log origin/$b..HEAD --no-merges --format=%h); do git log -1 --format=%s $h | grep -q "$2" || git merge-base --is-ancestor $h origin/main || bad=1; done
# Branch behind main makes reviewers flag other PRs' merged work as this PR's changes: merge main first (clean merges only).
if [ "$(git rev-list --count HEAD..origin/main)" -gt 0 ]; then git merge -q --no-edit origin/main 2>/dev/null || { git merge --abort; echo "CONFLICT $1 behind main"; exit 2; }; fi
GH='|^\.github/'; [ "$2" = AI-165 ] && GH=''  # operator approved .github changes for TASK-AI-165 only (2026-11-02)
g=$(git diff --name-only origin/main...HEAD | grep -Ec "(allowlist|semgrep${GH}|baseline\.json)")
[ "$bad$g" = 00 ] && git diff --check origin/main...HEAD >/dev/null || { echo "SKIP $1 bad=$bad g=$g"; exit 1; }
git push -q origin HEAD || exit 1; cd $W/p-run-main
o=$(bash $S/codex-delta-review.sh $3 $4 origin/main $5 high "$(cat $S/review-focus.txt)" 2>&1 | tail -1); echo "$o"
if echo "$o" | grep -q "exit=1" && grep -q content-blocked $L/rvlog-$4.log; then bash $S/split-review.sh $4 4; cat $L/review-${4}p*.txt > $L/review-$4.txt; fi
