import { WebSocketServer } from 'ws';
import { logger } from '../config/logger.js';

let wss = null;
const clients = new Set();

export function initWebSocketHub(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

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
