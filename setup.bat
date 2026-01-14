@echo off

echo Starting setup for 'public'...
cd public
call npm install
cd ..

echo Starting setup for 'bank'...
cd bank
call npm install
cd ..

echo Setup completed successfully.
pause
