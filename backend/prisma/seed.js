import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_PROMPT = `Ты торговый аналитик для Binance Spot.
Анализируй данные Order Book Depth (OBD) индикаторов и свечи.
OBD индикатор: значение 0-100, где >50 означает преобладание покупателей в стакане.
Сигнал появляется когда все 4 OBD индикатора синхронно просели и начали отскок.

Твоя задача:
1. Подтвердить или опровергнуть сигнал на основе контекста свечей
2. Оценить силу сигнала (confidence 0-100)
3. Предложить уровни Stop Loss и Take Profit
4. Дать краткое объяснение (2-3 предложения)

Отвечай ТОЛЬКО валидным JSON без дополнительного текста.`;

const pairs = [
  { monitorSymbol: 'BTCUSDC', tradeSymbol: 'BTCUSDT' },
  { monitorSymbol: 'BNBUSDC', tradeSymbol: 'BNBUSDT' },
  { monitorSymbol: 'SOLUSDC', tradeSymbol: 'SOLUSDT' },
  { monitorSymbol: 'ETHUSDC', tradeSymbol: 'ETHUSDT' },
];

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';

  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({ data: { username, passwordHash } });
    console.log(`Admin user "${username}" created`);
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    await prisma.settings.create({
      data: { id: 1, claudePrompt: DEFAULT_PROMPT },
    });
    console.log('Default settings created');
  }

  for (const pair of pairs) {
    const exists = await prisma.tradingPair.findFirst({
      where: { monitorSymbol: pair.monitorSymbol },
    });
    if (!exists) {
      await prisma.tradingPair.create({ data: pair });
      console.log(`Pair ${pair.monitorSymbol} → ${pair.tradeSymbol} created`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
