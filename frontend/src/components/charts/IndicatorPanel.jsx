const indicators = [
  { key: 'obd1', label: 'OBD-1', desc: '2.5%/5%' },
  { key: 'obd2', label: 'OBD-2', desc: '5%/10%' },
  { key: 'obd3', label: 'OBD-3', desc: '5%/25%' },
  { key: 'obd4', label: 'OBD-4', desc: '10%/25%' },
];

function getColor(val) {
  if (val == null) return 'text-gray-600';
  if (val >= 60) return 'text-accent-green';
  if (val >= 50) return 'text-yellow-400';
  return 'text-accent-red';
}

function getBarWidth(val) {
  return `${Math.min(Math.max(val || 0, 0), 100)}%`;
}

function getBarColor(val) {
  if (val == null) return 'bg-gray-700';
  if (val >= 60) return 'bg-accent-green';
  if (val >= 50) return 'bg-yellow-500';
  return 'bg-accent-red';
}

export default function IndicatorPanel({ obd }) {
  return (
    <div className="grid grid-cols-4 gap-2 px-3 py-2 border-t border-dark-600 bg-dark-900/50">
      {indicators.map((ind) => {
        const val = obd?.[ind.key];
        return (
          <div key={ind.key} className="text-center">
            <div className="text-[10px] text-gray-500">{ind.label}</div>
            <div className={`text-sm font-bold ${getColor(val)}`}>
              {val != null ? val.toFixed(1) : '—'}
            </div>
            <div className="h-1 bg-dark-700 rounded-full mt-0.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getBarColor(val)}`}
                style={{ width: getBarWidth(val) }}
              />
            </div>
            <div className="text-[9px] text-gray-600 mt-0.5">{ind.desc}</div>
          </div>
        );
      })}
    </div>
  );
}
