import { useState, useEffect } from 'react';
import api from '../services/api';
import { Toggle, Icon } from '../components/primitives';

export default function Settings() {
  const [section, setSection] = useState('trading');
  const [settings, setSettings] = useState(null);

  // Form state
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
  const [enableShort, setEnableShort] = useState(true);
  const [ofiEnabled, setOfiEnabled] = useState(false);
  const [balanceResult, setBalanceResult] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [bybitStatus, setBybitStatus] = useState(null); // inline status for Bybit section

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
      setEnableShort(data.allowShort ?? true);
      setOfiEnabled(data.ofiEnabled ?? false);
      setTgToken(data.telegramToken || '');
      setTgChatId(data.telegramChatId || '');
    }).catch(() => {});
  }, []);

  const showStatus = (ok, msg) => {
    setSaveStatus({ ok, msg });
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const savePrompt = async () => {
    try {
      await api.put('/settings/prompt', { prompt });
      showStatus(true, 'Prompt saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveKeys = async () => {
    if (!apiKey || !secret) return showStatus(false, 'Both API Key and Secret required');
    try {
      await api.put('/settings/keys', { apiKey, secret });
      showStatus(true, 'Binance keys saved');
      setApiKey(''); setSecret('');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveBybitKeys = async () => {
    if (!bybitApiKey || !bybitSecret) {
      setBybitStatus({ ok: false, msg: 'Both API Key and Secret required' });
      return;
    }
    setBybitStatus({ ok: null, msg: 'Saving…' });
    try {
      await api.put('/settings/bybit-keys', { apiKey: bybitApiKey, secret: bybitSecret });
      setBybitApiKey(''); setBybitSecret('');
      // Auto-test connection after saving
      setBybitStatus({ ok: null, msg: 'Testing connection…' });
      try {
        const { data } = await api.get('/balance/test-bybit');
        const balances = data.balances || [];
        const perms = data.permissions;

        let permLine = '';
        if (perms && !perms.error) {
          if (perms.readOnly) permLine = ' · ⚠ Read-only key — trading disabled';
          else if (perms.canTrade) permLine = ' · Trade ✓';
          else permLine = ' · ⚠ No SpotTrade permission — orders will fail';
        }

        const balLine = balances.length === 0
          ? 'No assets found'
          : balances.map(b => `${b.asset} ${parseFloat(b.free).toFixed(4)}`).join(' · ');

        const ok = perms?.canTrade ? true : null;
        setBybitStatus({ ok, msg: `Keys saved · ${balLine}${permLine}` });
        window.dispatchEvent(new CustomEvent('finik:balance-refresh'));
      } catch (err) {
        const reason = err.response?.data?.error || err.message || 'unknown error';
        setBybitStatus({ ok: false, msg: `Keys saved · Connection failed: ${reason}` });
      }
      setTimeout(() => setBybitStatus(null), 12000);
    } catch (err) {
      setBybitStatus({ ok: false, msg: err.response?.data?.error || 'Save failed' });
    }
  };

  const saveExchange = async (value) => {
    try {
      await api.put('/settings/exchange', { exchange: value });
      setExchange(value);
      showStatus(true, `Exchange switched to ${value}`);
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveTelegram = async () => {
    try {
      await api.put('/settings/telegram', {
        token: tgToken === '****' ? undefined : (tgToken || null),
        chatId: tgChatId === '****' ? undefined : (tgChatId || null),
      });
      showStatus(true, 'Telegram settings saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveThreshold = async () => {
    try {
      await api.put('/settings/threshold', { dipThreshold: Number(threshold) });
      showStatus(true, 'Threshold saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveAutoTrade = async () => {
    try {
      await api.put('/settings/autotrade', { autoTrade, autoTradeAmount: Number(autoTradeAmount), maxOpenTrades: Number(maxOpenTrades), allowShort: enableShort });
      showStatus(true, 'Auto-trade settings saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveOfi = async (value) => {
    try {
      await api.put('/settings/ofi', { ofiEnabled: value });
      setOfiEnabled(value);
      showStatus(true, `OFI strategy ${value ? 'enabled' : 'disabled'}`);
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const saveConfidence = async () => {
    try {
      await api.put('/settings/confidence', { minConfidence: Number(minConfidence) });
      showStatus(true, 'Min confidence saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const testConnection = async () => {
    setBalanceResult(null);
    setBybitStatus({ ok: null, msg: 'Testing connection…' });
    try {
      const { data } = await api.get('/balance/test-bybit');

      const perms = data.permissions;
      const balances = data.balances || [];

      // Build permission line
      let permLine = '';
      if (perms && !perms.error) {
        if (perms.readOnly) {
          permLine = ' · ⚠ Read-only key — trading disabled';
        } else if (perms.canTrade) {
          permLine = ' · Trade ✓';
        } else {
          permLine = ' · ⚠ No SpotTrade permission — orders will fail';
        }
      } else if (perms?.error) {
        permLine = ` · Permissions check failed: ${perms.error}`;
      }

      // Build balance line
      let balLine = '';
      if (balances.length === 0) {
        balLine = 'No assets found';
      } else {
        balLine = balances.map(b => `${b.asset} ${parseFloat(b.free).toFixed(4)}`).join(' · ');
      }

      const ok = perms?.canTrade ? true : null;
      setBybitStatus({ ok, msg: `${balLine}${permLine}` });
      window.dispatchEvent(new CustomEvent('finik:balance-refresh'));
      setTimeout(() => setBybitStatus(null), 12000);
    } catch (err) {
      setBybitStatus({ ok: false, msg: err.response?.data?.error || err.message });
    }
  };

  if (!settings) {
    return <div style={{color: 'var(--text-3)', padding: 48, textAlign: 'center'}}>Loading...</div>;
  }

  const navItems = [
    { id: 'trading', label: 'Trading rules' },
    { id: 'exchange', label: 'Exchange keys' },
    { id: 'claude', label: 'Claude AI' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'account', label: 'Account & security' },
  ];

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>Settings</h1>
          <p>Signal configuration, exchange connection and notifications</p>
        </div>
        <div className="topbar-actions">
          {saveStatus && (
            <span style={{
              fontSize: 13,
              color: saveStatus.ok ? 'var(--long)' : 'var(--short)',
              background: saveStatus.ok ? 'color-mix(in srgb, var(--long) 10%, transparent)' : 'color-mix(in srgb, var(--short) 10%, transparent)',
              padding: '6px 12px', borderRadius: 'var(--radius)',
            }}>
              {saveStatus.msg}
            </span>
          )}
        </div>
      </div>

      <div className="settings-layout">
        <div className="settings-nav">
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              className={`settings-nav-item ${section === id ? 'active' : ''}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings-panel">
          {/* ===== Trading rules ===== */}
          {section === 'trading' && (
            <>
              <div className="settings-section">
                <h3>Signal detection</h3>
                <p className="subtitle">Thresholds and filters for OBD pattern detection</p>

                <div className="row-setting">
                  <div className="row-setting-info">
                    <strong>Dip threshold</strong>
                    <span>Minimum OBD amplitude for signal detection (1–50)</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <input className="input mono" style={{width: 80}} type="number" min={1} max={50} value={threshold} onChange={e => setThreshold(e.target.value)}/>
                    <button className="btn btn-ghost" onClick={saveThreshold}>Save</button>
                  </div>
                </div>

                <div className="row-setting">
                  <div className="row-setting-info">
                    <strong>Min confidence</strong>
                    <span>Signals below this threshold won't be sent to Telegram</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 12, width: 280}}>
                    <input
                      type="range"
                      className="slider"
                      min="0" max="100"
                      value={minConfidence}
                      onChange={e => setMinConfidence(e.target.value)}
                    />
                    <span className="mono" style={{fontWeight: 600, color: 'var(--primary)', minWidth: 40}}>{minConfidence}%</span>
                    <button className="btn btn-ghost" onClick={saveConfidence} style={{padding: '6px 10px', fontSize: 12}}>Save</button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Auto-trading</h3>
                <p className="subtitle">Automatically execute trades on confirmed signals</p>

                <div className="row-setting">
                  <div className="row-setting-info">
                    <strong>Enable auto-trading</strong>
                    <span>Automatically place order when signal is confirmed</span>
                  </div>
                  <Toggle on={autoTrade} onChange={setAutoTrade}/>
                </div>

                {autoTrade && (
                  <>
                    <div className="row-setting">
                      <div className="row-setting-info">
                        <strong>Amount per trade (USDT)</strong>
                        <span>Position size in USDT per auto-trade</span>
                      </div>
                      <input className="input mono" style={{width: 120}} type="number" min={1} value={autoTradeAmount} onChange={e => setAutoTradeAmount(e.target.value)}/>
                    </div>
                    <div className="row-setting">
                      <div className="row-setting-info">
                        <strong>Max open trades</strong>
                        <span>Maximum number of simultaneous positions</span>
                      </div>
                      <input className="input mono" style={{width: 120}} type="number" min={1} max={10} value={maxOpenTrades} onChange={e => setMaxOpenTrades(e.target.value)}/>
                    </div>
                    <div className="row-setting">
                      <div className="row-setting-info">
                        <strong>Enable SHORT signals</strong>
                        <span>Auto-trades on SHORT (sell asset from balance)</span>
                      </div>
                      <Toggle on={enableShort} onChange={setEnableShort}/>
                    </div>

                    {autoTrade && (
                      <div style={{marginTop: 12, padding: 12, background: 'color-mix(in srgb, var(--warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 25%, transparent)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--warn)'}}>
                        Auto-trading active. SHORT signals sell the asset from portfolio (not futures short). Make sure exchange API keys are configured with trading permissions.
                      </div>
                    )}
                  </>
                )}

                <div style={{marginTop: 16}}>
                  <button className="btn btn-primary" onClick={saveAutoTrade}>Save auto-trade</button>
                </div>
              </div>

              <div className="settings-section">
                <h3>Signal strategies</h3>
                <p className="subtitle">Active detection strategies run in parallel</p>

                <div className="row-setting">
                  <div className="row-setting-info">
                    <strong>OBD — Order Book Depth</strong>
                    <span>Detects pressure from order book imbalance (always active)</span>
                  </div>
                  <Toggle on={true} onChange={() => {}}/>
                </div>

                <div className="row-setting">
                  <div className="row-setting-info">
                    <strong>OFI — Order Flow Imbalance</strong>
                    <span>Detects pressure from real executed trades (60s window)</span>
                  </div>
                  <Toggle on={ofiEnabled} onChange={saveOfi}/>
                </div>
              </div>

              <div className="settings-section">
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4}}>
                  <h3 style={{margin: 0}}>Emergency stop</h3>
                  <span className="badge badge-pending">Live</span>
                </div>
                <p className="subtitle">Stops all auto-trades and disconnects from Binance</p>
                <button className="btn btn-short" style={{marginTop: 8}}>Stop all trading</button>
              </div>
            </>
          )}

          {/* ===== Exchange keys ===== */}
          {section === 'exchange' && (
            <>
              <div className="settings-section">
                <h3>Active Exchange</h3>
                <p className="subtitle">Select the exchange to use for trading</p>
                <div style={{display: 'flex', gap: 8}}>
                  {['binance', 'bybit'].map(ex => (
                    <button
                      key={ex}
                      onClick={() => saveExchange(ex)}
                      className={`btn ${exchange === ex ? 'btn-primary' : 'btn-ghost'}`}
                      style={{textTransform: 'capitalize'}}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <h3>Binance API</h3>
                <p className="subtitle">Keys stored encrypted (AES-256-GCM) in database. Current: {settings.binanceApiKey || 'Not set'}</p>
                <div className="field" style={{marginBottom: 12}}>
                  <label className="label">API Key</label>
                  <input className="input mono" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter new key"/>
                </div>
                <div className="field" style={{marginBottom: 12}}>
                  <label className="label">API Secret</label>
                  <input className="input mono" type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Enter new secret"/>
                </div>
                <button className="btn btn-primary" onClick={saveKeys}>Save Binance keys</button>
              </div>

              <div className="settings-section">
                <h3>Bybit API</h3>
                <p className="subtitle">Additional exchange. Current: {settings.bybitApiKey || 'Not configured'}</p>
                <div className="field" style={{marginBottom: 12}}>
                  <label className="label">API Key</label>
                  <input className="input mono" value={bybitApiKey} onChange={e => setBybitApiKey(e.target.value)} placeholder="Enter new key"/>
                </div>
                <div className="field" style={{marginBottom: 12}}>
                  <label className="label">API Secret</label>
                  <input className="input mono" type="password" value={bybitSecret} onChange={e => setBybitSecret(e.target.value)} placeholder="Enter new secret"/>
                </div>
                <div style={{display: 'flex', gap: 10}}>
                  <button className="btn btn-primary" onClick={saveBybitKeys}>Save Bybit keys</button>
                  <button className="btn btn-ghost" onClick={testConnection}>Test connection</button>
                </div>
                {bybitStatus && (
                  <div style={{
                    marginTop: 10, fontSize: 13, padding: '8px 12px',
                    borderRadius: 'var(--radius)',
                    color: bybitStatus.ok === true ? 'var(--long)' : bybitStatus.ok === false ? 'var(--short)' : 'var(--text-2)',
                    background: bybitStatus.ok === true
                      ? 'color-mix(in srgb, var(--long) 10%, transparent)'
                      : bybitStatus.ok === false
                      ? 'color-mix(in srgb, var(--short) 10%, transparent)'
                      : 'var(--bg-2)',
                    border: '1px solid var(--line)',
                  }}>
                    {bybitStatus.msg}
                  </div>
                )}
                {!bybitStatus && balanceResult && (
                  <div style={{marginTop: 10, fontSize: 13, color: balanceResult.ok ? 'var(--long)' : 'var(--short)'}}>
                    {balanceResult.ok ? '✓' : '✗'} {balanceResult.text}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== Claude AI ===== */}
          {section === 'claude' && (
            <div className="settings-section">
              <h3>Claude prompt</h3>
              <p className="subtitle">System prompt for Claude — context, OBD interpretation rules and output format</p>
              <textarea
                className="textarea"
                style={{minHeight: 280, fontFamily: 'var(--font-mono)', fontSize: 12}}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)'}}>
                <div style={{fontSize: 12, color: 'var(--text-3)'}}>
                  Last call: <span style={{color: 'var(--text-2)'}}>3 min ago</span>
                  {' · '}avg latency <span className="mono" style={{color: 'var(--text-2)'}}>12.4s</span>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                  <button className="btn btn-ghost">Test prompt</button>
                  <button className="btn btn-primary" onClick={savePrompt}>Save prompt</button>
                </div>
              </div>
            </div>
          )}

          {/* ===== Telegram ===== */}
          {section === 'telegram' && (
            <div className="settings-section">
              <h3>Telegram notifications</h3>
              <p className="subtitle">Signals with confidence ≥ minConfidence and order executions</p>
              <div className="field" style={{marginBottom: 14}}>
                <label className="label">Bot Token</label>
                <input className="input mono" value={tgToken} onChange={e => setTgToken(e.target.value)} placeholder="Bot token"/>
              </div>
              <div className="field" style={{marginBottom: 14}}>
                <label className="label">Chat ID</label>
                <input className="input mono" value={tgChatId} onChange={e => setTgChatId(e.target.value)} placeholder="Chat ID"/>
              </div>
              <div style={{display: 'flex', gap: 8}}>
                <button className="btn btn-ghost" onClick={() => {}}><Icon name="telegram" size={14}/>Send test</button>
                <button className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
              </div>
            </div>
          )}

          {/* ===== Account ===== */}
          {section === 'account' && (
            <div className="settings-section">
              <h3>Account</h3>
              <p className="subtitle">User data and security</p>
              <div className="field" style={{marginBottom: 12}}>
                <label className="label">Username</label>
                <input className="input" defaultValue={settings.username || 'admin'}/>
              </div>
              <div className="field" style={{marginBottom: 12}}>
                <label className="label">Email</label>
                <input className="input" defaultValue={settings.email || ''}/>
              </div>
              <button className="btn btn-ghost">Change password</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
