$dest = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup\Docker Desktop.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($dest)
$shortcut.TargetPath = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$shortcut.WorkingDirectory = 'C:\Program Files\Docker\Docker'
$shortcut.Save()
Write-Host "DOCKER SHORTCUT CREATED: $dest"
