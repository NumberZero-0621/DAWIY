:<<"::CMDLITERAL"
@ECHO OFF
GOTO :WINDOWS
::CMDLITERAL

# -----------------------------------------------------------------------------
# LINUX / MAC / UNIX-LIKE (BASH) IMPLEMENTATION
# -----------------------------------------------------------------------------
cd "$(dirname "$0")" || exit 1

echo "Starting DAWIY Development Environment (Unix-like)..."

check_and_copy_env() {
    local DIR=$1
    if [ -f "$DIR/.env.example" ] && [ ! -f "$DIR/.env" ]; then
        echo "Creating $DIR/.env from .env.example..."
        cp "$DIR/.env.example" "$DIR/.env"
    fi
}

check_and_install() {
    local DIR=$1
    local NAME=$2
    echo "Checking $NAME dependencies..."
    (
        cd "$DIR" || { echo "Failed to enter directory $DIR"; exit 1; }
        if ! npm ls --parseable --depth=0 >/dev/null 2>&1; then
            echo "$NAME dependencies are missing. Installing..."
            npm install
        else
            echo "$NAME dependencies are up to date."
        fi
    )
}

# ---------------------------------------------------------
# [New] Function: Browser Selection
# ---------------------------------------------------------
select_browser() {
    echo "------------------------------------------------"
    echo "Select a browser to open the application:"
    
    # Reset options
    options=()

    # Check common macOS paths
    [ -d "/Applications/Google Chrome.app" ] && options+=("Google Chrome")
    [ -d "/Applications/Firefox.app" ] && options+=("Firefox")
    [ -d "/Applications/Microsoft Edge.app" ] && options+=("Microsoft Edge")
    
    # Default options
    options+=("Safari" "System Default")

    PS3="Enter number > "
    select opt in "${options[@]}"
    do
        case $opt in
            "Google Chrome")  export BROWSER="Google Chrome"; break ;;
            "Firefox")        export BROWSER="firefox"; break ;;
            "Microsoft Edge") export BROWSER="Microsoft Edge"; break ;;
            "Safari")         export BROWSER="Safari"; break ;;
            "System Default") unset BROWSER; break ;;
            *) echo "Invalid option.";;
        esac
    done
    echo "Target Browser: ${BROWSER:-System Default}"
}

# Execution Flow
check_and_copy_env "public"
check_and_copy_env "bank"

check_and_install "." "Root"
check_and_install "public" "Public"
check_and_install "bank" "Bank"
check_and_install "bank/pedalboard2" "Pedalboard2"

# Call the function
select_browser

npm run dev
exit 0

:WINDOWS
rem -----------------------------------------------------------------------------
rem WINDOWS (BATCH) IMPLEMENTATION
rem -----------------------------------------------------------------------------
setlocal
echo Starting DAWIY Development Environment (Windows)...

call :CheckAndCopyEnv "public"
call :CheckAndCopyEnv "bank"

call :CheckAndInstall "." "Root"
call :CheckAndInstall "public" "Public"
call :CheckAndInstall "bank" "Bank"
call :CheckAndInstall "bank\pedalboard2" "Pedalboard2"

rem Call the browser selection label
call :SelectBrowser

rem Run the integrated dev command
call npm run dev
goto :eof

rem ---------------------------------------------------------
rem [New] Label: Browser Selection
rem ---------------------------------------------------------
:SelectBrowser
echo.
echo ------------------------------------------------
echo Select a browser to open the application:

set "opt_chrome="
set "opt_firefox="
set "opt_edge="

rem Check for browsers in standard Windows paths
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo [1] Google Chrome
    set "opt_chrome=1"
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo [1] Google Chrome
    set "opt_chrome=1"
)

if exist "C:\Program Files\Mozilla Firefox\firefox.exe" (
    echo [2] Firefox
    set "opt_firefox=1"
)

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    echo [3] Microsoft Edge
    set "opt_edge=1"
)

echo [4] System Default

:AskBrowser
set /p "choice=Enter number > "

if "%choice%"=="1" if defined opt_chrome (
    set "BROWSER=chrome"
    goto :BrowserSelected
)
if "%choice%"=="2" if defined opt_firefox (
    set "BROWSER=firefox"
    goto :BrowserSelected
)
if "%choice%"=="3" if defined opt_edge (
    set "BROWSER=msedge"
    goto :BrowserSelected
)
if "%choice%"=="4" (
    set "BROWSER="
    goto :BrowserSelected
)

echo Invalid choice or browser not installed.
goto :AskBrowser

:BrowserSelected
echo Target Browser Set.
exit /b 0

:CheckAndCopyEnv
set "DIR=%~1"
if exist "%DIR%\.env.example" (
    if not exist "%DIR%\.env" (
        echo Creating %DIR%\.env from .env.example...
        copy "%DIR%\.env.example" "%DIR%\.env" >nul
    )
)
exit /b 0

:CheckAndInstall
set "DIR=%~1"
set "NAME=%~2"
echo Checking %NAME% dependencies...
pushd "%DIR%"
call npm ls --parseable --depth=0 >nul 2>&1
if %errorlevel% neq 0 (
    echo %NAME% dependencies are missing or out of sync. Installing...
    call npm install
) else (
    echo %NAME% dependencies are up to date.
)
popd
exit /b 0