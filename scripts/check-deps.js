const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const directories = [
    'public',
    'bank',
    path.join('bank', 'pedalboard2')
];

let hasError = false;

console.log('Starting dependency check...');

for (const dir of directories) {
    const targetDir = path.resolve(__dirname, '..', dir);
    const dirName = dir === '.' ? 'Root' : dir;

    if (!fs.existsSync(targetDir)) {
        console.warn(`Directory not found: ${dirName}`);
        continue;
    }

    console.log(`Checking ${dirName} dependencies...`);

    try {
        // Check if node_modules exists and if dependencies are satisfied
        // npm ls returns non-zero exit code if dependencies are missing or invalid
        execSync('npm ls --parseable --depth=0', {
            cwd: targetDir,
            stdio: 'ignore' // Hide output, we only care about exit code
        });
        console.log(`${dirName} dependencies are up to date.`);
    } catch (e) {
        console.log(`${dirName} dependencies are missing or out of sync. Installing...`);
        try {
            execSync('npm install', {
                cwd: targetDir,
                stdio: 'inherit' // Show install output
            });
            console.log(`${dirName} dependencies installed successfully.`);
        } catch (installError) {
            console.error(`Failed to install dependencies for ${dirName}:`, installError.message);
            hasError = true;
        }
    }
}

if (hasError) {
    console.error('Dependency check finished with errors.');
    process.exit(1);
} else {
    console.log('All dependencies are checked and ready.');
}
