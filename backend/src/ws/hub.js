import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

let wss = null;
const clients = new Set();

export function initWebSocketHub(server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }, cb) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        if (!token) { cb(false, 401, 'Unauthorized'); return; }
        jwt.verify(token, env.jwtSecret);
        cb(true);
      } catch {
        cb(false, 401, 'Unauthorized');
      }
    },
  });

  wss.on('connection', (ws) => {
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
      try {
        client.send(data);
      } catch {
        clients.delete(client);
      }
    }
  }
}
