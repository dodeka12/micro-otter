param(
    [Parameter(Mandatory = $true)]
    [int]$Number,

    [Parameter(Mandatory = $true)]
    [string]$BodyFile,

    [string]$Repo
)

if (-not (Test-Path -Path $BodyFile -PathType Leaf)) {
    Write-Error "Body file not found: $BodyFile"
    exit 1
}

$resolvedBodyFile = Resolve-Path -Path $BodyFile

$ghArgs = @("pr", "edit", $Number.ToString(), "--body-file", $resolvedBodyFile)

if (-not [string]::IsNullOrWhiteSpace($Repo)) {
    $ghArgs += @("--repo", $Repo)
}

gh @ghArgs
exit $LASTEXITCODE