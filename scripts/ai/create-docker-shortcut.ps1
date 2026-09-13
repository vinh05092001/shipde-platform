<#
.SYNOPSIS
    Tạo shortcut Docker Desktop trong Startup của Windows để hỗ trợ môi trường sandbox container.
    TASK-AI-15
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"

try {
    $startupDir = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup')
    if (-not (Test-Path $startupDir)) {
        New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
    }

    $dest = [System.IO.Path]::Combine($startupDir, 'Docker Desktop.lnk')
    $dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

    if (Test-Path $dockerExe) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($dest)
        $shortcut.TargetPath = $dockerExe
        $shortcut.WorkingDirectory = 'C:\Program Files\Docker\Docker'
        $shortcut.Save()
        Write-Host "DOCKER SHORTCUT CREATED: $dest"
    } else {
        Write-Host "Docker Desktop executable not found at default path; skipping shortcut creation."
    }
} catch {
    Write-Warning "Could not create Docker shortcut: $($_.Exception.Message)"
}
