const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const SETTINGS_FILE = path.join(__dirname, '../../settings.json');

// Helper to read settings
function readSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return {};
    }
    try {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Error reading settings.json", e);
        return {};
    }
}

// Helper to write settings
function writeSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Error writing settings.json", e);
        return false;
    }
}

/**
 * GET /settings
 * Returns the global settings object.
 */
router.get('/settings', (req, res) => {
    const settings = readSettings();
    res.json(settings);
});

/**
 * POST /settings
 * Updates the global settings object.
 * Merges the provided object with the existing one (shallow merge of top-level keys recommended, 
 * or deep merge if needed. For now simple toggle/value updates usually overwrite keys).
 * We will do a spread merge at top level.
 */
router.post('/settings', (req, res) => {
    const newSettings = req.body;
    if (!newSettings || typeof newSettings !== 'object') {
        return res.status(400).send("Invalid settings data");
    }

    const currentSettings = readSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };

    if (writeSettings(updatedSettings)) {
        res.json(updatedSettings);
    } else {
        res.status(500).send("Failed to save settings");
    }
});

module.exports = router;
