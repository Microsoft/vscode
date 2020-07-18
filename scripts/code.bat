@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Node modules
if not exist node_modules call yarn

for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do set NAMESHORT=%%~a
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Get electron
call yarn electron

:: Manage built-in extensions
if "%1"=="--builtin" goto builtin

:: Sync built-in extensions
node build\lib\builtInExtensions.js

:: Build
if not exist out yarn compile

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
set VSCODE_LOGS=

:: Launch Code

%CODE% . %*
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
