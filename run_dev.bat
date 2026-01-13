@echo off

echo Starting 'public' application...
start "Public App" cmd /k "cd public && npm start"

echo Starting 'bank' application...
start "Bank App" cmd /k "cd bank && npm start"

echo Both applications have been launched in separate windows.
