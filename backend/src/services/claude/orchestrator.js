import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { getSystemPrompt } from './prompts.js';
import { logger } from '../../config/logger.js';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;
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
