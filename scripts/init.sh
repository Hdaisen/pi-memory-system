#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Pi Memory System — Initializer (Unix/macOS)
# ============================================================
# Usage:
#   ./scripts/init.sh                    # init in current dir
#   ./scripts/init.sh /path/to/project   # init in specific dir
#   ./scripts/init.sh --skip-extension   # skip extension install
#   ./scripts/init.sh --skip-packages    # skip Pi package check
#   ./scripts/init.sh --with-extras      # also install auto/ocr/token-tracker extras
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${HOME}"
PROJECT_DIR="${1:-$(pwd)}"
SKIP_EXTENSION=false
SKIP_PACKAGES=false
WITH_EXTRAS=false

# Handle flags
for arg in "$@"; do
    case "$arg" in
        --skip-extension) SKIP_EXTENSION=true ;;
        --skip-packages) SKIP_PACKAGES=true ;;
        --with-extras) WITH_EXTRAS=true ;;
    esac
done
# If first arg is a flag, use pwd as project dir
if [[ "${1:-}" == --* ]]; then
    PROJECT_DIR="$(pwd)"
fi

echo "🧠 Pi Memory System — Initializer"
echo "================================="
echo ""

PROJECT_NAME="$(basename "$PROJECT_DIR")"

# ---- Step 1: Create centralized project memory directories ----
echo "[1/5] Creating project memory structure..."
PROJ_MEM_DIR="$HOME_DIR/.pi/agent/memory/projects/$PROJECT_NAME"
mkdir -p "$PROJ_MEM_DIR/memories/events"
mkdir -p "$PROJ_MEM_DIR/memories/decisions"
echo "  ✅ $PROJ_MEM_DIR/"

# ---- Step 2: Copy template files to centralized location ----
echo "[2/5] Copying template files..."
for file in facts.md preferences.md decisions.md events.md; do
    dst="$PROJ_MEM_DIR/memories/$file"
    if [ ! -f "$dst" ]; then
        cp "$SCRIPT_DIR/templates/memories/$file" "$dst"
        echo "  ✅ Created $dst"
    else
        echo "  ⏭️  Skipped $file (already exists)"
    fi
done

# Copy notebook template
notebook_dst="$PROJ_MEM_DIR/notebook.md"
if [ ! -f "$notebook_dst" ]; then
    sed -e "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" \
        -e "s/{{TIMESTAMP}}/$(date -u +%Y-%m-%dT%H:%M:%SZ)/g" \
        "$SCRIPT_DIR/templates/notebook.md" > "$notebook_dst"
    echo "  ✅ Created $notebook_dst"
else
    echo "  ⏭️  Skipped notebook.md (already exists)"
fi

# ---- Step 3: Install / update core extension ----
if [ "$SKIP_EXTENSION" = false ]; then
    echo "[3/5] Installing core extension..."
    ext_dir="$HOME_DIR/.pi/agent/extensions"
    mkdir -p "$ext_dir"
    # Core: memory.ts + memory/ module (memory system, zero extra package deps)
    cp "$SCRIPT_DIR/extensions/memory.ts" "$ext_dir/"
    rm -rf "$ext_dir/memory"
    cp -r "$SCRIPT_DIR/extensions/memory" "$ext_dir/memory"
    # Extras (optional): auto / ocr / token-tracker — only with --with-extras
    if [ "$WITH_EXTRAS" = true ]; then
        for extra in auto.ts ocr.ts token-tracker.ts; do
            if [ -f "$SCRIPT_DIR/extensions/$extra" ]; then
                cp "$SCRIPT_DIR/extensions/$extra" "$ext_dir/"
            fi
        done
        echo "  ✅ Core + extra extensions installed to $ext_dir/"
        echo "  ⚠️  extras deps: auto → @ifi/pi-spec, ocr → PaddleOCR (system), token-tracker → none"
    else
        echo "  ✅ Core extension installed to $ext_dir/"
        echo "  ℹ️  Extra extensions (auto/ocr/token-tracker) skipped — use --with-extras to include"
    fi
else
    echo "[3/5] Skipping extension installation (--skip-extension)"
fi

# ---- Step 4: Optional Pi packages (list only, never force-install) ----
if [ "$SKIP_PACKAGES" = false ]; then
    echo "[4/5] Checking optional Pi packages..."
    echo "  ℹ️  Memory system core has ZERO required packages (pi CLI + python3 only)."

    # Check if pi command is available
    if ! command -v pi &> /dev/null; then
        echo "  ⚠️  'pi' command not found in PATH — skip package check"
        echo "  ℹ️  Optional packages you may want (not required):"
        echo "    pi install npm:pi-subagents   # subagent tool for the main LLM"
        echo "    pi install npm:@ifi/pi-spec   # spec-driven dev (needed by auto.ts extra)"
    else
        INSTALLED=$(pi list 2>&1 || true)
        check_optional() {
            local name="$1" spec="$2" note="$3"
            if echo "$INSTALLED" | grep -qi "$name"; then
                echo "  ✅ $name — installed"
            else
                echo "  ⏭️  $name — NOT installed ($note)"
                echo "       pi install $spec"
            fi
        }
        check_optional "pi-subagents" "npm:pi-subagents" "subagent tool for the main LLM"
        check_optional "@ifi/pi-spec" "npm:@ifi/pi-spec" "spec-driven dev (needed by auto.ts extra)"
        check_optional "context-mode" "npm:context-mode" "context compression"
        echo "  ℹ️  These are OPTIONAL — the memory system works without them."
    fi
else
    echo "[4/5] Skipping Pi package check (--skip-packages)"
fi

# ---- Step 5: Create global core-prompt (first time only) ----
echo "[5/5] Setting up global core-prompt..."
global_memory_dir="$HOME_DIR/.pi/agent/memory"
global_personal_dir="$HOME_DIR/.pi/agent/memory/personal"
mkdir -p "$global_personal_dir"
mkdir -p "$global_personal_dir/events"
mkdir -p "$global_personal_dir/decisions"

core_prompt_dst="$global_memory_dir/core-prompt.md"
if [ ! -f "$core_prompt_dst" ]; then
    cp "$SCRIPT_DIR/templates/core-prompt.md" "$core_prompt_dst"
    echo "  ✅ Created $core_prompt_dst"
    echo "  ⚠️  EDIT THIS FILE to set your AI persona!"
else
    echo "  ⏭️  Skipped core-prompt.md (already exists)"
fi

rules_dst="$global_memory_dir/rules.md"
if [ ! -f "$rules_dst" ]; then
    cp "$SCRIPT_DIR/templates/rules.md" "$rules_dst"
    echo "  ✅ Created $rules_dst"
else
    echo "  ⏭️  Skipped rules.md (already exists)"
fi

# Create empty global memory files
for file in facts.md preferences.md events.md; do
    path="$global_personal_dir/$file"
    if [ ! -f "$path" ]; then
        category="${file%.md}"
        cat > "$path" << FILEEOF
---
type: $category
updated: $(date +%Y-%m-%d)
---

# $(echo "$category" | sed 's/^\(.\)/\U\1/') — Global

_This space for global (cross-project) memories._
FILEEOF
        echo "  ✅ Created global $file"
    else
        echo "  ⏭️  Skipped global $file (already exists)"
    fi
done

echo ""
echo "🎉 Memory system initialized!"
echo ""
echo "Next steps:"
echo "  1. Edit ~/.pi/agent/memory/core-prompt.md — set your AI persona"
echo "  2. Edit .pi/memory/notebook.md — describe your current task"
echo "  3. Restart Pi (or reload extensions) to activate"
echo "  4. Start chatting — the AI will automatically write to memory!"
