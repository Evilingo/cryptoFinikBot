import { useEffect } from 'react';
import { CoinGlyph, Icon, DirectionBadge, ConfidenceBadge, formatPrice } from './primitives';

export default function LiveSignalBanner({ signal, onClose, onOpen }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 18000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const monSym = signal.monitorSymbol || signal.pair?.monitorSymbol || signal.pair || '';
  const base = monSym.replace(/USDC$|USDT$/, '');
  const analysis = signal.claudeAnalysis || signal.analysis || '';
  const price = signal.price ?? 0;

  return (
    <div className="live-signal-banner" onClick={() => onOpen && onOpen(signal)}>
      <div style={{display: 'flex', alignItems: 'flex-start', paddingTop: 2}}>
        <span className="pulse-dot"/>
      </div>
      <div className="live-signal-body">
        <div className="live-signal-row">
          <CoinGlyph symbol={base} size={22}/>
          <span style={{fontWeight: 600, fontSize: 14}}>{base}/USDC</span>
          <DirectionBadge dir={signal.direction || 'LONG'}/>
          <ConfidenceBadge value={signal.confidence}/>
          <span className="mono" style={{fontSize: 12, color: 'var(--text-2)', marginLeft: 'auto'}}>
            ${formatPrice(price)}
          </span>
        </div>
        {analysis && (
          <div className="live-signal-analysis">{analysis}</div>
        )}
      </div>
      <div className="live-signal-actions">
        <button
          className="btn btn-ghost"
          style={{fontSize: 12, padding: '6px 12px'}}
          onClick={e => { e.stopPropagation(); onClose(); }}
        >
          Dismiss
        </button>
        <button
          className="btn btn-primary"
          style={{fontSize: 12, padding: '6px 12px'}}
          onClick={e => { e.stopPropagation(); onOpen && onOpen(signal); }}
        >
          <Icon name="maximize" size={12}/>View signal
        </button>
      </div>
    </div>
  );
}
