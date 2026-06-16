#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Pi Memory System — Initializer (Unix/macOS)
# ============================================================
# Usage:
#   ./scripts/init.sh                    # init in current dir
#   ./scripts/init.sh /path/to/project   # init in specific dir
#   ./scripts/init.sh --skip-extension   # skip extension install
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${HOME}"
PROJECT_DIR="${1:-$(pwd)}"
SKIP_EXTENSION=false

# Handle --skip-extension flag
if [ "$1" = "--skip-extension" ]; then
    SKIP_EXTENSION=true
    PROJECT_DIR="$(pwd)"
fi
if [ "$2" = "--skip-extension" ] 2>/dev/null; then
    SKIP_EXTENSION=true
fi

echo "🧠 Pi Memory System — Initializer"
echo "================================="
echo ""

PROJECT_NAME="$(basename "$PROJECT_DIR")"

# ---- Step 1: Create centralized project memory directories ----
echo "[1/4] Creating project memory structure..."
PROJ_MEM_DIR="$HOME_DIR/.pi/agent/memory/projects/$PROJECT_NAME"
mkdir -p "$PROJ_MEM_DIR/memories/events"
mkdir -p "$PROJ_MEM_DIR/memories/decisions"
echo "  ✅ $PROJ_MEM_DIR/"

# ---- Step 2: Copy template files to centralized location ----
echo "[2/4] Copying template files..."
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

# ---- Step 3: Install / update extension ----
if [ "$SKIP_EXTENSION" = false ]; then
    echo "[3/4] Installing extension..."
    ext_dir="$HOME_DIR/.pi/agent/extensions"
    mkdir -p "$ext_dir"
    cp "$SCRIPT_DIR/extensions/memory.ts" "$ext_dir/memory.ts"
    rm -rf "$ext_dir/memory"
    cp -r "$SCRIPT_DIR/extensions/memory" "$ext_dir/memory"
    echo "  ✅ Installed extension to $ext_dir/memory.ts + memory/"
else
    echo "[3/4] Skipping extension installation (--skip-extension)"
fi

# ---- Step 4: Create global core-prompt (first time only) ----
echo "[4/4] Setting up global core-prompt..."
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
