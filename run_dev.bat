@echo off
echo Starting DAWIY Development Environment...

rem Check if concurrently is installed (look for the binary)
if not exist "node_modules\.bin\concurrently.cmd" (
    echo Installing root dependencies...
    call npm install
)

rem Check public dependencies
if not exist "public\node_modules" (
    echo Installing public dependencies...
    cd public
    call npm install
    cd ..
)

rem Check bank dependencies
if not exist "bank\node_modules" (
    echo Installing bank dependencies...
    cd bank
    call npm install
    cd ..
)

rem Run the integrated dev command
call npm run dev
