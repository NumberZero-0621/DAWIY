#!/bin/bash

# Public setup
echo "Starting setup for 'public'..."
cd public
sudo npm install
cd ..

# Bank setup
echo "Starting setup for 'bank'..."
cd bank
sudo npm install
cd ..

echo "Setup completed successfully."
