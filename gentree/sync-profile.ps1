<#
.SYNOPSIS
  Sync profiles and resources from karmifamily.com to the local folder.

.DESCRIPTION
  Downloads profile JSONs and all referenced resources (photos, documents, videos).
  Supports single profile, range of IDs, comma-separated IDs, or all profiles.

.EXAMPLE
  .\sync-profile.ps1 -ProfileFile 3
  .\sync-profile.ps1 -ProfileFile "Yehuda Carmi"
  .\sync-profile.ps1 -ProfileFile "יהודה כרמי"
  .\sync-profile.ps1 -ProfileFile "1-5"
  .\sync-profile.ps1 -ProfileFile "1,3,7"
  .\sync-profile.ps1 -ProfileFile all
  .\sync-profile.ps1 -ProfileFile all -SkipResources
  .\sync-profile.ps1 -ListAll
#>

param(
    [string]$ProfileFile,
    [switch]$ListAll,
    [switch]$SkipResources
)

$BaseUrl = "https://karmifamily.com/"
$LocalRoot = $PSScriptRoot

# List all available profiles from people.json
if ($ListAll) {
    $peopleJson = Get-Content -Path "$LocalRoot\assets\data\people.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "`nAvailable profiles:" -ForegroundColor Cyan
    Write-Host ""
    foreach ($person in $peopleJson.people) {
        $id = "$($person.id)".PadLeft(3)
        $nameEn = ([string]($person.nameEn ?? $person.name ?? $person.profileFile)).PadRight(30)
        Write-Host -NoNewline "  ${id}. " -ForegroundColor White
        Write-Host -NoNewline "$nameEn" -ForegroundColor Green
        Write-Host " $($person.profileFile)" -ForegroundColor Gray
    }
    Write-Host ""
    exit
}

if (-not $ProfileFile) {
    Write-Host "Usage: .\sync-profile.ps1 -ProfileFile '<name|id|range|list|all>'" -ForegroundColor Yellow
    Write-Host "       .\sync-profile.ps1 -ListAll" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile 3                 # single ID" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile 'Yehuda Carmi'    # English name" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile '1-5'             # range of IDs" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile '1,3,7'           # list of IDs" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile all               # all profiles" -ForegroundColor Gray
    Write-Host "  .\sync-profile.ps1 -ProfileFile all -SkipResources # all, JSON only" -ForegroundColor Gray
    exit
}

# Load people.json
$peopleJson = Get-Content -Path "$LocalRoot\assets\data\people.json" -Raw -Encoding UTF8 | ConvertFrom-Json

# Resolve input to list of person objects
function Resolve-People {
    param([string]$Query)

    # "all" - return everyone
    if ($Query -eq 'all') {
        return $peopleJson.people
    }

    # Comma-separated list of IDs: "1,3,7"
    if ($Query -match '^\d+(,\d+)+$') {
        $ids = $Query -split ',' | ForEach-Object { [int]$_ }
        $matched = $peopleJson.people | Where-Object { $ids -contains $_.id }
        return $matched
    }

    # Range of IDs: "1-5" (but not profileFile like "3-יהודה-כרמי")
    if ($Query -match '^\d+-\d+$') {
        $parts = $Query -split '-'
        $from = [int]$parts[0]
        $to = [int]$parts[1]
        $matched = $peopleJson.people | Where-Object { $_.id -ge $from -and $_.id -le $to }
        return $matched
    }

    # Single lookup: id, name, nameEn, or profileFile
    foreach ($person in $peopleJson.people) {
        if ("$($person.id)" -eq $Query -or
            $person.profileFile -eq $Query -or
            $person.name -eq $Query -or
            $person.nameEn -eq $Query) {
            return @($person)
        }
    }

    return @()
}

$matchedPeople = @(Resolve-People $ProfileFile)

if ($matchedPeople.Count -eq 0) {
    Write-Host "No person found matching '$ProfileFile'. Use -ListAll to see available profiles." -ForegroundColor Red
    exit 1
}

Write-Host "`nMatched $($matchedPeople.Count) profile(s) to sync." -ForegroundColor Cyan

function Download-File {
    param(
        [string]$Url,
        [string]$LocalPath
    )

    # Create directory if needed
    $dir = Split-Path -Parent $LocalPath
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # Skip if already exists
    if (Test-Path $LocalPath) {
        Write-Host "  [SKIP] Already exists: $LocalPath" -ForegroundColor DarkGray
        return $false
    }

    try {
        Invoke-WebRequest -Uri $Url -OutFile $LocalPath -UseBasicParsing
        Write-Host "  [OK]   $LocalPath" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "  [FAIL] $Url -> $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Collect all relative resource URLs from a profile object
function Get-ResourceUrls {
    param($obj, [string]$path = "")

    $urls = @()

    if ($null -eq $obj) { return $urls }

    if ($obj -is [string]) {
        # Check if it looks like a relative asset path
        if ($obj -match "^assets/" -and $obj -notmatch "^https?://") {
            $urls += $obj
        }
        return $urls
    }

    if ($obj -is [System.Collections.IEnumerable] -and $obj -isnot [string]) {
        foreach ($item in $obj) {
            $urls += Get-ResourceUrls $item "$path[]"
        }
        return $urls
    }

    if ($obj.PSObject -and $obj.PSObject.Properties) {
        foreach ($prop in $obj.PSObject.Properties) {
            $urls += Get-ResourceUrls $prop.Value "$path.$($prop.Name)"
        }
    }

    return $urls
}

# --- Main: sync each matched person ---

$totalDownloaded = 0
$totalSkipped = 0
$totalFailed = 0

foreach ($matchedPerson in $matchedPeople) {
    $pf = $matchedPerson.profileFile
    $displayName = ([string]($matchedPerson.nameEn ?? $matchedPerson.name ?? $pf))

    Write-Host "`n=== [$($matchedPerson.id)] $displayName ($pf) ===" -ForegroundColor Cyan

    # 1. Download the profile JSON
    $profileUrl = "${BaseUrl}assets/data/profiles/${pf}.json"
    $profileLocalDir = "$LocalRoot\assets\data\profiles"
    $profileLocalPath = "$profileLocalDir\${pf}.json"

    Write-Host "  Downloading profile JSON..." -ForegroundColor Yellow
    Download-File -Url $profileUrl -LocalPath $profileLocalPath

    if (-not (Test-Path $profileLocalPath)) {
        Write-Host "  Failed to download profile. Skipping." -ForegroundColor Red
        $totalFailed++
        continue
    }

    # 2. Parse profile and download resources
    if (-not $SkipResources) {
        $profile = Get-Content -Path $profileLocalPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $resourceUrls = Get-ResourceUrls $profile | Sort-Object -Unique

        if ($resourceUrls.Count -eq 0) {
            Write-Host "  No resource files found." -ForegroundColor DarkGray
        }
        else {
            Write-Host "  Found $($resourceUrls.Count) resource(s):" -ForegroundColor Yellow

            foreach ($relUrl in $resourceUrls) {
                $fullUrl = "$BaseUrl$relUrl"
                $localPath = Join-Path $LocalRoot ($relUrl -replace '/', '\')

                $result = Download-File -Url $fullUrl -LocalPath $localPath
                if ($result -eq $true) { $totalDownloaded++ }
                elseif ($result -eq $false -and (Test-Path $localPath)) { $totalSkipped++ }
                else { $totalFailed++ }
            }
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Total: $totalDownloaded downloaded, $totalSkipped skipped (existing), $totalFailed failed" -ForegroundColor Cyan
Write-Host "Done!`n" -ForegroundColor Green
