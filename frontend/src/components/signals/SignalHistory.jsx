import { useState } from 'react';

function ConfidenceBadge({ value }) {
  if (value == null) return <span className="text-gray-600 font-mono text-xs">—</span>;
  const color = value >= 70 ? 'text-accent-green bg-green-500/10'
    : value >= 50 ? 'text-yellow-400 bg-yellow-500/10'
    : 'text-accent-red bg-red-500/10';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${color}`}>
      {value}%
    </span>
  );
}

function SignalRow({ s }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-dark-700 hover:bg-dark-700/50 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
          {new Date(s.createdAt).toLocaleString('ru-RU')}
        </td>
        <td className="px-4 py-3 font-medium">
          {s.pair?.monitorSymbol?.replace('USDC', '')}
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            s.direction === 'LONG' ? 'bg-green-500/10 text-accent-green'
              : s.direction === 'SHORT' ? 'bg-red-500/10 text-accent-red'
                : 'bg-gray-500/10 text-gray-400'
          }`}>
            {s.direction}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono">${s.price?.toLocaleString()}</td>
        <td className="px-4 py-3 text-right">
          <ConfidenceBadge value={s.confidence} />
        </td>
        <td className="px-4 py-3 text-right font-mono">{s.obd1?.toFixed(1)}</td>
        <td className="px-4 py-3 text-right font-mono">{s.obd2?.toFixed(1)}</td>
        <td className="px-4 py-3 text-right font-mono">{s.obd3?.toFixed(1)}</td>
        <td className="px-4 py-3 text-right font-mono">{s.obd4?.toFixed(1)}</td>
        <td className="px-4 py-3 text-gray-400 text-xs">
          <div className="flex items-center gap-2">
            <span className="truncate max-w-[220px]">{s.claudeAnalysis}</span>
            <span className="text-gray-600 shrink-0">{expanded ? '▲' : '▼'}</span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-dark-700 bg-dark-900/60">
          <td colSpan={10} className="px-6 py-4">
            <div className="text-xs text-gray-500 mb-1 font-medium">Claude Analysis</div>
            <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap mb-3">
              {s.claudeAnalysis}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span>OBD: {s.obd1?.toFixed(1)} | {s.obd2?.toFixed(1)} | {s.obd3?.toFixed(1)} | {s.obd4?.toFixed(1)}</span>
              {s.suggestedSl && <span>SL: ${s.suggestedSl?.toLocaleString()}</span>}
              {s.suggestedTp && <span>TP: ${s.suggestedTp?.toLocaleString()}</span>}
              {s.outcome && (
                <span className={
                  s.outcome === 'WIN' ? 'text-accent-green' :
                  s.outcome === 'LOSS' ? 'text-accent-red' : 'text-gray-400'
                }>
                  {s.outcome} {s.outcomePnl != null ? `(${s.outcomePnl > 0 ? '+' : ''}${s.outcomePnl}%)` : ''}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function SignalHistory({ signals }) {
  if (!signals.length) {
    return <div className="text-gray-500 text-sm">No signals yet</div>;
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs border-b border-dark-600">
            <th className="text-left px-4 py-3 font-medium">Time</th>
            <th className="text-left px-4 py-3 font-medium">Pair</th>
            <th className="text-left px-4 py-3 font-medium">Direction</th>
            <th className="text-right px-4 py-3 font-medium">Price</th>
            <th className="text-right px-4 py-3 font-medium">Confidence</th>
            <th className="text-right px-4 py-3 font-medium">OBD-1</th>
            <th className="text-right px-4 py-3 font-medium">OBD-2</th>
            <th className="text-right px-4 py-3 font-medium">OBD-3</th>
            <th className="text-right px-4 py-3 font-medium">OBD-4</th>
            <th className="text-left px-4 py-3 font-medium">Analysis</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <SignalRow key={s.id} s={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
