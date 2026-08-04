const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const utils = require('./utils');

const projectsRoutes = require('./routes/projects.routes');
const authRoutes = require('./routes/auth.routes');
const pluginsRoutes = require('./routes/plugins.routes');
const audioloopsRoutes = require('./routes/audioloops.routes');
const pedalboard2Routes = require('./routes/pedalboard2.routes.js');
const settingsRoutes = require('./routes/settings.routes');

const path = require("path");

const CORS_ALL = config.corsOptions.all;
const CORS_VERIFIED = config.corsOptions.verified;

const app = express();
app.use(express.json());
// app.use(cors(config.corsOptions));
app.use(cookieParser());
// Custom middleware to set Cross-Origin-Resource-Policy header
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});


utils.checkEnvVars();
utils.createDirectories();
utils.createFiles();

//app.use(cors(CORS_VERIFIED), projectsRoutes);
// MB
app.use(projectsRoutes);

// MB it works like that but imho, it should be like that :
// app.use(cauthRoutes); like for projects routes that have a custom CORS config in the file
app.use(cors(CORS_VERIFIED), authRoutes);
app.use(cors(CORS_ALL), pluginsRoutes);
app.use(cors(CORS_ALL), audioloopsRoutes);
app.use(cors(CORS_ALL), pedalboard2Routes);
app.use(cors(CORS_ALL), settingsRoutes);

app.use("/pedalboard", cors(CORS_ALL), express.static(path.join(__dirname, "../PedalBoard")));
app.use("/plugins", cors(CORS_ALL), express.static(path.join(__dirname, "../plugins")));
app.use("/songs", cors(CORS_ALL), express.static(path.join(__dirname, "../songs")));
app.use("/loops", cors(CORS_ALL), express.static(path.join(__dirname, "../loops")));
app.use("/AudioMetro", cors(CORS_ALL), express.static(path.join(__dirname, "../AudioMetro")));


// --- Heartbeat & Auto-Shutdown ---
let heartbeatTimeout = null;
const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds grace period

app.get('/heartbeat', cors(CORS_ALL), (req, res) => {
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
    }

    // Reset the shutdown timer
    // The server will shut down if no heartbeat is received within the timeout
    if (config.enableHeartbeatShutdown) {
        heartbeatTimeout = setTimeout(() => {
            console.log('Heartbeat lost. Shutting down server...');
            process.exit(0);
        }, HEARTBEAT_TIMEOUT_MS);
    }

    res.sendStatus(200);
});
// ---------------------------------

// --- Temp File Upload for Fast IPC ---
const multer = require('multer');
const fs = require('fs');
const tempUploadDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}
const upload = multer({ dest: tempUploadDir });

app.post('/upload_temp', cors(CORS_ALL), upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    // Return the absolute path of the uploaded file so Tauri can read it directly
    res.json({ path: req.file.path });
});
// -------------------------------------


app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
});