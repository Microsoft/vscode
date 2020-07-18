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
$Build = "$Root\VSCode-win32-$Arch"

# Create server archive
if ("$Arch" -ne "arm64") {
	exec { xcopy $LegacyServer $Server /H /E /I }
	exec { .\node_modules\7zip\7zip-lite\7z.exe a -tzip $ServerZip $Server -r }
}

# get version
$PackageJson = Get-Content -Raw -Path "$Build\resources\app\package.json" | ConvertFrom-Json
$Version = $PackageJson.version

$AssetPlatform = if ("$Arch" -eq "ia32") { "win32" } else { "win32-$Arch" }

exec { node build/azure-pipelines/common/createAsset.js "$AssetPlatform-archive" archive "VSCode-win32-$Arch-$Version.zip" $Zip }
exec { node build/azure-pipelines/common/createAsset.js "$AssetPlatform" setup "VSCodeSetup-$Arch-$Version.exe" $SystemExe }
exec { node build/azure-pipelines/common/createAsset.js "$AssetPlatform-user" setup "VSCodeUserSetup-$Arch-$Version.exe" $UserExe }

if ("$Arch" -ne "arm64") {
	exec { node build/azure-pipelines/common/createAsset.js "server-$AssetPlatform" archive "vscode-server-win32-$Arch.zip" $ServerZip }
}
