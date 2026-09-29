[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$false)]
    [string]$Username = "ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$AllowlistFile = ""
)

if (-not $AllowlistFile) {
    if ($PSScriptRoot) {
        $AllowlistFile = "$PSScriptRoot\..\..\..\model-endpoints.txt"
    } else {
        $AllowlistFile = "model-endpoints.txt"
    }
}

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    Write-Host "[Set-WorkerFirewall] $Message"
}

$User = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
if (-not $User) {
    Write-Warning "User $Username does not exist. Using username string, but SID resolution might fail."
    $Sid = $Username
} else {
    $Sid = $User.SID.Value
}

$RulePrefix = "ShipDe-Worker-$Username"

Write-Log "Cleaning up old rules with prefix '$RulePrefix'..."
if ($PSCmdlet.ShouldProcess("Old Firewall Rules", "Remove rules")) {
    Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

function IP-ToUInt32([string]$ipStr) {
    $ip = [System.Net.IPAddress]::Parse($ipStr)
    $bytes = $ip.GetAddressBytes()
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    return [BitConverter]::ToUInt32($bytes, 0)
}

function UInt32-ToIP([uint32]$uint32) {
    $bytes = [BitConverter]::GetBytes($uint32)
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    return ([System.Net.IPAddress]$bytes).ToString()
}

$allowedIps = @("127.0.0.1")

if (Test-Path $AllowlistFile) {
    Write-Log "Reading model endpoints from $AllowlistFile..."
    $endpoints = Get-Content $AllowlistFile | Where-Object { $_.Trim() -ne "" -and -not $_.StartsWith("#") }
    foreach ($endpoint in $endpoints) {
        try {
            $ips = (Resolve-DnsName -Name $endpoint -ErrorAction Stop | Where-Object Type -eq 'A').IPAddress
            if ($ips) {
                $allowedIps += $ips
                Write-Log "Allowed IPs for ${endpoint}: $($ips -join ', ')"
            }
        } catch {
            Write-Warning "Failed to resolve ${endpoint}: $_"
        }
    }
}

$allowedUints = $allowedIps | ForEach-Object { IP-ToUInt32 $_ } | Sort-Object -Unique

$blockedRanges = @()
$current = 0
foreach ($ipNum in $allowedUints) {
    if ($current -lt $ipNum) {
        $startIp = UInt32-ToIP $current
        $endIp = UInt32-ToIP ($ipNum - 1)
        $blockedRanges += "$startIp-$endIp"
    }
    $current = $ipNum + 1
}
if ($current -le 4294967295) {
    $startIp = UInt32-ToIP $current
    $endIp = "255.255.255.255"
    $blockedRanges += "$startIp-$endIp"
}

Write-Log "Setting outbound default-deny using inverted IP ranges for TCP..."
if ($PSCmdlet.ShouldProcess("Firewall", "Create outbound Block TCP for $Username")) {
    # Block IPv4 ranges
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-TCP-IPv4" -Direction Outbound -Action Block -LocalUser $Sid -Protocol TCP -RemoteAddress $blockedRanges -Profile Any -ErrorAction Stop | Out-Null
    # Block all IPv6 except localhost
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-TCP-IPv6-1" -Direction Outbound -Action Block -LocalUser $Sid -Protocol TCP -RemoteAddress "::-::0" -Profile Any -ErrorAction Stop | Out-Null
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-TCP-IPv6-2" -Direction Outbound -Action Block -LocalUser $Sid -Protocol TCP -RemoteAddress "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" -Profile Any -ErrorAction Stop | Out-Null
    # Restrict allowed endpoints to port 443 by blocking all other TCP ports
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-TCP-Ports" -Direction Outbound -Action Block -LocalUser $Sid -Protocol TCP -RemotePort "0-442", "444-65535" -Profile Any -ErrorAction Stop | Out-Null
    Write-Log "Created TCP block rules."
}

Write-Log "Setting outbound UDP port block (blocking ALL UDP)..."
if ($PSCmdlet.ShouldProcess("Firewall", "Create outbound Block UDP for $Username")) {
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-UDP" -Direction Outbound -Action Block -LocalUser $Sid -Protocol UDP -Profile Any -ErrorAction Stop | Out-Null
    Write-Log "Created UDP block rules."
}

# Accepted residual: non-TCP/UDP protocols (e.g. ICMP) are unrestricted under default allow, but the worker is unprivileged and cannot use raw sockets anyway.
if ($PSCmdlet.ShouldProcess("Firewall", "Create outbound Block ICMP for $Username")) {
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-ICMPv4" -Direction Outbound -Action Block -LocalUser $Sid -Protocol ICMPv4 -Profile Any -ErrorAction Stop | Out-Null
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-ICMPv6" -Direction Outbound -Action Block -LocalUser $Sid -Protocol ICMPv6 -Profile Any -ErrorAction Stop | Out-Null
}

Write-Log "Explicitly blocking GitHub and SSH..."
if ($PSCmdlet.ShouldProcess("Firewall", "Create block rules for GitHub and SSH ports")) {
    try {
        $githubIps = (Resolve-DnsName -Name "github.com" -ErrorAction SilentlyContinue | Where-Object Type -match 'A|AAAA').IPAddress
        $apiIps = (Resolve-DnsName -Name "api.github.com" -ErrorAction SilentlyContinue | Where-Object Type -match 'A|AAAA').IPAddress
        $allBlockIps = @($githubIps; $apiIps) | Select-Object -Unique

        if ($allBlockIps) {
            New-NetFirewallRule -DisplayName "$RulePrefix-Block-GitHub-IPs" -Direction Outbound -Action Block -LocalUser $Sid -RemoteAddress $allBlockIps -Profile Any -ErrorAction Stop | Out-Null
            Write-Log "Blocked GitHub IPs: $($allBlockIps -join ', ')"
        }
    } catch {
        Write-Warning "Failed to resolve GitHub IPs: $_"
    }

    # Block outbound port 22 globally for this user just to be sure
    New-NetFirewallRule -DisplayName "$RulePrefix-Block-SSH" -Direction Outbound -Action Block -LocalUser $Sid -RemotePort 22 -Protocol TCP -Profile Any -ErrorAction Stop | Out-Null
    Write-Log "Blocked outbound SSH (port 22) for user."
}

Write-Log "Done."
