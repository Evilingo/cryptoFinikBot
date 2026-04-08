export default function SignalAlert({ signal, onClose }) {
  if (!signal) return null;

  const dirColor = signal.direction === 'LONG' ? 'text-accent-green' : signal.direction === 'SHORT' ? 'text-accent-red' : 'text-gray-400';

  return (
    <div className="fixed top-4 right-4 w-96 bg-dark-800 border border-dark-500 rounded-xl shadow-2xl p-4 z-50 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-lg font-bold ${dirColor}`}>
          {signal.direction} {signal.monitorSymbol}
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
      </div>
      <div className="text-sm text-gray-300 mb-2">{signal.claudeAnalysis}</div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span>Price: ${signal.price?.toLocaleString()}</span>
        {signal.suggestedSl && <span>SL: ${signal.suggestedSl.toLocaleString()}</span>}
        {signal.suggestedTp && <span>TP: ${signal.suggestedTp.toLocaleString()}</span>}
      </div>
      <div className="flex gap-2 mt-2 text-xs text-gray-500">
        <span>OBD: {signal.obd1?.toFixed(1)}</span>
        <span>| {signal.obd2?.toFixed(1)}</span>
        <span>| {signal.obd3?.toFixed(1)}</span>
        <span>| {signal.obd4?.toFixed(1)}</span>
      </div>
    </div>
  );
}
