import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const links = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/signals', label: 'Signals', icon: '📡' },
  { to: '/stats', label: 'Accuracy', icon: '🎯' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  const { logout } = useAuth();

  return (
    <aside className="w-56 bg-dark-800 border-r border-dark-600 flex flex-col p-4">
      <div className="text-xl font-bold mb-8 px-2">
        <span className="text-accent-blue">Best</span>Trader
      </div>

      <nav className="flex-1 space-y-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent-blue/10 text-accent-blue'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-dark-700'
              }`
            }
          >
            <span>{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <button
        onClick={logout}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-dark-700 transition-colors"
      >
        <span>🚪</span>
        Logout
      </button>
    </aside>
  );
}
