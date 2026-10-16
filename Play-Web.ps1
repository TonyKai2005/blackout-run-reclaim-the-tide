$webRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gameUrl = 'http://127.0.0.1:4173'
$profilePath = Join-Path $webRoot '.cache\edge-game-profile'

if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'dist\index.html'))) {
    Write-Error 'The built game is missing. In this Web folder, run npm install and npm run build.'
    exit 1
}

$edgeCandidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
    Write-Error 'Microsoft Edge was not found. Run node server.mjs and open http://127.0.0.1:4173 in a desktop browser.'
    exit 1
}

New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$server = Start-Process -FilePath $nodeExe -ArgumentList 'server.mjs' -WorkingDirectory $webRoot -PassThru -WindowStyle Hidden

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 35; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $gameUrl -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 150 }
    }
    if (-not $ready) { throw 'Local game server did not start.' }

    $browser = Start-Process -FilePath $edge -ArgumentList @("--user-data-dir=$profilePath", '--no-first-run', "--app=$gameUrl") -PassThru
    Write-Host 'Game launched. Close the game window to stop its local server.'
    Wait-Process -Id $browser.Id
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
}
