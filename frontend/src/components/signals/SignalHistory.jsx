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
            <th className="text-right px-4 py-3 font-medium">OBD-1</th>
            <th className="text-right px-4 py-3 font-medium">OBD-2</th>
            <th className="text-right px-4 py-3 font-medium">OBD-3</th>
            <th className="text-right px-4 py-3 font-medium">OBD-4</th>
            <th className="text-left px-4 py-3 font-medium">Analysis</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={s.id} className="border-b border-dark-700 hover:bg-dark-700/50">
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
              <td className="px-4 py-3 text-right font-mono">{s.obd1?.toFixed(1)}</td>
              <td className="px-4 py-3 text-right font-mono">{s.obd2?.toFixed(1)}</td>
              <td className="px-4 py-3 text-right font-mono">{s.obd3?.toFixed(1)}</td>
              <td className="px-4 py-3 text-right font-mono">{s.obd4?.toFixed(1)}</td>
              <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">
                {s.claudeAnalysis}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
