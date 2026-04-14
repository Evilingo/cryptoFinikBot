import express from 'express';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const API_TARGET = process.env.VITE_API_URL || 'http://localhost:3001';

const targetUrl = new URL(API_TARGET);
const isHttps = targetUrl.protocol === 'https:';
const requester = isHttps ? httpsRequest : httpRequest;

// Proxy /api and /ws to backend
app.use(['/api', '/ws'], (req, res) => {
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.hostname },
  };

  const proxy = requester(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Bad gateway' });
  });

  req.pipe(proxy, { end: true });
});

// Serve static files
app.use(express.static(join(__dirname, 'dist')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

createServer(app).listen(PORT, () => {
  console.log(`Frontend server on port ${PORT}, proxying API to ${API_TARGET}`);
});
