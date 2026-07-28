import React from 'react';
import { Home, Calendar, Music, Building2 } from 'lucide-react';

export type MainModuleType = 'dashboard' | 'repertoire' | 'cifrador' | 'schedules' | 'ministry';

interface BottomNavProps {
  currentModule: MainModuleType;
  onSelectModule: (module: MainModuleType) => void;
  upcomingSchedulesCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentModule,
  onSelectModule,
  upcomingSchedulesCount = 0,
}) => {
  const items: Array<{
    id: MainModuleType;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'dashboard',
      label: 'Início',
      icon: <Home size={20} />,
    },
    {
      id: 'schedules',
      label: 'Escalas',
      icon: <Calendar size={20} />,
      badge: upcomingSchedulesCount > 0 ? upcomingSchedulesCount : undefined,
    },
    {
      id: 'repertoire',
      label: 'Repertório',
      icon: <Music size={20} />,
    },
    {
      id: 'ministry',
      label: 'Ministério',
      icon: <Building2 size={20} />,
    },
  ];

  return (
    <nav className="bottom-nav no-print">
      <div className="bottom-nav-container">
        {items.map((item) => {
          const isActive = currentModule === item.id;
          return (
            <button
              key={item.id}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectModule(item.id)}
            >
              <div className="bottom-nav-icon-wrapper">
                {item.icon}
                {item.badge !== undefined && (
                  <span className="bottom-nav-badge">{item.badge}</span>
                )}
              </div>
              <span className="bottom-nav-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
