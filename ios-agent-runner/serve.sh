#!/bin/sh
# Starts the MobileUse Agent app on the iOS simulator and keeps the iOS runner
# waiting for tasks typed in it:
#
#   ./serve.sh
#
# Then type a task in the app and tap Run Agent. Each task's steps are printed here.
# Stop with Ctrl+C. Needs the MAI-UI model server (:8080) and backend (:4000) running.
#
# Optional settings:
#   SIMULATOR="iPhone 18 Pro"   which simulator to use
#   MAX_STEPS=15 TIMEOUT=180    limits per task
#   SERVE_MINUTES=240           how long to keep serving
set -u
cd "$(dirname "$0")"
. ./common.sh

check_servers
pick_simulator
build_if_needed

mkdir -p runs
LOG="runs/serve-$(date +%Y%m%d-%H%M%S).log"
echo "Opening MobileUse Agent on ${SIMULATOR}…"
echo "Type a task in the app and tap Run Agent. Don't touch the simulator while a task runs."
echo "Press Ctrl+C here to stop."
export TEST_RUNNER_AGENT_SERVE=1
export TEST_RUNNER_AGENT_BACKEND_URL="$BACKEND_URL"
export TEST_RUNNER_AGENT_MAX_STEPS="${MAX_STEPS:-15}"
export TEST_RUNNER_AGENT_TIMEOUT_SECONDS="${TIMEOUT:-180}"
export TEST_RUNNER_AGENT_SERVE_MINUTES="${SERVE_MINUTES:-240}"
run_tests AgentServeTests/testServe \
  | tee "$LOG" \
  | grep --line-buffered -E '^\[(SERVE|AGENT)\]' \
  | sed -l -e 's/^\[SERVE\] //' -e 's/^\[AGENT\] /  /'
echo "Runner stopped. Log: $LOG"
