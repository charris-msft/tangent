@echo off
:: Tangent Launcher — launches the pre-built Electron app from out/
:: Run "npm run build" first to create the build, then use this to launch.
:: To pin to taskbar: create a shortcut to this .bat, change target to
::   cmd.exe /c "D:\git\tangent\release\tangent.bat"
:: then right-click the shortcut → Pin to taskbar.

cd /d D:\git\tangent\release

if not exist "out\main\index.js" (
    echo No build found. Running "npm run build" first...
    call npm run build
    if errorlevel 1 (
        echo Build failed!
        pause
        exit /b 1
    )
)

start "" npx electron .
