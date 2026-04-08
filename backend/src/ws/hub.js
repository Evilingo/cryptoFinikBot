import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let wss = null;
const clients = new Set();

export function initWebSocketHub(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Auth via query param: ?token=xxx
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'No token');
      return;
    }

    try {
      jwt.verify(token, env.jwtSecret);
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    clients.add(ws);
    logger.info('WS client connected', { total: clients.size });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WS client disconnected', { total: clients.size });
    });

    ws.on('error', (err) => {
      logger.error('WS client error', { error: err.message });
      clients.delete(ws);
    });
  });

  logger.info('WebSocket Hub initialized');
}

export function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}
