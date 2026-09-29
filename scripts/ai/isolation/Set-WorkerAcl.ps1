[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$false)]
    [string]$Username = "ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$OperatorProfile = $env:USERPROFILE,

    [Parameter(Mandatory=$false)]
    [string]$WorkerRoot = "C:\ShipDeWorker"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    Write-Host "[Set-WorkerAcl] $Message"
}

if (-not (Get-LocalUser -Name $Username -ErrorAction SilentlyContinue)) {
    Write-Warning "User $Username does not exist. ACLs may fail to apply."
}

# 1. Deny access to Operator Profile
Write-Log "Applying Deny rules to Operator Profile: $OperatorProfile"
if ($PSCmdlet.ShouldProcess($OperatorProfile, "Deny Read/Write for $Username")) {
    $acl = Get-Acl $OperatorProfile
    $denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $Username,
        "FullControl",
        "ContainerInherit, ObjectInherit",
        "None",
        "Deny"
    )
    $acl.AddAccessRule($denyRule)
    Set-Acl -Path $OperatorProfile -AclObject $acl
    Write-Log "Applied Deny rule on $OperatorProfile"
}

# 2. Grant Modify access to Worker Root
Write-Log "Setting up Worker Root: $WorkerRoot"
if ($PSCmdlet.ShouldProcess($WorkerRoot, "Create directory and grant Modify for $Username")) {
    if (-not (Test-Path $WorkerRoot)) {
        New-Item -ItemType Directory -Path $WorkerRoot | Out-Null
    }

    $acl = Get-Acl $WorkerRoot
    $allowRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $Username,
        "Modify",
        "ContainerInherit, ObjectInherit",
        "None",
        "Allow"
    )
    $acl.AddAccessRule($allowRule)

    $operatorOwner = (Get-Acl $OperatorProfile).Owner
    $operatorRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $operatorOwner,
        "Modify",
        "ContainerInherit, ObjectInherit",
        "None",
        "Allow"
    )
    $acl.AddAccessRule($operatorRule)

    Set-Acl -Path $WorkerRoot -AclObject $acl
    Write-Log "Applied Modify rule on $WorkerRoot"
}

Write-Log "Done."
