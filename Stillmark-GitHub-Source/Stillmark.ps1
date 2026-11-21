param(
    [ValidateSet('launch', 'package')]
    [string]$Action = 'launch'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Step {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program exited with code $LASTEXITCODE."
    }
}

function Find-Python312 {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        $resolved = & $launcher.Source -3.12-64 -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0) { return [string]$resolved }
    }
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path -LiteralPath $installed) { return $installed }
}

function Install-Tool {
    param([string]$Id)
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (!$winget) {
        throw "Windows Package Manager is required to install $Id. Install it or put the tool on PATH."
    }
    Invoke-Step $winget.Source @('install', '--exact', '--id', $Id, '--source', 'winget',
        '--accept-source-agreements', '--accept-package-agreements')
}

function Find-Npm {
    $onPath = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $installed = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (Test-Path -LiteralPath $installed) {
        $env:Path = (Split-Path -Parent $installed) + ';' + $env:Path
        return $installed
    }
}

try {
    $venv = Join-Path $PSScriptRoot '.venv'
    $python = Join-Path $venv 'Scripts\python.exe'
    if (!(Test-Path -LiteralPath $python)) {
        $python312 = Find-Python312
        if (!$python312) {
            Install-Tool 'Python.Python.3.12'
            $python312 = Find-Python312
        }
        Invoke-Step $python312 @('-m', 'venv', $venv)
    }
    if (!(Test-Path -LiteralPath '.venv\stillmark-1.0.0-ready')) {
        Invoke-Step $python @('-m', 'pip', 'install', '-r', 'requirements.txt')
        New-Item -ItemType File -Path '.venv\stillmark-1.0.0-ready' | Out-Null
    }
    if ($Action -eq 'package' -or !(Test-Path -LiteralPath 'ui\dist\index.html')) {
        $npm = Find-Npm
        if (!$npm) {
            Install-Tool 'OpenJS.NodeJS.LTS'
            $npm = Find-Npm
        }
        Push-Location -LiteralPath 'ui'
        try {
            if (!(Test-Path -LiteralPath 'node_modules\.bin\vite.cmd')) {
                Invoke-Step $npm @('ci', '--no-audit', '--no-fund')
            }
            Invoke-Step $npm @('run', 'build')
        } finally {
            Pop-Location
        }
    }
    if ($Action -eq 'package') {
        Invoke-Step $python @('-m', 'PyInstaller', '--noconfirm', '--distpath', 'release',
            '--workpath', '.build\packaging', 'Stillmark.spec')
        Copy-Item -LiteralPath 'README.md' -Destination 'release\Stillmark\README.md'
        Write-Host 'Built release\Stillmark\Stillmark.exe'
    } else {
        $pythonw = Join-Path $venv 'Scripts\pythonw.exe'
        Start-Process -FilePath $pythonw -ArgumentList ('"' + (Join-Path $PSScriptRoot 'main.py') + '"') -WindowStyle Hidden
    }
} catch {
    Write-Error $_
    exit 1
}
