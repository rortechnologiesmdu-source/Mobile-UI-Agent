# Shared by run-task.sh and serve.sh (sourced, not run directly).
#
# Settings (environment):
#   SIMULATOR="iPhone 18 Pro"   which simulator to use
#   BACKEND_URL / MODEL_URL     where the backend and MAI-UI server run

SIMULATOR="${SIMULATOR:-iPhone 18 Pro}"
BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
MODEL_URL="${MODEL_URL:-http://127.0.0.1:8080}"
DERIVED="build"

# The MAI-UI model server and the backend must both be up.
check_servers() {
  if ! curl -s -m 3 "$MODEL_URL/health" | grep -q '"ok"'; then
    echo "MAI-UI model server is not running at $MODEL_URL – start it first (run.txt step 1)."
    exit 1
  fi
  if ! curl -s -m 3 "$BACKEND_URL/api/health" | grep -q '"ok":true'; then
    echo "Backend is not running at $BACKEND_URL – start it first (run.txt step 2)."
    exit 1
  fi
}

# Sets DEVICE to a booted simulator named $SIMULATOR, booting one if needed.
pick_simulator() {
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
    echo "Booting ${SIMULATOR}…"
    xcrun simctl boot "$DEVICE" && xcrun simctl bootstatus "$DEVICE" -b >/dev/null
  fi
  open -a Simulator >/dev/null 2>&1
}

# Builds the app and runner once; rebuilds only when a source file is newer.
build_if_needed() {
  STAMP="$DERIVED/.built"
  if [ ! -f "$STAMP" ] || [ -n "$(find AgentRunnerHost AgentRunnerUITests Shared \( -name '*.swift' -o -name '*.plist' \) -newer "$STAMP" 2>/dev/null)" ]; then
    echo "Building the iOS app and runner (takes a minute)…"
    ruby generate-project.rb >/dev/null || exit 1
    if ! xcodebuild build-for-testing -project AgentRunner.xcodeproj -scheme AgentRunner \
          -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$DERIVED" -quiet >"$DERIVED-build.log" 2>&1; then
      echo "Build failed – see $DERIVED-build.log"
      exit 1
    fi
    mkdir -p "$DERIVED" && touch "$STAMP"
  fi
}

# Runs one test class with TEST_RUNNER_* settings already exported by the caller.
run_tests() {
  xcodebuild test-without-building -project AgentRunner.xcodeproj -scheme AgentRunner \
    -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$DERIVED" \
    -only-testing:"AgentRunnerUITests/$1" -collect-test-diagnostics never 2>&1
}

# True when the xcodebuild log in $1 reports success.
tests_passed() {
  grep -qE '\*\* TEST (EXECUTE )?SUCCEEDED' "$1"
}
