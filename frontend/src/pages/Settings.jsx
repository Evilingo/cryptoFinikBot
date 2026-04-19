import { useState, useEffect } from 'react';
import api from '../services/api';
import { Toggle, Icon } from '../components/primitives';
import { useStatusToast } from '../hooks/useStatusToast';

function SettingRow({ label, description, children }) {
  return (
    <div className="row-setting">
      <div className="row-setting-info">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      {children}
    </div>
  );
}

function formatBybitTestResult(data) {
  const balances = data.balances || [];
  const perms = data.permissions;
  const balLine = balances.length === 0
    ? 'No assets found'
    : balances.map((b) => `${b.asset} ${parseFloat(b.free).toFixed(4)}`).join(' · ');
  let permLine = '';
  if (perms && !perms.error) {
    if (perms.readOnly) permLine = ' · ⚠ Read-only key — trading disabled';
    else if (perms.canTrade) permLine = ' · Trade ✓';
    else permLine = ' · ⚠ No SpotTrade permission — orders will fail';
  } else if (perms?.error) {
    permLine = ` · Permissions check failed: ${perms.error}`;
  }
  return { ok: perms?.canTrade ? true : null, msg: `${balLine}${permLine}` };
}

function AccountSection({ showStatus }) {
  const [profileUsername, setProfileUsername] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  useEffect(() => {
    api.get('/auth/profile').then(({ data }) => {
      setProfileUsername(data.username || '');
      setProfileEmail(data.email || '');
    }).catch(() => showStatus(false, 'Failed to load profile'));
  }, []);

  const saveProfile = async () => {
    try {
      await api.put('/auth/profile', { username: profileUsername, email: profileEmail });
      showStatus(true, 'Account saved');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Save failed');
    }
  };

  const savePwd = async () => {
    if (!newPwd) {
      showStatus(false, 'New password is required');
      return;
    }
    if (newPwd !== confirmPwd) {
      showStatus(false, 'New passwords do not match');
      return;
    }
    try {
      await api.put('/auth/change-password', { currentPassword: currentPwd, newPassword: newPwd });
      showStatus(true, 'Password changed');
      setShowPwForm(false);
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Change failed');
    }
  };

  return (
    <div className="settings-section">
      <h3>Account</h3>
      <p className="subtitle">User data and security</p>
      <div className="field" style={{marginBottom: 12}}>
        <label className="label">Username</label>
        <input className="input" value={profileUsername} onChange={e => setProfileUsername(e.target.value)}/>
      </div>
      <div className="field" style={{marginBottom: 12}}>
        <label className="label">Email</label>
        <input className="input" value={profileEmail} onChange={e => setProfileEmail(e.target.value)}/>
      </div>
      <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
        <button className="btn btn-primary" onClick={saveProfile}>Save account</button>
        <button className="btn btn-ghost" onClick={() => setShowPwForm(!showPwForm)}>
          Change password
        </button>
      </div>
      {showPwForm && (
        <div style={{paddingTop: 16, borderTop: '1px solid var(--line)'}}>
          <div className="field" style={{marginBottom: 12}}>
            <label className="label">Current password</label>
            <input className="input" type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}/>
          </div>
          <div className="field" style={{marginBottom: 12}}>
            <label className="label">New password</label>
            <input className="input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}/>
          </div>
          <div className="field" style={{marginBottom: 16}}>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}/>
          </div>
          <button className="btn btn-primary" onClick={savePwd}>Save password</button>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [section, setSection] = useState('trading');
  const [settings, setSettings] = useState(null);

  // Form state
  const [prompt, setPrompt] = useState('');
  const [ofiPrompt, setOfiPrompt] = useState('');
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
  const { status: saveStatus, showStatus } = useStatusToast();
  const [bybitStatus, setBybitStatus] = useState(null); // inline status for Bybit section
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setSettings(data);
      setPrompt(data.claudePrompt || '');
      setOfiPrompt(data.ofiClaudePrompt || '');
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

  const apiSave = (endpoint, payload, msg = 'Saved') =>
    api.put(endpoint, payload)
      .then(() => showStatus(true, msg))
      .catch(err => showStatus(false, err.response?.data?.error || 'Save failed'));

  const savePrompt = () => apiSave('/settings/prompt', { prompt }, 'OBD prompt saved');

  const saveOfiPrompt = () => apiSave('/settings/ofi-prompt', { prompt: ofiPrompt }, 'OFI prompt saved');

  const saveKeys = () => {
    if (!apiKey || !secret) return showStatus(false, 'Both API Key and Secret required');
    apiSave('/settings/keys', { apiKey, secret }, 'Binance keys saved')
      .then(() => { setApiKey(''); setSecret(''); });
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
      setBybitStatus({ ok: null, msg: 'Testing connection…' });
      try {
        const { data } = await api.get('/balance/test-bybit');
        const result = formatBybitTestResult(data);
        setBybitStatus({ ...result, msg: `Keys saved · ${result.msg}` });
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

  const saveExchange = (value) =>
    apiSave('/settings/exchange', { exchange: value }, `Exchange switched to ${value}`)
      .then(() => setExchange(value));

  const saveTelegram = () => apiSave('/settings/telegram', {
    token: tgToken === '****' ? undefined : (tgToken || null),
    chatId: tgChatId === '****' ? undefined : (tgChatId || null),
  }, 'Telegram settings saved');

  const saveThreshold = () => apiSave('/settings/threshold', { dipThreshold: Number(threshold) }, 'Threshold saved');

  const saveAutoTrade = () => apiSave('/settings/autotrade', { autoTrade, autoTradeAmount: Number(autoTradeAmount), maxOpenTrades: Number(maxOpenTrades), allowShort: enableShort }, 'Auto-trade settings saved');

  const saveOfi = (value) =>
    apiSave('/settings/ofi', { ofiEnabled: value }, `OFI strategy ${value ? 'enabled' : 'disabled'}`)
      .then(() => setOfiEnabled(value));

  const saveConfidence = () => apiSave('/settings/confidence', { minConfidence: Number(minConfidence) }, 'Min confidence saved');

  const testConnection = async () => {
    setBalanceResult(null);
    setBybitStatus({ ok: null, msg: 'Testing connection…' });
    try {
      const { data } = await api.get('/balance/test-bybit');
      setBybitStatus(formatBybitTestResult(data));
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

                <SettingRow label="Dip threshold" description="Minimum OBD amplitude for signal detection (1–50)">
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <input className="input mono" style={{width: 80}} type="number" min={1} max={50} value={threshold} onChange={e => setThreshold(e.target.value)}/>
                    <button className="btn btn-ghost" onClick={saveThreshold}>Save</button>
                  </div>
                </SettingRow>

                <SettingRow label="Min confidence" description="Signals below this threshold won't be sent to Telegram">
                  <div style={{display: 'flex', alignItems: 'center', gap: 12, width: 280}}>
                    <input type="range" className="slider" min="0" max="100" value={minConfidence} onChange={e => setMinConfidence(e.target.value)}/>
                    <span className="mono" style={{fontWeight: 600, color: 'var(--primary)', minWidth: 40}}>{minConfidence}%</span>
                    <button className="btn btn-ghost" onClick={saveConfidence} style={{padding: '6px 10px', fontSize: 12}}>Save</button>
                  </div>
                </SettingRow>
              </div>

              <div className="settings-section">
                <h3>Auto-trading</h3>
                <p className="subtitle">Automatically execute trades on confirmed signals</p>

                <SettingRow label="Enable auto-trading" description="Automatically place order when signal is confirmed">
                  <Toggle on={autoTrade} onChange={setAutoTrade}/>
                </SettingRow>

                {autoTrade && (
                  <>
                    <SettingRow label="Amount per trade (USDT)" description="Position size in USDT per auto-trade">
                      <input className="input mono" style={{width: 120}} type="number" min={1} value={autoTradeAmount} onChange={e => setAutoTradeAmount(e.target.value)}/>
                    </SettingRow>
                    <SettingRow label="Max open trades" description="Maximum number of simultaneous positions">
                      <input className="input mono" style={{width: 120}} type="number" min={1} max={10} value={maxOpenTrades} onChange={e => setMaxOpenTrades(e.target.value)}/>
                    </SettingRow>
                    <SettingRow label="Enable SHORT signals" description="Auto-trades on SHORT (sell asset from balance)">
                      <Toggle on={enableShort} onChange={setEnableShort}/>
                    </SettingRow>

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

                <SettingRow label="OBD — Order Book Depth" description="Detects pressure from order book imbalance (always active)">
                  <Toggle on={true} onChange={() => {}}/>
                </SettingRow>

                <SettingRow label="OFI — Order Flow Imbalance" description="Detects pressure from real executed trades (60s window)">
                  <Toggle on={ofiEnabled} onChange={saveOfi}/>
                </SettingRow>
              </div>

              <div className="settings-section">
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4}}>
                  <h3 style={{margin: 0}}>Emergency stop</h3>
                  <span className="badge badge-pending">Live</span>
                </div>
                <p className="subtitle">Stops all auto-trades and disconnects from Binance</p>
                <button className="btn btn-short" style={{marginTop: 8}} onClick={async () => {
                  try {
                    await api.put('/settings/autotrade', { autoTrade: false, autoTradeAmount: Number(autoTradeAmount), maxOpenTrades: Number(maxOpenTrades), allowShort: enableShort });
                    setAutoTrade(false);
                    showStatus(true, 'Auto-trading stopped');
                  } catch (err) {
                    showStatus(false, err.response?.data?.error || 'Stop failed');
                  }
                }}>Stop all trading</button>
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
            <>
              <div className="settings-section">
                <h3>OBD prompt</h3>
                <p className="subtitle">System prompt for OBD signals — order book depth interpretation rules</p>
                <textarea
                  className="textarea"
                  style={{minHeight: 280, fontFamily: 'var(--font-mono)', fontSize: 12}}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)'}}>
                  <button className="btn btn-ghost" disabled={testLoading} onClick={async () => {
                    setTestLoading(true);
                    setTestResult(null);
                    try {
                      const { data } = await api.post('/settings/test-prompt');
                      setTestResult(data);
                    } catch (err) {
                      setTestResult({ ok: false, error: err.response?.data?.error || err.message });
                    }
                    setTestLoading(false);
                  }}>{testLoading ? 'Testing…' : 'Test prompt'}</button>
                  <button className="btn btn-primary" onClick={savePrompt}>Save OBD prompt</button>
                </div>
                {testResult && (
                  <div style={{marginTop: 12, padding: 12, borderRadius: 'var(--radius)', background: 'var(--bg-2)', border: '1px solid var(--line)'}}>
                    {testResult.ok ? (
                      <>
                        {testResult.direction && (
                          <div style={{marginBottom: 6, fontSize: 13, fontWeight: 600, color: testResult.direction === 'LONG' ? 'var(--long)' : testResult.direction === 'SHORT' ? 'var(--short)' : 'var(--text-2)'}}>
                            {testResult.direction}{testResult.confidence != null ? ` · confidence ${testResult.confidence}` : ''}
                          </div>
                        )}
                        <pre style={{margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-2)', fontFamily: 'var(--font-mono)'}}>{testResult.response}</pre>
                      </>
                    ) : (
                      <div style={{fontSize: 13, color: 'var(--short)'}}>{testResult.error}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="settings-section">
                <h3>OFI prompt</h3>
                <p className="subtitle">System prompt for OFI signals — order flow imbalance interpretation rules</p>
                <textarea
                  className="textarea"
                  style={{minHeight: 280, fontFamily: 'var(--font-mono)', fontSize: 12}}
                  value={ofiPrompt}
                  onChange={e => setOfiPrompt(e.target.value)}
                />
                <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)'}}>
                  <button className="btn btn-primary" onClick={saveOfiPrompt}>Save OFI prompt</button>
                </div>
              </div>
            </>
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
                <button className="btn btn-ghost" onClick={async () => {
                  try {
                    await api.post('/telegram/test');
                    showStatus(true, 'Test sent');
                  } catch (err) {
                    showStatus(false, err.response?.data?.error || 'Send failed');
                  }
                }}><Icon name="telegram" size={14}/>Send test</button>
                <button className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
              </div>
            </div>
          )}

          {/* ===== Account ===== */}
          {section === 'account' && (
            <AccountSection showStatus={showStatus} />
          )}
        </div>
      </div>
    </>
  );
}
