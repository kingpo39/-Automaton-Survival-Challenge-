@echo off
REM ============================================
REM  Conway Automaton — Start All Services
REM  Dashboard + Agent (Groq cloud inference)
REM ============================================
setlocal

set PROJECT_DIR=D:\crewai_projects\.freebuff
set LOG_DIR=%PROJECT_DIR%\.freebuff

echo.
echo  ================================
echo   Conway Automaton — Starting...
echo  ================================
echo.

REM --- 2. Start Dashboard Server ---
echo [1/2] Starting Dashboard Server on :9876...
start "" /B cmd /c "node --import tsx src/dashboard-server.ts > "%LOG_DIR%\dashboard.log" 2> "%LOG_DIR%\dashboard.log.err""
timeout /t 3 /nobreak >nul
netstat -ano 2>nul | findstr ":9876.*LISTENING" >nul
if %ERRORLEVEL% equ 0 (
    echo        Dashboard running at http://localhost:9876
) else (
    echo        WARNING: Dashboard may still be starting...
)
echo.

REM --- 2. Start Agent Loop ---
echo [2/2] Starting Agent Loop (Groq cloud)...
start "" /B cmd /c "node --import tsx src/index.ts --run > "%LOG_DIR%\agent.log" 2> "%LOG_DIR%\agent.log.err""
timeout /t 5 /nobreak >nul
echo        Agent started
echo.

REM --- Summary ---
echo  ================================
echo   All Services Started!
echo  ================================
echo.
echo   Dashboard:  http://localhost:9876
echo   Agent:      Groq Llama 3.3 70B (cloud)
echo   Inference:  Groq cloud (free)
echo.
echo   Logs:
echo     Dashboard:  %LOG_DIR%\dashboard.log
echo     Agent:      %LOG_DIR%\agent.log
echo.
echo   Press Ctrl+C to stop (or close this window)
echo.

REM --- Keep alive & show status every 60s ---
:loop
timeout /t 60 /nobreak >nul
echo [%time%] Status check...
tasklist 2>nul | findstr /C:"node.exe" >nul && echo   Node:  RUNNING || echo   Node:  STOPPED
goto loop
