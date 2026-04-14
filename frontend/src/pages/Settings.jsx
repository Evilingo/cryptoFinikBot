import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [threshold, setThreshold] = useState(10);
  const [minConfidence, setMinConfidence] = useState(65);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setSettings(data);
      setPrompt(data.claudePrompt || '');
      setThreshold(data.dipThreshold ?? 10);
      setMinConfidence(data.minConfidence ?? 65);
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

  const saveTelegram = async () => {
    try {
      await api.put('/settings/telegram', { token: tgToken || null, chatId: tgChatId || null });
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
