<#
.SYNOPSIS
    Initialize the Pi Memory System for your project.

.DESCRIPTION
    This script sets up the Pi Memory System in your current project:
    1. Creates .pi/memory/ directory structure
    2. Copies template files for customization
    3. Installs the extension globally (first time only)
    4. Installs required Pi packages (pi-subagents, context-mode, pi-mcp-adapter)
    5. Creates the global core-prompt.md (first time only)

.PARAMETER ProjectDir
    Target project directory. Defaults to current directory.

.PARAMETER SkipExtension
    Skip extension installation (useful if already installed).

.PARAMETER SkipPackages
    Skip Pi package installation (useful if already installed).

.EXAMPLE
    .\scripts\init.ps1
    .\scripts\init.ps1 -ProjectDir "C:\MyProject"
    .\scripts\init.ps1 -SkipExtension
    .\scripts\init.ps1 -SkipPackages
#>

param(
    [string]$ProjectDir = (Get-Location).Path,
    [switch]$SkipExtension,
    [switch]$SkipPackages
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path $PSScriptRoot -Parent
$HomeDir = $env:USERPROFILE

Write-Host "🧠 Pi Memory System — Initializer" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# ---- Step 1: Create centralized project memory directories ----
Write-Host "[1/5] Creating project memory structure..." -ForegroundColor Yellow
$projectName = Split-Path $ProjectDir -Leaf
$projMemDir = Join-Path $HomeDir ".pi" "agent" "memory" "projects" $projectName
$projMemoriesDir = Join-Path $projMemDir "memories"
New-Item -ItemType Directory -Path (Join-Path $projMemoriesDir "events") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $projMemoriesDir "decisions") -Force | Out-Null
Write-Host "  ✅ $projMemDir" -ForegroundColor Green

# ---- Step 2: Copy template files to centralized location ----
Write-Host "[2/5] Copying template files..." -ForegroundColor Yellow
$templateDir = Join-Path $ScriptRoot "templates" "memories"

$templateFiles = @("facts.md", "preferences.md", "decisions.md", "events.md")
foreach ($file in $templateFiles) {
    $src = Join-Path $templateDir $file
    $dst = Join-Path $projMemoriesDir $file
    if (-not (Test-Path $dst)) {
        Copy-Item $src $dst
        Write-Host "  ✅ Created $dst" -ForegroundColor Green
    } else {
        Write-Host "  ⏭️  Skipped $file (already exists)" -ForegroundColor Gray
    }
}

# Copy notebook template
$notebookDst = Join-Path $projMemDir "notebook.md"
if (-not (Test-Path $notebookDst)) {
    $content = Get-Content (Join-Path $ScriptRoot "templates" "notebook.md") -Raw
    $content = $content -replace '\{\{PROJECT_NAME\}\}', $projectName
    $content = $content -replace '\{\{TIMESTAMP\}\}', (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    Set-Content -Path $notebookDst -Value $content
    Write-Host "  ✅ Created $notebookDst" -ForegroundColor Green
} else {
    Write-Host "  ⏭️  Skipped notebook.md (already exists)" -ForegroundColor Gray
}

# ---- Step 3: Install / update extension ----
if (-not $SkipExtension) {
    Write-Host "[3/5] Installing extension..." -ForegroundColor Yellow
    $extDir = Join-Path $HomeDir ".pi" "agent" "extensions"
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null

    # Copy all .ts extension files
    $srcDir = Join-Path $ScriptRoot "extensions"
    Get-ChildItem -Path $srcDir -Filter "*.ts" | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $extDir $_.Name) -Force
    }
    # Copy module directory
    $moduleSrc = Join-Path $srcDir "memory"
    $moduleDst = Join-Path $extDir "memory"
    if (Test-Path $moduleDst) { Remove-Item $moduleDst -Recurse -Force }
    Copy-Item $moduleSrc $moduleDst -Recurse -Force
    Write-Host "  ✅ Installed extension to $extDir" -ForegroundColor Green
} else {
    Write-Host "[3/5] Skipping extension installation (--SkipExtension)" -ForegroundColor Gray
}

