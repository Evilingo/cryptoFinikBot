/**
 * Exchange WebSocket Manager — hot-switches between Binance and Bybit WS services.
 * Called at startup and when the user changes the exchange in Settings.
 */

import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { startOrderBookWs, stopOrderBookWs } from '../binance/orderBookWs.js';
import { startBinanceWs, stopBinanceWs } from '../binance/websocket.js';
import { startUserDataStream, stopUserDataStream } from '../binance/userDataStream.js';
import { startBybitOrderBookWs, stopBybitOrderBookWs } from '../bybit/orderBookWs.js';
import { startBybitWs, stopBybitWs } from '../bybit/websocket.js';
import { startBybitUserDataStream, stopBybitUserDataStream } from '../bybit/userDataStream.js';
import { startAggTradeWs, stopAggTradeWs } from '../binance/aggTradeWs.js';
import { startBybitAggTradeWs, stopBybitAggTradeWs } from '../bybit/aggTradeWs.js';

let currentExchange = 'binance';
let switching = false;

export function getCurrentExchange() {
  return currentExchange;
}

function startExchangeServices(exchange) {
  if (exchange === 'bybit') {
    if (env.bybitTestnet) logger.info('[Bybit] TESTNET mode active: https://api-testnet.bybit.com');
    logger.info('Starting Bybit WebSocket services');
    startBybitOrderBookWs();
    startBybitWs();
    startBybitAggTradeWs();
    startBybitUserDataStream().catch((err) => logger.warn('Bybit User Data Stream start failed', { error: err.message }));
  } else {
    logger.info('Starting Binance WebSocket services');
    startOrderBookWs();
    startBinanceWs();
    startAggTradeWs();
    startUserDataStream().catch((err) => logger.warn('User Data Stream start failed', { error: err.message }));
  }
}

function stopExchangeServices(exchange) {
  if (exchange === 'bybit') {
    stopBybitOrderBookWs();
    stopBybitWs();
    stopBybitAggTradeWs();
    stopBybitUserDataStream();
  } else {
    stopOrderBookWs();
    stopBinanceWs();
    stopAggTradeWs();
    stopUserDataStream();
  }
}

export function initExchangeWs(exchange) {
  currentExchange = exchange;
  startExchangeServices(exchange);
}

export async function switchExchangeWs(newExchange) {
  if (currentExchange === newExchange) {
    logger.info(`Exchange WS already running: ${newExchange}`);
    return;
  }

  if (switching) {
    logger.warn('Exchange switch already in progress, ignoring');
    return;
  }

  switching = true;
  try {
    logger.info(`Switching WebSocket services: ${currentExchange} → ${newExchange}`);
    stopExchangeServices(currentExchange);
    await new Promise((r) => setTimeout(r, 1000));
    currentExchange = newExchange;
    startExchangeServices(newExchange);
    logger.info(`WebSocket services switched to ${newExchange}`);
  } finally {
    switching = false;
  }
}

export function stopAllExchangeWs() {
  stopOrderBookWs();
  stopBinanceWs();
  stopAggTradeWs();
  stopUserDataStream();
  stopBybitOrderBookWs();
  stopBybitWs();
  stopBybitAggTradeWs();
  stopBybitUserDataStream();
}
