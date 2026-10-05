#!/bin/sh
# Runs one agent task on the iOS simulator:
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

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: ./run-task.sh \"<task>\"     e.g. ./run-task.sh \"Open Settings and open General\""
  exit 2
fi
SIMULATOR="${SIMULATOR:-iPhone 18 Pro}"
BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
MODEL_URL="${MODEL_URL:-http://127.0.0.1:8080}"
DERIVED="build"
RUN_DIR="runs/$(date +%Y%m%d-%H%M%S)"

# 1. Model server and backend must be up.
if ! curl -s -m 3 "$MODEL_URL/health" | grep -q '"ok"'; then
  echo "MAI-UI model server is not running at $MODEL_URL – start it first (run.txt step 1)."
  exit 1
fi
if ! curl -s -m 3 "$BACKEND_URL/api/health" | grep -q '"ok":true'; then
  echo "Backend is not running at $BACKEND_URL – start it first (run.txt step 2)."
  exit 1
fi

# 2. Use a booted simulator with that name, or boot one.
device_id() {
  xcrun simctl list devices "$1" | grep -F "    $SIMULATOR (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}
DEVICE="$(device_id booted)"
if [ -z "$DEVICE" ]; then
  DEVICE="$(device_id available)"
  if [ -z "$DEVICE" ]; then
    echo "No simulator named \"$SIMULATOR\". Available: xcrun simctl list devices available"
    exit 1
  fi
  echo "Booting $SIMULATOR…"
  xcrun simctl boot "$DEVICE" && xcrun simctl bootstatus "$DEVICE" -b >/dev/null
fi
open -a Simulator >/dev/null 2>&1

# 3. Build once; rebuild only when a source file is newer than the last build.
STAMP="$DERIVED/.built"
if [ ! -f "$STAMP" ] || [ -n "$(find AgentRunnerHost AgentRunnerUITests -name '*.swift' -newer "$STAMP" 2>/dev/null)" ]; then
  echo "Building the iOS runner (first time takes a minute)…"
  ruby generate-project.rb >/dev/null || exit 1
  if ! xcodebuild build-for-testing -project AgentRunner.xcodeproj -scheme AgentRunner \
        -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$DERIVED" -quiet >"$DERIVED-build.log" 2>&1; then
    echo "Build failed – see $DERIVED-build.log"
    exit 1
  fi
  touch "$STAMP"
fi

# 4. Run the task. TEST_RUNNER_* variables reach the test as AGENT_*.
mkdir -p "$RUN_DIR"
echo "Task: $TASK"
echo "Running on $SIMULATOR – please don't touch the simulator until it finishes."
TEST_RUNNER_AGENT_TASK="$TASK" \
TEST_RUNNER_AGENT_BACKEND_URL="$BACKEND_URL" \
TEST_RUNNER_AGENT_MAX_STEPS="${MAX_STEPS:-15}" \
TEST_RUNNER_AGENT_TIMEOUT_SECONDS="${TIMEOUT:-180}" \
TEST_RUNNER_AGENT_OUTPUT_DIR="$(pwd)/$RUN_DIR" \
xcodebuild test-without-building -project AgentRunner.xcodeproj -scheme AgentRunner \
  -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$DERIVED" \
  -only-testing:AgentRunnerUITests/AgentLoopTests -collect-test-diagnostics never 2>&1 \
  | tee "$RUN_DIR/xcodebuild.log" \
  | grep --line-buffered -E '^\[AGENT\]' | sed -l 's/^\[AGENT\] /  /'

# 5. Result. (test-without-building reports "TEST EXECUTE SUCCEEDED/FAILED".)
if grep -qE '\*\* TEST (EXECUTE )?SUCCEEDED' "$RUN_DIR/xcodebuild.log"; then
  echo "✅ Finished. Screenshot and summary: $RUN_DIR/"
  exit 0
fi
if grep -qE '\*\* TEST (EXECUTE )?FAILED' "$RUN_DIR/xcodebuild.log"; then
  echo "❌ Did not finish (see the reason above). Details: $RUN_DIR/"
else
  echo "❌ The runner did not start – see $RUN_DIR/xcodebuild.log"
fi
exit 1
