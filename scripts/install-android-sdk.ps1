# 安装 Android SDK + NDK（供 Tauri Android 构建使用）
# 在 Android Studio 安装完成后运行。
#
# Android Studio 自带 JBR（JetBrains Runtime）作为 JDK，sdkmanager 用它。
# SDK 默认装到 %LOCALAPPDATA%\Android\Sdk
#
# 注意：下面的 Android Studio 路径是默认安装位置。如果你的安装路径不同，
#       请修改 $Studio 变量。

$ErrorActionPreference = "Stop"

$Studio = "C:\Program Files\Android\Android Studio"
if (-not (Test-Path $Studio)) {
    Write-Error "Android Studio 未安装于 $Studio，请先安装或修改脚本中的路径。"
    exit 1
}

# 用 Studio 自带 JDK
$Jbr = Join-Path $Studio "jbr\bin"
if (-not (Test-Path $Jbr)) {
    Write-Error "未找到 JBR（JDK）：$Jbr"
    exit 1
}
$env:JAVA_HOME = Join-Path $Studio "jbr"
$env:PATH = "$Jbr;$env:PATH"

Write-Host "JAVA_HOME = $env:JAVA_HOME"

# SDK 根目录
$SdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
if (-not (Test-Path $SdkRoot)) {
    New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
}

# sdkmanager 路径（ cmdline-tools 还没装时，先用 Studio 自带的）
$CmdlineTools = Join-Path $SdkRoot "cmdline-tools\latest\bin"
$sdkmanager = Join-Path $CmdlineTools "sdkmanager.bat"

if (-not (Test-Path $sdkmanager)) {
    Write-Host "首次运行：用 Studio 自带的 cmdline-tools 引导..."
    $BundledCmdline = Join-Path $Studio "plugins\android\lib\sdkmanager.bat"
    if (Test-Path $BundledCmdline) {
        $sdkmanager = $BundledCmdline
    } else {
        # 直接下载 cmdline-tools
        Write-Host "下载 cmdline-tools..."
        $url = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
        $zip = Join-Path $env:TEMP "cmdline-tools.zip"
        Invoke-WebRequest -Uri $url -OutFile $zip
        $extractTmp = Join-Path $env:TEMP "cmdline-tools-extract"
        if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $extractTmp -Force
        # 结构：extractTmp\cmdline-tools\bin\...
        $target = Join-Path $SdkRoot "cmdline-tools\latest"
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Join-Path $SdkRoot "cmdline-tools") | Out-Null
        Move-Item (Join-Path $extractTmp "cmdline-tools") $target
        $sdkmanager = Join-Path $target "bin\sdkmanager.bat"
    }
}

Write-Host "sdkmanager = $sdkmanager"

# 需要安装的组件
$packages = @(
    "platform-tools",
    "platforms;android-35",
    "build-tools;35.0.0",
    "ndk;27.0.12077973"
)

Write-Host "安装 SDK 组件（需接受许可证）..."
& $sdkmanager --licenses 2>&1 | Out-Null

foreach ($pkg in $packages) {
    Write-Host "  安装 $pkg ..."
    & $sdkmanager $pkg 2>&1 | Out-Null
}

# NDK_HOME
$NdkDir = Join-Path $SdkRoot "ndk\27.0.12077973"
Write-Host ""
Write-Host "完成。请设置以下用户环境变量（脚本已为当前会话设置）："
Write-Host "  ANDROID_HOME = $SdkRoot"
Write-Host "  ANDROID_SDK_ROOT = $SdkRoot"
Write-Host "  NDK_HOME = $NdkDir"
Write-Host "  JAVA_HOME = $env:JAVA_HOME"

# 持久化到用户环境变量
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $SdkRoot, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $SdkRoot, "User")
[Environment]::SetEnvironmentVariable("NDK_HOME", $NdkDir, "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", $env:JAVA_HOME, "User")
Write-Host "已写入用户环境变量。"
