@echo off
rem Starts the speech coach, each part in its own window (close a window to stop it).
rem
rem   start.bat                backend (:8000) + frontend (:80)
rem   start.bat robot          + the Arduino bridge (robot plugged in, Serial Monitor closed)
rem   start.bat dry-run        + the bridge without a robot (prints what it would send)
rem   start.bat ngrok          + an https tunnel to the frontend, for phones
rem
rem Options combine, e.g.  start.bat robot ngrok
setlocal
cd /d "%~dp0"

if not exist backend\venv\Scripts\python.exe (
  echo Backend venv not found. Create it once with:
  echo   python -m venv backend\venv
  echo   backend\venv\Scripts\pip install -r backend\requirements.txt
  exit /b 1
)
if not exist .env echo WARNING: no .env file. Copy .env.example to .env and fill in the keys.

rem A server already on the port would make the new one fail with a confusing error.
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul && (
  echo Port 8000 is already in use: is the backend already running? Close it first.
  exit /b 1
)
netstat -ano | findstr /r /c:":80 .*LISTENING" >nul && (
  echo Port 80 is already in use: is the frontend already running? Close it first.
  exit /b 1
)

rem Installs first so teammates who just pulled new packages are covered.
start "Backend :8000" cmd /k "backend\venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt && backend\venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000"
start "Frontend :80" /d frontend cmd /k "npm install --no-audit --no-fund && npm run dev"

rem The bridge reconnects on its own, so it can start before the backend is up.
for %%A in (%*) do (
  if /i "%%A"=="robot"   start "Robot bridge" cmd /k "backend\venv\Scripts\python.exe bridge\bridge.py"
  if /i "%%A"=="dry-run" start "Robot bridge (dry run)" cmd /k "backend\venv\Scripts\python.exe bridge\bridge.py --dry-run"
  if /i "%%A"=="ngrok"   start "ngrok" cmd /k "ngrok http 80"
)

echo Starting. Open http://localhost once the Frontend window shows "ready".
