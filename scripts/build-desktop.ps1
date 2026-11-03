# 构建「青衫工作台」桌面端（Tauri 2 + Rust）。
#
# 本机没有系统级 cargo，脚本默认复用便携工具链：
#   1. $env:QINGSHAN_TOOLCHAIN_ROOT（显式覆盖）
#   2. <repo>\.toolchain（本仓库自带）
#   3. C:\Users\<user>\Documents\DeepSeek-Devops\.toolchain（与青衫工具箱共用一套）
#
# 用法：
#   .\scripts\build-desktop.ps1            # debug 构建（走 devUrl，需要 Vite 开发服务器）
#   .\scripts\build-desktop.ps1 -Release   # release 构建（内嵌 ui/dist，可独立运行）
#   .\scripts\build-desktop.ps1 -Run       # 构建后启动
#   .\scripts\build-desktop.ps1 -Check     # 只做 cargo check
param(
    [switch]$Release,
    [switch]$Run,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-ToolchainRoot {
    if ($env:QINGSHAN_TOOLCHAIN_ROOT) { return (Resolve-Path $env:QINGSHAN_TOOLCHAIN_ROOT).Path }
    $local = Join-Path $root '.toolchain'
    if (Test-Path (Join-Path $local 'cargo\bin\cargo.exe')) { return $local }
    $shared = Join-Path $env:USERPROFILE 'Documents\DeepSeek-Devops\.toolchain'
    if (Test-Path (Join-Path $shared 'cargo\bin\cargo.exe')) { return $shared }
    throw "未找到便携 Rust 工具链。请设置 QINGSHAN_TOOLCHAIN_ROOT，或按 README 准备 .toolchain。"
}

$toolchainRoot = Resolve-ToolchainRoot
$toolchain = Join-Path $toolchainRoot 'rustup\toolchains\stable-x86_64-pc-windows-gnu'
if (!(Test-Path $toolchain)) {
    throw "未找到 Rust 工具链目录：$toolchain"
}

$cargoHome = Join-Path $toolchainRoot 'cargo'
$lld = Join-Path $toolchain 'lib\rustlib\x86_64-pc-windows-gnu\bin\gcc-ld\ld.lld.exe'
if (!(Test-Path $lld)) {
    throw "未找到 ld.lld：$lld"
}

$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = Join-Path $toolchainRoot 'rustup'
$env:PATH = "$cargoHome\bin;$(Join-Path $toolchainRoot 'mingw-bin');$env:PATH"
$env:CARGO_HTTP_PROXY = ''
$env:NO_PROXY = '127.0.0.1,localhost'

# GNU dlltool 不认非 ASCII 路径。有 ASCII 映射盘时把构建产物与临时文件放上去。
$asciiDrive = $null
foreach ($letter in @('S', 'R')) {
    if (Test-Path "${letter}:\") { $asciiDrive = "${letter}:"; break }
}
if ($asciiDrive) {
    $env:CARGO_TARGET_DIR = "$asciiDrive\target"
    $env:TEMP = "$asciiDrive\.tmp\rust"
} else {
    $env:CARGO_TARGET_DIR = Join-Path $root 'desktop\target'
    $env:TEMP = Join-Path $root '.tmp\rust'
    Write-Warning "构建路径包含中文时 dlltool 可能失败。建议先执行：subst S: `"$root`""
}
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

# bundle 的 gcc 驱动在这个沙箱里不可用，直接用 lld 链接；-L 需要显式补 sysroot。
$rustLib = Join-Path $toolchain 'lib\rustlib\x86_64-pc-windows-gnu\lib'
$env:RUSTFLAGS = "-C linker=$lld -C linker-flavor=ld -C link-self-contained=yes -L native=$rustLib -L native=$rustLib\self-contained"
$env:CARGO_TERM_PROGRESS_WHEN = 'never'

$distIndex = Join-Path $root 'desktop\ui\dist\index.html'
if (!(Test-Path $distIndex)) {
    Write-Warning "未找到 desktop/ui/dist。请先执行：cd desktop/ui; npm run build"
}

$manifest = Join-Path $root 'desktop\src-tauri\Cargo.toml'
$buildArgs = @('build', '--manifest-path', $manifest)
if ($Release) {
    # custom-protocol 会把 ui/dist 内嵌进二进制；否则 Tauri 加载 build.devUrl。
    $buildArgs += @('--release', '--features', 'custom-protocol')
} else {
    Write-Warning "debug 构建使用 devUrl（http://localhost:1420），需要 Vite 开发服务器。独立运行请使用 -Release。"
}

Push-Location (Join-Path $root 'desktop')
try {
    if ($Check) {
        cargo check --manifest-path $manifest
        exit $LASTEXITCODE
    }

    cargo @buildArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'desktop\target' }
    $profile = if ($Release) { 'release' } else { 'debug' }
    $builtExe = Join-Path $targetRoot "$profile\qingshan-workbench.exe"

    if ($Release) {
        $dist = Join-Path $root 'QingshanWorkbench'
        New-Item -ItemType Directory -Force -Path $dist | Out-Null
        $stagedExe = Join-Path $dist 'QingshanWorkbench.exe'
        Copy-Item $builtExe $stagedExe -Force
        $loader = Join-Path $targetRoot "$profile\WebView2Loader.dll"
        $stagedLoader = Join-Path $dist 'WebView2Loader.dll'
        if (Test-Path $loader) {
            Copy-Item $loader $stagedLoader -Force
        }

        $configPath = Join-Path $root 'desktop\src-tauri\tauri.conf.json'
        $version = (Select-String -Path $configPath -Pattern '"version"\s*:\s*"([^"]+)"').Matches[0].Groups[1].Value
        $zip = Join-Path $dist "QingshanWorkbench-v$version-win-x64.zip"
        if (Test-Path $zip) { Remove-Item $zip -Force }
        Compress-Archive -Path $stagedExe,$stagedLoader -DestinationPath $zip -Force

        $checksums = @($stagedExe, $stagedLoader, $zip) | ForEach-Object {
            $hash = (Get-FileHash $_ -Algorithm SHA256).Hash
            "$hash  $([System.IO.Path]::GetFileName($_))"
        }
        [System.IO.File]::WriteAllLines((Join-Path $dist 'SHA256SUMS.txt'), $checksums, (New-Object System.Text.UTF8Encoding($false)))

        Write-Host "release staged: $dist"
    }

    if ($Run) {
        if (!(Test-Path $builtExe)) { throw "构建成功但未找到可执行文件：$builtExe" }
        Write-Host "启动 $builtExe"
        Start-Process -FilePath $builtExe -WorkingDirectory (Split-Path $builtExe)
    }
}
finally {
    Pop-Location
}
