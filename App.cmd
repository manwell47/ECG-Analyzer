@echo off
rem ============================================================================
rem  ECG DWT Analyzer - local launcher (ADR-023).
rem
rem  Double-click this file to run the application on this machine. It is a
rem  convenience entry point only: it installs nothing new, uploads nothing and
rem  publishes nothing. Every dependency comes from the committed package.json /
rem  package-lock.json (npm ci), and the development server binds to localhost.
rem
rem  No port is hard-coded. Vite picks the first free port from 5173 upwards, so
rem  the launcher works even when another server already occupies 5173.
rem ============================================================================
setlocal
cd /d "%~dp0"

echo ECG DWT Analyzer - starting the local development server...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH.
    echo         Install Node.js 20 or newer from https://nodejs.org/ and run
    echo         this launcher again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found on PATH.
    echo         npm ships with Node.js; reinstall Node.js 20 or newer from
    echo         https://nodejs.org/ and run this launcher again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Dependencies are not installed yet. Running "npm ci" ...
    echo This downloads the packages listed in package-lock.json and can take
    echo a few minutes the first time.
    echo.
    call npm ci
    if errorlevel 1 (
        echo.
        echo [ERROR] "npm ci" failed. The server was not started.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Starting Vite and opening the browser. It picks a free port automatically
echo ^(usually 5173^) and prints it below.
echo.
echo   *** KEEP THIS WINDOW OPEN while you use the application. ***
echo   *** Closing it, or pressing Ctrl+C, stops the server.       ***
echo.

call npm run dev -- --open

echo.
echo The development server has stopped.
pause
