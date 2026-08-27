@echo off
REM ============================================
REM  Conway Automaton — Start All Services
REM  Ollama + Dashboard + Agent
REM ============================================
setlocal

set PROJECT_DIR=D:\crewai_projects\.freebuff
set LOG_DIR=%PROJECT_DIR%\.freebuff

echo.
echo  ================================
echo   Conway Automaton — Starting...
echo  ================================
echo.

REM --- 1. Start Ollama (if not already running) ---
echo [1/3] Checking Ollama...
netstat -ano 2>nul | findstr ":11434.*LISTENING" >nul
if %ERRORLEVEL% equ 0 (
    echo        Ollama already running on :11434
) else (
    echo        Starting Ollama server...
    start "" /B ollama serve
    timeout /t 5 /nobreak >nul
    echo        Ollama started on :11434
)

REM Verify Ollama is responsive
curl -s --max-time 5 http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo        WARNING: Ollama not responding yet, waiting...
    timeout /t 10 /nobreak >nul
)
echo.

REM --- 2. Start Dashboard Server ---
echo [2/3] Starting Dashboard Server on :9876...
start "" /B cmd /c "node --import tsx src/dashboard-server.ts > "%LOG_DIR%\dashboard.log" 2> "%LOG_DIR%\dashboard.log.err""
timeout /t 3 /nobreak >nul
netstat -ano 2>nul | findstr ":9876.*LISTENING" >nul
if %ERRORLEVEL% equ 0 (
    echo        Dashboard running at http://localhost:9876
) else (
    echo        WARNING: Dashboard may still be starting...
)
echo.

REM --- 3. Start Agent Loop ---
echo [3/3] Starting Agent Loop (Ollama inference)...
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
echo   Agent:      Ollama deepseek-r1:1.5b
echo   Ollama:     http://localhost:11434
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
tasklist 2>nul | findstr /C:"ollama" >nul && echo   Ollama: RUNNING || echo   Ollama: STOPPED
goto loop
