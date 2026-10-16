@echo off
chcp 65001 >nul
title 打包待办清单 APK

REM ============ 一键打包：双击这个文件就行 ============
REM 说明：它会自动把 prototype\index.html 拷进 assets 再打包，
REM       所以改完网页点一下这里，两分钟出 APK。

setlocal enabledelayedexpansion

set "PROJ=%~dp0"
if "%PROJ:~-1%"=="\" set "PROJ=%PROJ:~0,-1%"
set "ROOT=%PROJ%\.."
set "JAVA_HOME=%ROOT%\.toolchain\jdk21"
set "ANDROID_HOME=%ROOT%\.toolchain\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

REM 找本机已经下好的 Gradle（第一次构建才需要联网下载依赖）
set "GRADLE_HOME="
for /d %%D in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.14.3-all\*") do (
    if exist "%%D\gradle-8.14.3\bin\gradle.bat" set "GRADLE_HOME=%%D\gradle-8.14.3"
)
if "%GRADLE_HOME%"=="" (
    echo [x] 没找到 Gradle。请用 android\gradlew.bat assembleRelease 再试一次
    pause & exit /b 1
)

echo [1/3] 环境：%JAVA_HOME%
echo [2/3] SDK  ：%ANDROID_HOME%
echo [3/3] 开始打包，第一次会下载依赖，请耐心等几分钟...
call "%GRADLE_HOME%\bin\gradle.bat" -p "%PROJ%" assembleRelease --console=plain

echo.
if exist "%PROJ%\app\build\outputs\apk\release\app-release.apk" (
    echo 打包成功：android\app\build\outputs\apk\release\app-release.apk
    copy /y "%PROJ%\app\build\outputs\apk\release\app-release.apk" "%ROOT%\待办清单-V0.3.apk" >nul
    echo 已复制到项目根目录：待办清单-V0.3.apk
) else (
    echo 打包失败，把上面的红色报错发我就行。
)
pause
