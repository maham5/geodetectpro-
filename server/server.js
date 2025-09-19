const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH || 'C:\\Users\\Rapids AI\\Downloads';
const OBJECT_DETECTION_API = process.env.OBJECT_DETECTION_API || 'https://a69c6555ac0d.ngrok-free.app/predict';
const AXIOS_TIMEOUT = process.env.OBJECT_DETECTION_TIMEOUT_MS ? parseInt(process.env.OBJECT_DETECTION_TIMEOUT_MS, 10) : 120000;

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500'], credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: path.join(__dirname, 'uploads') });

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
ensureDir(path.join(__dirname, 'uploads'));
ensureDir(path.join(__dirname, 'public'));
ensureDir(path.join(__dirname, 'public', 'processed'));

function getLatestImageFromDownloads() {
  try {
    const files = fs.readdirSync(DOWNLOADS_PATH);
    const imageFiles = files.filter(f => ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(path.extname(f).toLowerCase()));
    if (!imageFiles.length) return null;
    const stats = imageFiles.map(f => ({ f, m: fs.statSync(path.join(DOWNLOADS_PATH, f)).mtime }));
    stats.sort((a, b) => b.m - a.m);
    return path.join(DOWNLOADS_PATH, stats[0].f);
  } catch (e) { console.error('getLatestImageFromDownloads', e); return null; }
}

function decodeResponseData(data) { try { return Buffer.isBuffer(data) ? data.toString('utf8') : data; } catch (e) { return data; } }

async function postMultipartBuffer(url, formData) {
  const bodyBuffer = formData.getBuffer();
  const headers = { ...formData.getHeaders(), 'Content-Length': bodyBuffer.length };
  return axios.post(url, bodyBuffer, { headers, responseType: 'arraybuffer', timeout: AXIOS_TIMEOUT, maxContentLength: Infinity, maxBodyLength: Infinity });
}

app.get('/api/process-latest-image', async (req, res) => {
  try {
    const latest = getLatestImageFromDownloads();
    if (!latest) return res.status(404).json({ error: 'No images in Downloads' });
    const buffer = fs.readFileSync(latest);
    const formData = new FormData();
    formData.append('file', buffer, { filename: path.basename(latest), contentType: 'application/octet-stream' });
    const response = await postMultipartBuffer(OBJECT_DETECTION_API, formData);
    
    // Parse JSON response
    const responseText = decodeResponseData(response.data);
    const parsedResponse = JSON.parse(responseText);
    
    // Extract base64 image and detections
    const base64Image = parsedResponse.processed_image_base64;
    const detections = parsedResponse.detections || [];
    
    // Convert base64 to buffer and save
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const outName = `detected_${Date.now()}.png`;
    const outPath = path.join(__dirname, 'public', 'processed', outName);
    fs.writeFileSync(outPath, imageBuffer);
    
    return res.json({ 
      ok: true, 
      url: `/processed/${outName}`, 
      filename: outName,
      detections: detections,
      processedImageBase64: base64Image
    });
  } catch (err) {
    const resp = err.response ? decodeResponseData(err.response.data) : null;
    console.error('process-latest-image error', err.message, resp);
    return res.status(500).json({ error: 'processing_failed', details: err.message, aiResponse: resp });
  }
});

app.post('/api/process-screenshot', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const buffer = fs.readFileSync(req.file.path);
    const formData = new FormData();
    formData.append('file', buffer, { filename: req.file.originalname || 'screenshot.png', contentType: req.file.mimetype || 'application/octet-stream' });
    const response = await postMultipartBuffer(OBJECT_DETECTION_API, formData);
    
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    
    // Parse JSON response
    const responseText = decodeResponseData(response.data);
    const parsedResponse = JSON.parse(responseText);
    
    // Extract base64 image and detections
    const base64Image = parsedResponse.processed_image_base64;
    const detections = parsedResponse.detections || [];
    
    // Convert base64 to buffer and save
    const imageBuffer = Buffer.from(base64Image, 'base64');
    const outName = `detected_${Date.now()}.png`;
    const outPath = path.join(__dirname, 'public', 'processed', outName);
    fs.writeFileSync(outPath, imageBuffer);
    
    return res.json({ 
      ok: true, 
      url: `/processed/${outName}`, 
      filename: outName,
      detections: detections,
      processedImageBase64: base64Image
    });
  } catch (err) {
    try { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) {}
    const resp = err.response ? decodeResponseData(err.response.data) : null;
    console.error('process-screenshot error', err.message, resp);
    return res.status(500).json({ error: 'processing_failed', details: err.message, aiResponse: resp });
  }
});

app.get('/api/downloads-images', (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS_PATH).filter(f => ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(path.extname(f).toLowerCase()));
    const items = files.map(f => ({ name: f, modified: fs.statSync(path.join(DOWNLOADS_PATH, f)).mtime, size: fs.statSync(path.join(DOWNLOADS_PATH, f)).size }));
    items.sort((a, b) => b.modified - a.modified);
    res.json(items);
  } catch (e) { console.error('downloads list error', e); res.status(500).json({ error: 'failed' }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', downloadsPath: DOWNLOADS_PATH, apiEndpoint: OBJECT_DETECTION_API }));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
