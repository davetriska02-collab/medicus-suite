#!/bin/sh
# PreToolUse guard for Bash tool calls (wired in .claude/settings.json).
# Converts two standing CLAUDE.md safety rules from "the model remembers" into
# "the harness enforces". Exit 2 = BLOCK the call and surface the message to the
# agent. Patient-data COMMIT protection lives in .githooks/pre-commit (git-level,
# applies to every contributor regardless of tool); this guard covers the two
# things that happen through the shell mid-session.
#
# Deliberately narrow — two sharp rules, low false-positive risk (per
# .claude/README.md: "max 2-3 sharp hooks, judgement stays with the model"):
#   1. never force-push main
#   2. never read/transmit a real .env secrets file

cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})' 2>/dev/null)
[ -z "$cmd" ] && exit 0

# (1) Force-push to main. Normal `git push -u origin <branch>` and even a
#     force-push to a feature branch are untouched — only force + main is blocked.
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push' \
  && printf '%s' "$cmd" | grep -Eq '(--force-with-lease|--force|[[:space:]]-f([[:space:]]|$)|[[:space:]]\+[A-Za-z])' \
  && printf '%s' "$cmd" | grep -Eq '(^|[[:space:]:+])main([[:space:]:]|$)'; then
  echo "BLOCKED: force-pushing main is forbidden (CLAUDE.md: 'Never force-push main'). Use a feature branch + PR." >&2
  exit 2
fi

# (2) Reading or transmitting a real .env secrets file. The .env.example /
#     .sample / .template shapes are fine and do not match (the positive pattern
#     requires .env to END the token, so .env.example never triggers).
if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_.])\.env([[:space:]]|$|["'"'"'])' \
  && printf '%s' "$cmd" | grep -Eq '\b(cat|less|more|head|tail|nl|xxd|od|strings|bat|view|cp|scp|curl|wget|nc|base64|sed|awk)\b'; then
  echo "BLOCKED: reading or transmitting a .env file is forbidden (secrets leak risk). Use .env.example for shape, or an env var." >&2
  exit 2
fi

exit 0
