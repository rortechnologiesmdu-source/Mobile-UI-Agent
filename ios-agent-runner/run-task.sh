#!/bin/sh
# Runs one agent task on the iOS simulator, straight from Terminal:
#
#   ./run-task.sh "Open Settings and open General"
#
# Needs the MAI-UI model server (:8080) and the Node backend (:4000) running on this
# Mac (see run.txt). Each step is printed live; the final screenshot, a run summary
# and the full log are saved under runs/<time>/.
#
# Optional settings:
#   SIMULATOR="iPhone 18 Pro"   which simulator to use
#   MAX_STEPS=15                step limit
#   TIMEOUT=180                 time limit in seconds
set -u
cd "$(dirname "$0")"
. ./common.sh

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: ./run-task.sh \"<task>\"     e.g. ./run-task.sh \"Open Settings and open General\""
  exit 2
fi
RUN_DIR="runs/$(date +%Y%m%d-%H%M%S)"

check_servers
pick_simulator
build_if_needed

mkdir -p "$RUN_DIR"
echo "Task: $TASK"
echo "Running on $SIMULATOR – please don't touch the simulator until it finishes."
export TEST_RUNNER_AGENT_TASK="$TASK"
export TEST_RUNNER_AGENT_BACKEND_URL="$BACKEND_URL"
export TEST_RUNNER_AGENT_MAX_STEPS="${MAX_STEPS:-15}"
export TEST_RUNNER_AGENT_TIMEOUT_SECONDS="${TIMEOUT:-180}"
export TEST_RUNNER_AGENT_OUTPUT_DIR="$(pwd)/$RUN_DIR"
run_tests AgentLoopTests \
  | tee "$RUN_DIR/xcodebuild.log" \
  | grep --line-buffered -E '^\[AGENT\]' | sed -l 's/^\[AGENT\] /  /'

if tests_passed "$RUN_DIR/xcodebuild.log"; then
  echo "✅ Finished. Screenshot and summary: $RUN_DIR/"
  exit 0
fi
if grep -qE '\*\* TEST (EXECUTE )?FAILED' "$RUN_DIR/xcodebuild.log"; then
  echo "❌ Did not finish (see the reason above). Details: $RUN_DIR/"
else
  echo "❌ The runner did not start – see $RUN_DIR/xcodebuild.log"
fi
exit 1
