#!/bin/zsh
# Double-click to run Nail Buddy on this Mac (opens Chrome or Safari at http://localhost:4175)
cd "$(dirname "$0")"
lsof -ti:4175 >/dev/null || (python3 -m http.server 4175 >/dev/null 2>&1 &)
sleep 1
open -a "Google Chrome" http://localhost:4175 2>/dev/null || open http://localhost:4175
