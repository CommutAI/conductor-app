
# CommutAI — Android SDK Setup Script (Updated for zip-installed JDK)
$javaHome    = "C:\Java\jdk-17"
$androidHome = "C:\Android"
$sdkManager  = "$androidHome\cmdline-tools\latest\bin\sdkmanager.bat"

$env:JAVA_HOME    = $javaHome
$env:ANDROID_HOME = $androidHome
$env:Path         = "$javaHome\bin;" + $env:Path

Write-Host "Java version:"
& "$javaHome\bin\java.exe" -version 2>&1 | Select-Object -First 1

Write-Host "`nAccepting all licenses..."
$yes = "y`ny`ny`ny`ny`ny`ny`ny`ny`ny`ny`ny`ny`ny`ny`n"
echo $yes | & $sdkManager --sdk_root="$androidHome" --licenses 2>&1 | Select-Object -Last 3

Write-Host "`nInstalling SDK platform-tools, build-tools, and platform..."
Write-Host "(This downloads ~250 MB total — be patient, it may take 5-10 minutes)"
echo $yes | & $sdkManager --sdk_root="$androidHome" --verbose "platform-tools" "build-tools;36.0.0" "platforms;android-36" 2>&1

Write-Host "`n`nSetup complete! Checking results..."
Write-Host "adb.exe exists: $(Test-Path `"$androidHome\platform-tools\adb.exe`")"
Write-Host "aapt.exe exists: $(Test-Path `"$androidHome\build-tools\36.0.0\aapt.exe`")"  
Write-Host "android.jar exists: $(Test-Path `"$androidHome\platforms\android-36\android.jar`")"
Write-Host "`nSDK folders:"
(Get-ChildItem $androidHome -ErrorAction SilentlyContinue).Name | ForEach-Object { Write-Host "  `$_" }
