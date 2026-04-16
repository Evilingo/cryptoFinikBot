import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [bybitApiKey, setBybitApiKey] = useState('');
  const [bybitSecret, setBybitSecret] = useState('');
  const [exchange, setExchange] = useState('binance');
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [threshold, setThreshold] = useState(10);
  const [minConfidence, setMinConfidence] = useState(65);
  const [autoTrade, setAutoTrade] = useState(false);
  const [autoTradeAmount, setAutoTradeAmount] = useState(10);
  const [maxOpenTrades, setMaxOpenTrades] = useState(1);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setSettings(data);
      setPrompt(data.claudePrompt || '');
      setExchange(data.exchange || 'binance');
      setThreshold(data.dipThreshold ?? 10);
      setMinConfidence(data.minConfidence ?? 65);
      setAutoTrade(data.autoTrade ?? false);
      setAutoTradeAmount(data.autoTradeAmount ?? 10);
      setMaxOpenTrades(data.maxOpenTrades ?? 1);
      setTgToken(data.telegramToken || '');
      setTgChatId(data.telegramChatId || '');
    }).catch(() => toast.error('Failed to load settings'));
  }, []);

  const savePrompt = async () => {
    try {
      await api.put('/settings/prompt', { prompt });
      toast.success('Prompt saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveKeys = async () => {
    if (!apiKey || !secret) return toast.error('Both API Key and Secret required');
    try {
      await api.put('/settings/keys', { apiKey, secret });
      toast.success('Binance keys saved');
      setApiKey('');
      setSecret('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveBybitKeys = async () => {
    if (!bybitApiKey || !bybitSecret) return toast.error('Both API Key and Secret required');
    try {
      await api.put('/settings/bybit-keys', { apiKey: bybitApiKey, secret: bybitSecret });
      toast.success('Bybit keys saved');
      setBybitApiKey('');
      setBybitSecret('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveExchange = async (value) => {
    try {
      await api.put('/settings/exchange', { exchange: value });
      setExchange(value);
      toast.success(`Exchange switched to ${value}. Restart server to apply WebSocket changes.`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveTelegram = async () => {
    try {
      // Send undefined (not null) if field still shows masked placeholder — backend will preserve existing value
      await api.put('/settings/telegram', {
        token: tgToken === '****' ? undefined : (tgToken || null),
        chatId: tgChatId === '****' ? undefined : (tgChatId || null),
      });
      toast.success('Telegram settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveThreshold = async () => {
    try {
      await api.put('/settings/threshold', { dipThreshold: Number(threshold) });
      toast.success('Threshold saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveAutoTrade = async () => {
    try {
      await api.put('/settings/autotrade', {
        autoTrade,
        autoTradeAmount: Number(autoTradeAmount),
        maxOpenTrades: Number(maxOpenTrades),
      });
      toast.success('Auto-trade settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const saveConfidence = async () => {
    try {
      await api.put('/settings/confidence', { minConfidence: Number(minConfidence) });
      toast.success('Min confidence saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  if (!settings) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Claude Prompt */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Claude System Prompt</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          className="w-full font-mono text-sm"
        />
        <button onClick={savePrompt} className="mt-3 px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
          Save Prompt
        </button>
      </section>

      {/* Exchange Selector */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Exchange</h2>
        <p className="text-xs text-gray-500 mb-4">
          После смены биржи нужно перезапустить сервер (Railway redeploy) чтобы переключились WebSocket соединения.
        </p>
        <div className="flex gap-3">
          {['binance', 'bybit'].map((ex) => (
            <button
              key={ex}
              onClick={() => saveExchange(ex)}
              className={`px-5 py-2 rounded-lg text-sm font-medium capitalize ${exchange === ex ? 'bg-accent-blue' : 'bg-dark-600 hover:bg-dark-500'}`}
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Активная биржа: <span className="text-white font-medium capitalize">{exchange}</span></p>
      </section>

      {/* Binance Keys */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Binance API Keys</h2>
        <p className="text-sm text-gray-500 mb-3">
          Current: {settings.binanceApiKey || 'Not set'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">API Key</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full" placeholder="Enter new key" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Secret</label>
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full" placeholder="Enter new secret" />
          </div>
        </div>
        <button onClick={saveKeys} className="mt-3 px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
          Save Keys
        </button>
      </section>

      {/* Bybit Keys */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Bybit API Keys</h2>
        <p className="text-sm text-gray-500 mb-3">
          Current: {settings.bybitApiKey || 'Not set'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">API Key</label>
            <input value={bybitApiKey} onChange={(e) => setBybitApiKey(e.target.value)} className="w-full" placeholder="Enter new key" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Secret</label>
            <input type="password" value={bybitSecret} onChange={(e) => setBybitSecret(e.target.value)} className="w-full" placeholder="Enter new secret" />
          </div>
        </div>
        <button onClick={saveBybitKeys} className="mt-3 px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
          Save Keys
        </button>
      </section>

      {/* Signal Threshold */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Signal Detection</h2>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-gray-400 w-52">Dip Threshold (1–50):</label>
          <input
            type="number"
            min={1}
            max={50}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24"
          />
          <button onClick={saveThreshold} className="px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
            Save
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-400 w-52">
            Min Confidence for Telegram (0–100):
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={minConfidence}
            onChange={(e) => setMinConfidence(e.target.value)}
            className="w-24"
          />
          <button onClick={saveConfidence} className="px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
            Save
          </button>
          <span className="text-xs text-gray-500">
            {minConfidence >= 70 ? '🟢 строгий фильтр' : minConfidence >= 50 ? '🟡 умеренный' : '🔴 всё пропускать'}
          </span>
        </div>
      </section>

      {/* Auto-Trade */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-1">Auto-Trade</h2>
        <p className="text-xs text-gray-500 mb-4">
          Автоматически открывает сделку на Binance после подтверждения Claude. Требует настроенных API ключей.
        </p>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-gray-400 w-52">Включить авто-торговлю:</label>
          <button
            onClick={() => setAutoTrade(!autoTrade)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${autoTrade ? 'bg-green-600 hover:bg-green-700' : 'bg-dark-600 hover:bg-dark-500'}`}
          >
            {autoTrade ? 'Включено' : 'Выключено'}
          </button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-gray-400 w-52">Сумма на сделку (USDT):</label>
          <input
            type="number"
            min={1}
            value={autoTradeAmount}
            onChange={(e) => setAutoTradeAmount(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-gray-400 w-52">Макс. открытых сделок:</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxOpenTrades}
            onChange={(e) => setMaxOpenTrades(e.target.value)}
            className="w-28"
          />
        </div>
        {autoTrade && (
          <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600/40 rounded-lg text-xs text-yellow-400">
            Авто-торговля активна. SHORT сигналы продают актив из портфеля (не шорт-позиция). Убедись что API ключи выбранной биржи настроены с правами на торговлю.
          </div>
        )}
        <button onClick={saveAutoTrade} className="px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
          Save Auto-Trade
        </button>
      </section>

      {/* Telegram */}
      <section className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-3">Telegram Notifications</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Bot Token</label>
            <input value={tgToken} onChange={(e) => setTgToken(e.target.value)} className="w-full" placeholder="Bot token" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Chat ID</label>
            <input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} className="w-full" placeholder="Chat ID" />
          </div>
        </div>
        <button onClick={saveTelegram} className="mt-3 px-4 py-2 bg-accent-blue hover:bg-blue-600 rounded-lg text-sm font-medium">
          Save Telegram
        </button>
      </section>
    </div>
  );
}
