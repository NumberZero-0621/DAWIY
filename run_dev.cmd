:<<"::CMDLITERAL"
@ECHO OFF
GOTO :WINDOWS
::CMDLITERAL

# -----------------------------------------------------------------------------
# LINUX / MAC / UNIX-LIKE (BASH) IMPLEMENTATION
# -----------------------------------------------------------------------------
# Change to the directory where the script is located
cd "$(dirname "$0")" || exit 1

echo "Starting DAWIY Development Environment (Unix-like)..."

# Function to check and copy .env files
check_and_copy_env() {
    local DIR=$1
    if [ -f "$DIR/.env.example" ] && [ ! -f "$DIR/.env" ]; then
        echo "Creating $DIR/.env from .env.example..."
        cp "$DIR/.env.example" "$DIR/.env"
    fi
}

# Function to check and install dependencies
check_and_install() {
    local DIR=$1
    local NAME=$2
    
    echo "Checking $NAME dependencies..."
    
    # Subshell to ensure we return to the original directory
    (
        cd "$DIR" || { echo "Failed to enter directory $DIR"; exit 1; }
        
        # Check if dependencies are satisfied using npm ls
        # It returns non-zero if packages are missing or invalid
        if ! npm ls --parseable --depth=0 >/dev/null 2>&1; then
            echo "$NAME dependencies are missing or out of sync. Installing..."
            npm install
        else
            echo "$NAME dependencies are up to date."
        fi
    )
}

# Ensure environment files exist
check_and_copy_env "public"
check_and_copy_env "bank"

# Check all required directories
check_and_install "." "Root"
check_and_install "public" "Public"
check_and_install "bank" "Bank"
check_and_install "bank/pedalboard2" "Pedalboard2"

# Run the integrated dev command
npm run dev

# Exit Bash execution
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

rem Run the integrated dev command
call npm run dev
goto :eof

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