@echo off
REM ============================================
REM  Conway Automaton — Stop All Services
REM ============================================

echo.
echo  Stopping Conway Automaton services...
echo.

REM Kill agent node processes (not dashboard)
echo  Stopping Agent...
taskkill /FI "WINDOWTITLE eq agent*" /F >nul 2>&1

REM Find and kill node processes running the agent
for /f "tokens=2" %%p in ('tasklist ^| findstr /C:"node.exe"') do (
    wmic process where "ProcessId=%%p" get CommandLine 2>nul | findstr /C:"index.ts" >nul
    if %ERRORLEVEL% equ 0 (
        echo    Killing agent PID: %%p
        taskkill /PID %%p /F >nul 2>&1
    )
)

echo  Stopping Dashboard...
for /f "tokens=2" %%p in ('tasklist ^| findstr /C:"node.exe"') do (
    wmic process where "ProcessId=%%p" get CommandLine 2>nul | findstr /C:"dashboard-server" >nul
    if %ERRORLEVEL% equ 0 (
        echo    Killing dashboard PID: %%p
        taskkill /PID %%p /F >nul 2>&1
    )
)

echo.
echo  Services stopped.
echo  (Ollama left running — stop manually with: ollama stop)
echo.
pause
