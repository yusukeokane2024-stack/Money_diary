@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ===== マネーダイアリーを公開します =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js が入っていません。
  echo     開いたページから LTS をダウンロードしてインストールし、
  echo     このファイルをもう一度ダブルクリックしてください。
  start https://nodejs.org
  pause
  exit /b 1
)
echo [1/3] 部品をインストール中... (数分かかります)
call npm install
if errorlevel 1 goto :fail
echo.
echo [2/3] Google アカウントでログインします。ブラウザが開いたら「許可」を押してください。
call npx firebase login
if errorlevel 1 goto :fail
echo.
echo [3/3] 公開中...
call npm run deploy
if errorlevel 1 goto :fail
echo.
echo ===== 完了! =====
echo   https://moneydiary-8eb7b.web.app を開いて「新規登録」してください。
start https://moneydiary-8eb7b.web.app
pause
exit /b 0

:fail
echo.
echo [!] エラーが出ました。この黒い画面の文字をコピーして(またはスクリーンショットで)送ってください。
pause
exit /b 1
