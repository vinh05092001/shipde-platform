# fanout.sh <worktree> <ITEM-ID> <taskfile>
# Splits the findings in <worktree>/.oc/review.txt into up to 3 file-disjoint groups and gives each group to its own
# writer in its own worktree (branch <pr-branch>--lN from the PR head). Shared contract files (openapi, prisma schema,
# packages/contracts, register/work items) always belong to lane 1. Prints "FANOUT n" or "SINGLE" (caller routes normally).
S=/c/Users/gumac/AppData/Local/Temp/claude/C--Users-gumac-AI-shipde-platform/05678e41-bc79-413b-8623-3be22ddbfec2/scratchpad
W=/c/Users/gumac/AI/shipde-platform/.worktrees; wt=$1; id=$2; task=$3; d=$W/$wt; rv=$d/.oc/review.txt
[ -f $rv ] || { echo SINGLE; exit 0; }
# finding blocks start with "N. " or "- "; group key = owning area of the first path in the block
node - "$rv" > $S/fanout-$id.json <<'EOF'
const fs=require('fs');const t=fs.readFileSync(process.argv[2],'utf8');
const blocks=t.split(/\n(?=\s*(?:\d+\.|-)\s+\*?\*?(?:NEW )?P[01])/).filter(b=>/P[01]/.test(b));
const shared=/openapi|schema\.prisma|prisma\/|packages\/contracts|FEATURE-DELIVERY-REGISTER|work-items\/|package\.json|pnpm-lock/;
const area=p=>{if(shared.test(p))return'shared';const m=p.match(/^(apps\/[^/]+\/src\/[^/]+|apps\/[^/]+|packages\/[^/]+|docs|scripts|tools\/[^/]+)/);return m?m[1]:'other'};
const groups={};for(const b of blocks){const ps=[...b.matchAll(/`?((?:apps|packages|docs|scripts|tools|prisma)\/[\w./\-\[\]]+?)(?::\d+)?`?(?=[\s,;)]|$)/g)].map(x=>x[1]);
 const keys=[...new Set(ps.map(area))];const k=keys.includes('shared')||keys.length!==1?'shared':keys[0];(groups[k]=groups[k]||{files:new Set(),text:[]}).text.push(b.trim());ps.forEach(p=>groups[k].files.add(p));}
let lanes=Object.entries(groups).map(([k,g])=>({k,files:[...g.files],text:g.text}));
lanes.sort((a,b)=>(a.k==='shared'?-1:b.k==='shared'?1:b.text.length-a.text.length));
while(lanes.length>3){const x=lanes.pop();lanes[lanes.length-1].text.push(...x.text);lanes[lanes.length-1].files.push(...x.files);}
console.log(JSON.stringify(lanes));
EOF
n=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$S/fanout-$id.json'.replace(/^\/c\//,'C:/'),'utf8')).length)" 2>/dev/null || echo 0)
[ "${n:-0}" -ge 2 ] || { echo SINGLE; exit 0; }
b=$(git -C $d branch --show-current); head=$(git -C $d rev-parse HEAD); i=0
while [ $i -lt $n ]; do i=$((i+1)); lw=$wt--l$i; lb=$b--l$i
  git -C $d worktree remove --force $W/$lw 2>/dev/null; git -C $d branch -D $lb 2>/dev/null
  git -C $d worktree add -q -b $lb $W/$lw $head || { echo SINGLE; exit 0; }
  mkdir -p $W/$lw/.oc; cp $d/.oc/*.md $W/$lw/.oc/ 2>/dev/null; cp $rv $W/$lw/.oc/review-all.txt; sed -i -E 's#(Start with|first run): git fetch origin && git merge --no-edit origin/main[^.]*\.##' $W/$lw/.oc/*.md
  [ -d $d/node_modules ] && cmd //c mklink //J "$(cygpath -w $W/$lw/node_modules)" "$(cygpath -w $d/node_modules)" >/dev/null 2>&1
  node -e "const l=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[$i-1];require('fs').writeFileSync(process.argv[2],'You are lane $i of $n working in parallel on the same PR. Fix ONLY these findings:\n\n'+l.text.join('\n\n')+'\n\nYou may edit only these files (and new test files next to them): '+l.files.join(', ')+'\nDo NOT edit other files; other lanes own them. Read .oc/review-all.txt and the Work Item for full context. Do not merge main (the coordinator does).\n')" "$(cygpath -w $S/fanout-$id.json)" "$(cygpath -w $W/$lw/.oc/review.txt)"
  (cd $W/p-run-main && timeout 600 node $S/route.js --item "$id" --cwd "C:/Users/gumac/AI/shipde-platform/.worktrees/$lw" --task "C:/Users/gumac/AI/shipde-platform/.worktrees/$lw/.oc/$task" --allow-gpt 2>&1 | grep -E "^$id" | head -1)
  echo "$lw" >> $S/pipeline-state/$id.lanes
done
echo "FANOUT $n"
