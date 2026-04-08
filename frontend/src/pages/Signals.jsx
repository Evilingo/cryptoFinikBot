import { useState, useEffect } from 'react';
import api from '../services/api';
import SignalHistory from '../components/signals/SignalHistory';

export default function Signals() {
  const [signals, setSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    api.get(`/signals?limit=${limit}&offset=${page * limit}`)
      .then(({ data }) => {
        setSignals(data.signals);
        setTotal(data.total);
      })
      .catch(() => {});
  }, [page]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Signal History</h1>
      <SignalHistory signals={signals} />
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-4 py-2 bg-dark-700 rounded-lg disabled:opacity-30 hover:bg-dark-600"
        >
          Previous
        </button>
        <span className="text-gray-400 text-sm">
          {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={(page + 1) * limit >= total}
          className="px-4 py-2 bg-dark-700 rounded-lg disabled:opacity-30 hover:bg-dark-600"
        >
          Next
        </button>
      </div>
    </div>
  );
}
