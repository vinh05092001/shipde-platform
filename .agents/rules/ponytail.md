# Rule: Ponytail Engine (DietrichGebert/ponytail)
trigger: always_on

## Philosophy
Write the minimum code that actually works. Cut over-engineering, boilerplates, and speculative features (YAGNI).
Stop at the first rung of the Decision Ladder:
1. Does it need to exist? (Skip if no)
2. Already in codebase? (Reuse)
3. Native platform / Stdlib? (Use it)
4. Existing dependency? (Use it)
5. One line? (Make it one line)
6. Minimum working code.

## Invariants
- Security, Maker-Checker (BR-12), PII Masking (BR-42), and Business Rules (BR-01..BR-51) are strictly non-negotiable.
