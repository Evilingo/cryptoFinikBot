import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Logo, Icon } from '../primitives';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/signals', label: 'Signals', icon: 'signal' },
  { to: '/trades', label: 'Trades', icon: 'grid' },
  { to: '/portfolio', label: 'Portfolio', icon: 'grid' },
  { to: '/stats', label: 'Performance', icon: 'stats' },
];

export default function Sidebar() {
  const { authenticated, logout, user } = useAuth();
  const navigate = useNavigate();

  const username = user?.username || user?.name || 'Admin';
  const avatarLetter = username[0]?.toUpperCase() || 'A';

  return (
    <aside className="sidebar">
      <Logo />

      <nav className="nav">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon name={link.icon} size={18} />
            <span>{link.label}</span>
          </NavLink>
        ))}

        {authenticated && (
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon name="settings" size={18} />
            <span>Settings</span>
          </NavLink>
        )}
      </nav>

      <div style={{margin: '4px 8px', padding: '12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)'}}>
        <div style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6}}>AI Engine</div>
        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
          <span className="pulse-dot" style={{width: 8, height: 8}}/>
          <span style={{fontSize: 13, fontWeight: 500}}>Claude Sonnet</span>
        </div>
        <div style={{fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)'}}>avg 12.4s · 94% uptime</div>
      </div>

      <div className="sidebar-footer">
        <div className="account-card">
          <div className="avatar">{avatarLetter}</div>
          <div style={{minWidth: 0, flex: 1}}>
            <div className="account-name">{username}</div>
            <div className="account-role">{authenticated ? 'Admin · API connected' : 'Guest'}</div>
          </div>
        </div>

        {authenticated ? (
          <button
            className="nav-item"
            onClick={logout}
            style={{color: 'var(--text-3)', marginTop: 4}}
          >
            <Icon name="logout" size={16}/> Logout
          </button>
        ) : (
          <button
            className="nav-item"
            onClick={() => navigate('/login')}
            style={{color: 'var(--text-3)', marginTop: 4}}
          >
            <Icon name="key" size={16}/> Login
          </button>
        )}
      </div>
    </aside>
  );
}
