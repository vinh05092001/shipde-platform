# usage: split-review.sh <tag> <N>  ; splits logs/night/rvprompt-<tag>.txt into N parts by file, reviews each via agentrouter with model fallback
L=/c/Users/gumac/AI/shipde-platform/.worktrees/logs/night; cd $L; T=$1; N=${2:-3}; P=rvprompt-$T.txt
n=$(grep -n -m1 '^diff --git' $P | cut -d: -f1); head -n $((n-1)) $P > hdr-$T.txt; rm -f chunk-$T-*.txt
tail -n +$n $P | awk -v N=$N -v T=$T '/^diff --git/{c++} {print > ("chunk-" T "-" (c%N) ".txt")}'
for i in $(seq 0 $((N-1))); do { cat hdr-$T.txt; echo "NOTE: part $((i+1))/$N of the diff; review only this part, findings with file:line."; cat chunk-$T-$i.txt; } > rvprompt-${T}p$i.txt
 for m in gpt-6-astra gpt-6.1-sol deepseek-v4-flash; do timeout 1800 codex exec --skip-git-repo-check -s read-only -c 'model_providers.ar={name="agentrouter",base_url="https://agentrouter.org/v1",env_key="AGENTROUTER_API_KEY",wire_api="responses"}' -c model_provider=ar -m $m -c model_reasoning_effort=high -o review-${T}p$i.txt - < rvprompt-${T}p$i.txt > rvlog-${T}p$i.log 2>&1
  v=$(grep -m1 -o 'VERDICT: [A-Z_]*' review-${T}p$i.txt 2>/dev/null); [ -n "$v" ] && { echo "$T p$i $m $v"; break; }; echo "$T p$i $m failed"; sleep 60; done; sleep 60; done
