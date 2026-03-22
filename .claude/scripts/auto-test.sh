#!/usr/bin/env bash
# ===========================================
# BigLot.ai Autonomous QA & Testing Loop v2
# ===========================================
# Usage: ./auto-test.sh
# Stop: Ctrl+C
# Config: MAX_RETRIES (default 3)
# ===========================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
mkdir -p "$LOG_DIR"

MAX_RETRIES="${MAX_RETRIES:-3}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/auto-test_${TIMESTAMP}.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=== BigLot.ai Auto-Test Loop v2 ==="
log "Max retries: $MAX_RETRIES"
log "Log: $LOG_FILE"
echo ""

cd "$FRONTEND_DIR"

# Step 1: Check current test state
TEST_OUTPUT=$(npm run test 2>&1) || true
echo "$TEST_OUTPUT" >> "$LOG_FILE"

ALL_PASS=false
if echo "$TEST_OUTPUT" | grep -q "Tests.*passed" && ! echo "$TEST_OUTPUT" | grep -q "Tests.*failed"; then
    ALL_PASS=true
fi

# Step 2: If failures, fix them first
if [ "$ALL_PASS" = false ]; then
    log "Test failures detected. Running fix loop..."
    for i in $(seq 1 "$MAX_RETRIES"); do
        log "Fix attempt $i / $MAX_RETRIES"
        cd "$PROJECT_ROOT"
        claude -p "Tests are failing. Run 'cd frontend && npm run test', read the failures carefully, fix the IMPLEMENTATION (not the tests), then re-run to verify. Do NOT delete or skip tests." \
            --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE"

        cd "$FRONTEND_DIR"
        TEST_OUTPUT=$(npm run test 2>&1) || true
        echo "$TEST_OUTPUT" >> "$LOG_FILE"

        if echo "$TEST_OUTPUT" | grep -q "Tests.*passed" && ! echo "$TEST_OUTPUT" | grep -q "Tests.*failed"; then
            log "All tests fixed!"
            ALL_PASS=true
            break
        fi
    done

    if [ "$ALL_PASS" = false ]; then
        log "Could not fix all failures after $MAX_RETRIES attempts. Manual review needed."
        exit 1
    fi
fi

# Step 3: All tests pass — run type check + build
log "All tests passing. Running type check..."
cd "$FRONTEND_DIR"
if ! npm run check 2>&1 | tee -a "$LOG_FILE"; then
    log "Type check failed. Asking Claude to fix..."
    cd "$PROJECT_ROOT"
    claude -p "Run 'cd frontend && npm run check'. Fix all TypeScript errors without changing logic. Then re-run to verify." \
        --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE"
fi

log "Running build..."
cd "$FRONTEND_DIR"
if ! npm run build 2>&1 | tee -a "$LOG_FILE"; then
    log "Build failed. Asking Claude to fix..."
    cd "$PROJECT_ROOT"
    claude -p "Run 'cd frontend && npm run build'. Fix all build errors. Then re-run to verify." \
        --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE"
fi

# Step 4: Improve coverage
log "All checks pass. Running coverage improvement..."
cd "$PROJECT_ROOT"
claude -p "Execute /test-loop. Focus on Step 4 (coverage audit) and Step 5 (edge cases)." \
    --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE"

log "Done."
