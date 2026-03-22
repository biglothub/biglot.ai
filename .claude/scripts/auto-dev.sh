#!/usr/bin/env bash
# ===========================================
# BigLot.ai Autonomous Development Loop v2
# ===========================================
# Usage: ./auto-dev.sh [task-id]
#   No args = auto-pick next pending task
#   With ID = work on specific task (e.g., ./auto-dev.sh T-1103)
#
# Stop: Ctrl+C
# Config env vars:
#   MAX_TASKS=5          (max tasks per session, default 5)
#   PAUSE_SECONDS=10     (pause between tasks, default 10)
# ===========================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
TASKS_FILE="$PROJECT_ROOT/TASKS.md"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
mkdir -p "$LOG_DIR"

TASK_ID="${1:-}"
MAX_TASKS="${MAX_TASKS:-5}"
PAUSE_SECONDS="${PAUSE_SECONDS:-10}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/auto-dev_${TIMESTAMP}.log"

tasks_done=0
consecutive_failures=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

rollback() {
    local checkpoint="$1"
    log "Rolling back to $checkpoint"
    cd "$PROJECT_ROOT"
    # Only reset tracked files — do NOT use git clean (it deletes .claude/ scripts)
    git checkout -- .
    git reset --hard "$checkpoint"
}

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  BigLot.ai Auto-Dev Loop v2"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Project:    $PROJECT_ROOT"
log "Max tasks:  $MAX_TASKS"
log "Task ID:    ${TASK_ID:-auto-pick}"
log "Log:        $LOG_FILE"
log "Stop:       Ctrl+C"
echo ""

# Pre-flight: verify tests pass before starting
log "Pre-flight: running tests..."
cd "$FRONTEND_DIR"
if npm run test 2>&1 | tail -5 | tee -a "$LOG_FILE"; then
    log "Pre-flight OK"
else
    log "WARNING: some tests failing before start"
fi
echo ""

# Main loop
while [ $tasks_done -lt $MAX_TASKS ]; do
    log ""
    log "━━━ Task $(( tasks_done + 1 )) / $MAX_TASKS | Done: $tasks_done ━━━"

    cd "$PROJECT_ROOT"

    # Git checkpoint before each task
    CHECKPOINT=$(git rev-parse HEAD)
    log "Checkpoint: $CHECKPOINT"

    # Build prompt
    if [ -n "$TASK_ID" ]; then
        PROMPT="Execute /dev-loop for task $TASK_ID. Work on exactly ONE task, then STOP."
    else
        PROMPT="Execute /dev-loop. Work on exactly ONE task, then STOP."
    fi

    # Run Claude with full permissions for autonomous mode
    log "Running claude..."
    claude -p "$PROMPT" --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE" || true
    EXIT_CODE=${PIPESTATUS[0]:-$?}

    if [ $EXIT_CODE -ne 0 ]; then
        consecutive_failures=$((consecutive_failures + 1))
        log "ERROR: Claude exited with code $EXIT_CODE (failure #$consecutive_failures)"

        if [ $consecutive_failures -ge 3 ]; then
            log "Too many consecutive failures. Stopping."
            break
        fi

        WAIT=$((60 * consecutive_failures))
        log "Waiting ${WAIT}s before retry..."
        sleep $WAIT
        continue
    fi

    # Quality gates: verify tests + types + build
    log "Quality gate: tests..."
    cd "$FRONTEND_DIR"
    if ! npm run test 2>&1 | tee -a "$LOG_FILE" | tail -5; then
        log "QUALITY GATE FAILED: tests"
        rollback "$CHECKPOINT"
        consecutive_failures=$((consecutive_failures + 1))
        continue
    fi

    log "Quality gate: type check..."
    if ! npm run check 2>&1 | tee -a "$LOG_FILE" | tail -5; then
        log "QUALITY GATE FAILED: type-check"
        rollback "$CHECKPOINT"
        consecutive_failures=$((consecutive_failures + 1))
        continue
    fi

    log "Quality gate: build..."
    if ! npm run build 2>&1 | tee -a "$LOG_FILE" | tail -5; then
        log "QUALITY GATE FAILED: build"
        rollback "$CHECKPOINT"
        consecutive_failures=$((consecutive_failures + 1))
        continue
    fi

    # All gates passed
    consecutive_failures=0
    tasks_done=$((tasks_done + 1))
    log "Task completed and verified! Total: $tasks_done"

    # Check if all tasks are done
    if ! grep -q '^\- \[ \]' "$TASKS_FILE" 2>/dev/null; then
        log "No more pending tasks!"
        break
    fi

    # Clear task ID after first iteration (auto-pick next)
    TASK_ID=""

    log "Pausing ${PAUSE_SECONDS}s..."
    sleep "$PAUSE_SECONDS"
done

# Summary
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Session Complete"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Tasks done: $tasks_done"
log "Log:        $LOG_FILE"
log ""
log "Next steps:"
log "  cat TASKS.md                     # check progress"
log "  git log --oneline -10            # see commits"
log "  .claude/scripts/auto-dev.sh      # run again"
