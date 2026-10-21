@echo off
chcp 936 >nul
title 打包待办清单 APK

REM ============ 一键打包：双击这个文件就行 ============
REM 说明：它会自动把 prototype\index.html 拷进 assets 再打包（build.gradle 里的 copyWeb 任务），
REM       所以改完网页点一下这里，半分钟到两分钟就出新 APK。

setlocal enabledelayedexpansion

set "PROJ=%~dp0"
if "%PROJ:~-1%"=="\" set "PROJ=%PROJ:~0,-1%"
set "ROOT=%PROJ%\.."
REM JDK 17（Temurin）—— AGP 8.11 要求 17 以上；本机默认的 java 1.8 没有 javac，不能用
set "JAVA_HOME=%ROOT%\.toolchain\jdk"
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

REM 版本号从 build.gradle 里读 —— 升级时只改 app\build.gradle 的 versionName 一处，这里自动跟上
REM （用 token 切分再剥引号：直接在 for 选项里写 delims=^" 会被 cmd 的引号规则吃掉，整行报错）
set "VERRAW="
for /f "usebackq tokens=2" %%V in (`findstr /c:"versionName" "%PROJ%\app\build.gradle"`) do set "VERRAW=%%V"
set "VER=0.0"
if defined VERRAW set "VER=%VERRAW:"=%"
echo [1/3] JDK  ：%JAVA_HOME%
echo [2/3] SDK  ：%ANDROID_HOME%
echo [3/3] 版本 ：%VER% · 开始打包（--offline 用本机缓存，不联网）...

call "%GRADLE_HOME%\bin\gradle.bat" -p "%PROJ%" assembleRelease --offline --console=plain

echo.
if exist "%PROJ%\app\build\outputs\apk\release\app-release.apk" (
    echo 打包成功：android\app\build\outputs\apk\release\app-release.apk
    copy /y "%PROJ%\app\build\outputs\apk\release\app-release.apk" "%ROOT%\待办清单-V%VER%.apk" >nul
    echo 已复制到项目根目录：待办清单-V%VER%.apk
) else (
    echo 打包失败 —— 把上面标了 error 的那几行发我。
)
pause
