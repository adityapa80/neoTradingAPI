# Copies the server's nightly backups (.env + TP/SL records) to this PC, so a copy
# exists outside your VPS provider. Run manually, or schedule it (see deploy/DEPLOY.md).
param([Parameter(Mandatory = $true)][string]$Server)

$dest = Join-Path $env:USERPROFILE "neo-terminal-backups"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
scp -q "root@${Server}:/root/backups/neo-*.tgz" $dest
if ($LASTEXITCODE -eq 0) {
    Get-ChildItem $dest -Filter "neo-*.tgz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item
    Write-Host "Backups copied to $dest"
} else {
    Write-Host "Backup copy failed (is the server reachable and has a backup run yet?)"
}