# ---- Step 4: Install required Pi packages ----
if (-not $SkipPackages) {
    Write-Host "[4/5] Installing required Pi packages..." -ForegroundColor Yellow
    
    # Check if pi command is available
    $piCommand = Get-Command pi -ErrorAction SilentlyContinue
    if (-not $piCommand) {
        Write-Host "  ⚠️  'pi' command not found in PATH" -ForegroundColor Yellow
        Write-Host "  Please install Pi packages manually:" -ForegroundColor Yellow
        Write-Host "    pi install npm:pi-subagents" -ForegroundColor White
        Write-Host "    pi install npm:context-mode" -ForegroundColor White
        Write-Host "    pi install npm:pi-mcp-adapter" -ForegroundColor White
    } else {
        $packages = @("pi-subagents", "context-mode", "pi-mcp-adapter")
        foreach ($pkg in $packages) {
            Write-Host "  Installing $pkg..." -ForegroundColor White
            try {
                $output = & pi install "npm:$pkg" 2>&1
                Write-Host "  ✅ $pkg installed" -ForegroundColor Green
            } catch {
                Write-Host "  ⚠️  Failed to install $pkg (may already be installed)" -ForegroundColor Yellow
            }
        }
        Write-Host "  ✅ Pi packages installation complete" -ForegroundColor Green
    }
} else {
    Write-Host "[4/5] Skipping Pi package installation (--SkipPackages)" -ForegroundColor Gray
}

# ---- Step 5: Create global core-prompt (first time only) ----
Write-Host "[5/5] Setting up global core-prompt..." -ForegroundColor Yellow
$globalMemoryDir = Join-Path $HomeDir ".pi" "agent" "memory"
$globalPersonalDir = Join-Path $globalMemoryDir "personal"
New-Item -ItemType Directory -Path $globalPersonalDir -Force | Out-Null
# Create chunked subdirectories for global memory
New-Item -ItemType Directory -Path (Join-Path $globalPersonalDir "events") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $globalPersonalDir "decisions") -Force | Out-Null

$corePromptDst = Join-Path $globalMemoryDir "core-prompt.md"
if (-not (Test-Path $corePromptDst)) {
    Copy-Item (Join-Path $ScriptRoot "templates" "core-prompt.md") $corePromptDst
    Write-Host "  ✅ Created $corePromptDst" -ForegroundColor Green
    Write-Host "  ⚠️  EDIT THIS FILE to set your AI persona!" -ForegroundColor Magenta
} else {
    Write-Host "  ⏭️  Skipped core-prompt.md (already exists)" -ForegroundColor Gray
}

$rulesDst = Join-Path $globalMemoryDir "rules.md"
if (-not (Test-Path $rulesDst)) {
    Copy-Item (Join-Path $ScriptRoot "templates" "rules.md") $rulesDst
    Write-Host "  ✅ Created $rulesDst" -ForegroundColor Green
} else {
    Write-Host "  ⏭️  Skipped rules.md (already exists)" -ForegroundColor Gray
}

# Create empty global memory files
$globalFiles = @("facts.md", "preferences.md", "events.md")
foreach ($file in $globalFiles) {
    $path = Join-Path $globalPersonalDir $file
    if (-not (Test-Path $path)) {
        Set-Content -Path $path -Value "---`ntype: $($file -replace '.md','')`nupdated: $(Get-Date -Format 'yyyy-MM-dd')`n---`n`n# $((Get-Culture).TextInfo.ToTitleCase($file -replace '.md','')) — Global`n`n_This space for global (cross-project) memories._"
        Write-Host "  ✅ Created global $file" -ForegroundColor Green
    } else {
        Write-Host "  ⏭️  Skipped global $file (already exists)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "🎉 Memory system initialized!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Edit ~\.pi\agent\memory\core-prompt.md — set your AI persona" -ForegroundColor Yellow
Write-Host "  2. Edit .pi\memory\notebook.md — describe your current task" -ForegroundColor Yellow
Write-Host "  3. Restart Pi (or reload extensions) to activate" -ForegroundColor Yellow
Write-Host "  4. Start chatting — the AI will automatically write to memory!" -ForegroundColor Yellow
