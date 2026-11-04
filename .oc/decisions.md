# Decision ledger — p-task-ai-160 (seeded 11-04_08:33 from earlier review rounds)
- seen: Follow-up (non-blocking): WHERE: scripts/ai/research.mjs:324 (defaultResolveHost), P2; WRONG: a public IPv6 URL supplies a bracketed hostname to `lookup` and fails native resolution; GOAL: preserve supported public IPv6 
- seen: WHERE: scripts/ai/research.mjs:168 (validatePublicUrl); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:337 (defaultRetrieve); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:364 (defaultRetrieve); P1; previous finding 4 NOT FIXED  
- seen: WHERE: scripts/ai/research.mjs:549 (sanitizeUrlInText); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:554 (sanitizeUrlInText); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:588 (redact); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:649 (runResearch); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:693 (runResearch); P1 NEW.  
- seen: WHERE: scripts/ai/research.mjs:731 (redact); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:734 (redact); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:737 (redact); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:781 (runResearch); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:852 (runResearch); P1; previous finding 3 NOT FIXED  
- seen: WHERE: scripts/ai/research.mjs:857 (runResearch); P1; previous finding 1 NOT FIXED  
- seen: WHERE: scripts/ai/research.mjs:917 (runResearch); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:927 (runResearch); P1; previous finding 1 NOT FIXED  
- seen: WHERE: scripts/ai/research.mjs:945 (runResearch); P1 NEW  
- seen: WHERE: scripts/ai/research.mjs:950 (runResearch); P1 NEW  
- seen: WHERE: scripts/ai/test/research.test.mjs:822 (test fixtures contain no generic secret scanner patterns or live tokens); P1, previous finding NOT FIXED.  

## coordinator decision 04/11 12:00 (operator: reuse community packages)
- REQUIRED: network guard = ssrf-guard@1.0.0 safe fetch (IP pinning + per-hop redirect validation); hand-written DNS/IP/redirect checks = prior finding NOT FIXED.
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.
