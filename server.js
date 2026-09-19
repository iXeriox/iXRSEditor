'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { decodeSave, encodeSave } = require('./lib/save-codec');

const PORT = Number(process.env.PORT) || 9898;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 100 * 1024 * 1024;
const publicDir = path.join(__dirname, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Request exceeds the 100 MB limit')); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = path.resolve(publicDir, `.${requestPath}`);
  if (!file.startsWith(`${publicDir}${path.sep}`)) return jsonResponse(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (error, data) => {
    if (error) return jsonResponse(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'content-length': data.length });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return jsonResponse(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/api/decode') {
      const result = decodeSave(await readBody(req));
      return jsonResponse(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/encode') {
      const payload = JSON.parse((await readBody(req)).toString('utf8'));
      const encoded = encodeSave(payload.json, payload.format);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': encoded.length, 'content-disposition': 'attachment; filename="edited-save"' });
      return res.end(encoded);
    }
    if (req.method === 'GET') return serveStatic(req, res);
    return jsonResponse(res, 404, { error: 'Not found' });
  } catch (error) {
    return jsonResponse(res, 400, { error: error.message || 'Unable to process save' });
  }
});

server.listen(PORT, HOST, () => console.log(`Dragonwilds Save Editor available at http://${HOST}:${PORT}`));
