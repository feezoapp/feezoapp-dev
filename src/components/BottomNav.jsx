import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/home', label: 'Home', icon: <path d="M3 9.5 12 2l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /> },
  { to: '/students', label: 'Students', icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
  { to: '/attendance', label: 'Attendance', icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></> },
  { to: '/fees', label: 'Fees', icon: <><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></> },
  { to: '/enquiry', label: 'Enquiry', icon: <path d="M21 11.5a8.38 8.38 0 0 1-4.9 7.6 8.5 8.5 0 0 1-9.3-1.8L3 21l1.9-3.8a8.38 8.38 0 0 1-.9-3.7 8.5 8.5 0 0 1 8.5-8.5h.4a8.48 8.48 0 0 1 8 8v.5z" /> },
  { to: '/profile', label: 'Profile', icon: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
];

export default function BottomNav() {
  return (
    <div className="bottom-nav">
      {NAV_ITEMS.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          title={item.label}
          aria-label={item.label}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {item.icon}
          </svg>
        </NavLink>
      ))}
    </div>
  );
}
