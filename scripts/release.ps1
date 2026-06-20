# release.ps1 - Crea una release en GitHub y sube client-patch.zip
# Uso: .\release.ps1 -Token "ghp_xxxx"
# Necesita un GitHub Personal Access Token con permisos: contents:write

param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$Repo    = "FRACTAL-GAME-STUDIOS/skymp-launcher"
$TagName = "client-v1"
$ZipPath = Join-Path $PSScriptRoot "client-patch.zip"

$Headers = @{
    Authorization = "Bearer $Token"
    Accept        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

Write-Host "[ 1/3 ] Comprobando si la release '$TagName' ya existe..." -ForegroundColor Cyan
$existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$TagName" `
    -Headers $Headers -Method Get -ErrorAction SilentlyContinue

if ($existing) {
    Write-Host "  Release ya existe (id=$($existing.id)), eliminando para recrear..." -ForegroundColor Yellow
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/$($existing.id)" `
        -Headers $Headers -Method Delete | Out-Null
    # Borrar el tag tambien
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/git/refs/tags/$TagName" `
        -Headers $Headers -Method Delete -ErrorAction SilentlyContinue | Out-Null
}

Write-Host "[ 2/3 ] Creando release '$TagName'..." -ForegroundColor Cyan
$body = @{
    tag_name   = $TagName
    name       = "FRACTAL RP Client Patch"
    body       = "Cliente SkyMP personalizado para FRACTAL RP. Incluye parches para HUD, offlineMode y chat."
    prerelease = $false
    draft      = $false
} | ConvertTo-Json

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" `
    -Headers $Headers -Method Post -Body $body -ContentType "application/json"

Write-Host "  Release creada: $($release.html_url)" -ForegroundColor Green

Write-Host "[ 3/3 ] Subiendo client-patch.zip..." -ForegroundColor Cyan
$uploadUrl = $release.upload_url -replace "\{\?name,label\}", "?name=client-patch.zip"
$zipBytes  = [System.IO.File]::ReadAllBytes($ZipPath)

Invoke-RestMethod -Uri $uploadUrl -Headers $Headers -Method Post `
    -Body $zipBytes -ContentType "application/zip" | Out-Null

Write-Host ""
Write-Host "  [OK] client-patch.zip subido correctamente." -ForegroundColor Green
Write-Host "  URL de descarga:" -ForegroundColor White
Write-Host "  https://github.com/$Repo/releases/download/$TagName/client-patch.zip" -ForegroundColor Cyan
