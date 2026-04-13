import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { getSystemPrompt } from './prompts.js';
import { logger } from '../../config/logger.js';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

async function callClaude(systemPrompt, userMessage) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      return response.content[0].text;
    } catch (err) {
      const isRetryable =
        err.message?.includes('529') ||
        err.message?.includes('Overloaded') ||
        err.message?.includes('Connection error') ||
        err.message?.includes('timeout') ||
        err.status === 529 ||
        err.status === 503;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt];
        logger.warn(`Claude retry ${attempt + 1}/${MAX_RETRIES} in ${delay / 1000}s`, {
          error: err.message,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export async function analyzeSignal(pair, obd, candles, currentPrice) {
  const systemPrompt = await getSystemPrompt();

  const userMessage = `Пара для анализа: ${pair.monitorSymbol} (сигнал), торговля через ${pair.tradeSymbol}
Текущая цена: ${currentPrice}

Order Book Depth индикаторы (0-100, >50 = давление покупателей):
- OBD 2.5%/5%: ${obd.obd1}
- OBD 5%/10%: ${obd.obd2}
- OBD 5%/25%: ${obd.obd3}
- OBD 10%/25%: ${obd.obd4}

Последние 20 свечей (OHLCV, таймфрейм ${pair.timeframe}):
${JSON.stringify(candles.slice(-20))}

На основе данных дай ответ строго в JSON:
{
  "direction": "LONG" | "SHORT" | "WAIT",
  "confidence": 0-100,
  "analysis": "краткое объяснение",
  "suggestedSl": число или null,
  "suggestedTp": число или null
}`;

  logger.info('Calling Claude for signal analysis', {
    symbol: pair.monitorSymbol,
    price: currentPrice,
  });

  const text = await callClaude(systemPrompt, userMessage);
  logger.debug('Claude response', { text });

  try {
    return JSON.parse(text);
  } catch {
    logger.error('Failed to parse Claude response as JSON', { text });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: text,
      suggestedSl: null,
      suggestedTp: null,
    };
  }
}
