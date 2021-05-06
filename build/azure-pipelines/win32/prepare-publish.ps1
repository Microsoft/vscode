. build/azure-pipelines/win32/exec.ps1
$ErrorActionPreference = "Stop"

$Arch = "$env:VSCODE_ARCH"

exec { yarn gulp "vscode-win32-$Arch-archive" "vscode-win32-$Arch-system-setup" "vscode-win32-$Arch-user-setup" --sign }

$Repo = "$(pwd)"
$Root = "$Repo\.."
$SystemExe = "$Repo\.build\win32-$Arch\system-setup\VSCodeSetup.exe"
$UserExe = "$Repo\.build\win32-$Arch\user-setup\VSCodeSetup.exe"
$Zip = "$Repo\.build\win32-$Arch\archive\VSCode-win32-$Arch.zip"
$LegacyServer = "$Root\vscode-reh-win32-$Arch"
$Server = "$Root\vscode-server-win32-$Arch"
$ServerZip = "$Repo\.build\vscode-server-win32-$Arch.zip"
$LegacyWeb = "$Root\vscode-reh-web-win32-$Arch"
$Web = "$Root\vscode-server-win32-$Arch-web"
$WebZip = "$Repo\.build\vscode-server-win32-$Arch-web.zip"
$Build = "$Root\VSCode-win32-$Arch"

# Create server archive
if ("$Arch" -ne "arm64") {
	exec { xcopy $LegacyServer $Server /H /E /I }
	exec { .\node_modules\7zip\7zip-lite\7z.exe a -tzip $ServerZip $Server -r }
	exec { xcopy $LegacyWeb $Web /H /E /I }
	exec { .\node_modules\7zip\7zip-lite\7z.exe a -tzip $WebZip $Web -r }
}

# get version
$PackageJson = Get-Content -Raw -Path "$Build\resources\app\package.json" | ConvertFrom-Json
$Version = $PackageJson.version

$AssetPlatform = if ("$Arch" -eq "ia32") { "win32" } else { "win32-$Arch" }

$ARCHIVE_NAME = "VSCode-win32-$Arch-$Version.zip"
$SYSTEM_SETUP_NAME = "VSCodeSetup-$Arch-$Version.exe"
$USER_SETUP_NAME = "VSCodeUserSetup-$Arch-$Version.exe"

# Set variables for upload
Move-Item $Zip "$Repo\.build\win32-$Arch\archive\$ARCHIVE_NAME"
Write-Host "##vso[task.setvariable variable=ARCHIVE_NAME]$ARCHIVE_NAME"
Move-Item $SystemExe "$Repo\.build\win32-$Arch\system-setup\$SYSTEM_SETUP_NAME"
Write-Host "##vso[task.setvariable variable=SYSTEM_SETUP_NAME]$SYSTEM_SETUP_NAME"
Move-Item $UserExe "$Repo\.build\win32-$Arch\user-setup\$USER_SETUP_NAME"
Write-Host "##vso[task.setvariable variable=USER_SETUP_NAME]$USER_SETUP_NAME"
