const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, '../storage');
const CONFIG_FILE = path.join(STORAGE_DIR, 'audioloops.json');

class AudioloopsConfig {
    constructor() {
        this.ensureStorage();
    }

    ensureStorage() {
        if (!fs.existsSync(STORAGE_DIR)) {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
        }
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify({ paths: [] }, null, 2));
        }
    }

    getPaths() {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const config = JSON.parse(data);
            return config.paths || [];
        } catch (e) {
            console.error("Error reading audioloops config:", e);
            return [];
        }
    }

    addPath(newPath) {
        const paths = this.getPaths();
        if (!paths.includes(newPath)) {
            paths.push(newPath);
            this.savePaths(paths);
            return true;
        }
        return false;
    }

    removePath(pathToRemove) {
        const paths = this.getPaths();
        const newPaths = paths.filter(p => p !== pathToRemove);
        if (paths.length !== newPaths.length) {
            this.savePaths(newPaths);
            return true;
        }
        return false;
    }

    savePaths(paths) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ paths }, null, 2));
    }
}

module.exports = new AudioloopsConfig();
