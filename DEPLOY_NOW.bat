@echo off
echo ========================================
echo  AutoFlow v7 — Deploy to GitHub + Vercel
echo ========================================
echo.

cd /d "%~dp0"

echo [1/5] Initializing git...
git init
git config user.email "zaidmubashir567@gmail.com"
git config user.name "Zaid Mubashir"
git branch -M main

echo.
echo [2/5] Staging all files...
git add -A
git commit -m "AutoFlow v7 — initial deploy"

echo.
echo [3/5] Connecting to GitHub...
echo IMPORTANT: Create a repo at https://github.com/new
echo   - Name: autoflow-v7
echo   - Private: YES
echo   - Do NOT add README/gitignore
echo.
set /p GITHUB_USER="Enter your GitHub username: "
git remote add origin https://github.com/%GITHUB_USER%/autoflow-v7.git
git push -u origin main

echo.
echo [4/5] Installing Vercel CLI and deploying...
npm install -g vercel
vercel --yes --name autoflow-v7

echo.
echo [5/5] Setting Vercel environment variables...
vercel env add VITE_SUPABASE_URL production <<< "https://ndwvsrtyjnaddrifafqk.supabase.co"
vercel env add VITE_SUPABASE_ANON_KEY production <<< "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kd3ZzcnR5am5hZGRyaWZhZnFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODMxMDgsImV4cCI6MjA5MzQ1OTEwOH0.7XoOKB74DGiXac3cfSSiyvREuWZ7qbQ2QbxE6d1rnlM"

echo.
echo ========================================
echo  DONE! Your dashboard is live at:
echo  https://autoflow-v7.vercel.app
echo ========================================
pause
