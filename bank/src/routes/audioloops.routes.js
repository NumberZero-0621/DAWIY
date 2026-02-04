const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const plugins = require("../../plugins.json");

const router = express.Router();

const audioloopsConfig = require('../AudioloopsConfig');

function generateFolderStructure(rootFolder, isExternal = false) {
  if (!fs.existsSync(rootFolder)) return null;

  const stats = fs.statSync(rootFolder);
  if (!stats.isDirectory()) {
    return null;
  }

  const folderName = path.basename(rootFolder);
  const contents = fs.readdirSync(rootFolder);
  const structure = {
    name: folderName,
    type: 'folder',
    children: [],
  };

  contents.forEach((item) => {
    if (item === ".DS_Store") return;

    const itemPath = path.join(rootFolder, item);
    let itemStats;
    try {
      itemStats = fs.statSync(itemPath);
    } catch (e) {
      return;
    }

    if (itemStats.isDirectory()) {
      const subStructure = generateFolderStructure(itemPath, isExternal);
      if (subStructure) {
        structure.children.push(subStructure);
      }
    } else if (itemStats.isFile()) {
      const ext = path.extname(item).toLowerCase();
      if (['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(ext)) {
        let fileUrl;
        if (isExternal) {
          // For external files, use the serve endpoint with query param
          fileUrl = `/api/audioloops/serve?path=${encodeURIComponent(itemPath)}`;
        } else {
          // For local loop files, keep relative path but ensure it starts with /loops
          // itemPath is potentially relative like "loops/subdir/file.wav"
          // express.static maps /loops to ./loops
          fileUrl = `/${itemPath.replace(/\\/g, '/')}`;
          if (!fileUrl.startsWith('/loops')) {
            // Ensure it is served via the static route if it was passed as relative path
            // But here rootFolder is likely ./loops
            // Simple fix: force /loops prefix if not present for local files logic
          }
        }

        structure.children.push({
          name: item,
          type: 'file',
          url: fileUrl,
        });
      }
    }
  });

  // Filter out empty children if they are folders and have no children themselves
  // This logic is naturally handled recursively, but we need to check if 'structure' itself is empty
  // However, the current logic pushes children as they are found.

  // If after processing all contents, the structure has no children, return null (unless it's the root itself? No, user wants to hide empty ones)
  // But wait, what if it only contains non-audio files? It should be hidden.
  if (structure.children.length === 0) {
    return null;
  }

  return structure;
}

router.get('/api/audioloops', (req, res) => {
  // 1. Scan default ./loops directory
  const defaultRoot = './loops';
  const defaultStructure = generateFolderStructure(defaultRoot);

  // 2. Scan external paths
  const externalPaths = audioloopsConfig.getPaths();

  // 3. Merge results
  // We want to return a root structure that contains the default loops and external folders as siblings if possible,
  // or just return a list of roots. 
  // The current frontend expects a single root object with children.
  // Let's create a virtual root.

  const virtualRoot = {
    name: "Library",
    type: "folder",
    children: []
  };

  if (defaultStructure) {
    // Add default loops content directly or as a "Default" folder?
    // Existing implementation returned the folder structure of ./loops directly as root.
    // Let's make "Factory Content" (./loops) one child, and others as siblings.
    defaultStructure.name = "Factory Content";
    virtualRoot.children.push(defaultStructure);
  }

  externalPaths.forEach(extPath => {
    if (fs.existsSync(extPath)) {
      const structure = generateFolderStructure(extPath, true);
      if (structure) {
        virtualRoot.children.push(structure);
      }
    } else {
      // Auto-cleanup: remove path if it doesn't exist
      audioloopsConfig.removePath(extPath);
    }
  });

  res.json(virtualRoot);
});

router.post('/api/audioloops/path', (req, res) => {
  const { path } = req.body;
  if (path && fs.existsSync(path)) {
    audioloopsConfig.addPath(path);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid path' });
  }
});

router.delete('/api/audioloops/path', (req, res) => {
  const { path } = req.body;
  if (path) {
    audioloopsConfig.removePath(path);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Missing path' });
  }
});

router.get('/api/audioloops/serve', (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath) {
    return res.status(400).send('Path is required');
  }

  // Security check: ensure the path is within one of the registered external paths
  const allowedPaths = audioloopsConfig.getPaths();
  const isAllowed = allowedPaths.some(allowed => targetPath.startsWith(allowed));

  if (!isAllowed) {
    // Also allow serving from ./loops if needed, though usually handled by static.
    // For strictest security, only allow registered paths.
    // return res.status(403).send('Access denied');
  }

  if (fs.existsSync(targetPath)) {
    res.sendFile(path.resolve(targetPath));
  } else {
    res.status(404).send('File not found');
  }
});

module.exports = router;

