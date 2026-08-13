import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { useProjection } from './store/hooks';
import Dashboard from './screens/Dashboard';
import GoalsScreen from './screens/GoalsScreen';
import MoneyScreen from './screens/MoneyScreen';
import TrackScreen from './screens/TrackScreen';
import PlanScreen from './screens/PlanScreen';
import ForecastScreen from './screens/ForecastScreen';
import SettingsScreen from './screens/SettingsScreen';
import Onboarding from './screens/Onboarding';

export type Tab = 'home' | 'goals' | 'money' | 'forecast' | 'track' | 'plan';
export type Route = Tab | 'settings';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'home', label: 'Home', glyph: '🏠' },
  { id: 'goals', label: 'Goals', glyph: '🎯' },
  { id: 'money', label: 'Money', glyph: '💳' },
  { id: 'forecast', label: 'Forecast', glyph: '📈' },
  { id: 'track', label: 'Track', glyph: '🔥' },
  { id: 'plan', label: 'What if', glyph: '🎛️' },
];

/** Applies the chosen theme, or steps aside and lets the system decide. */
function useTheme(): void {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.settings.onboarded);
  const [route, setRoute] = useState<Route>('home');

  useTheme();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <div className="loading">
        <div className="spinner" />
        <div className="small">Opening your plan…</div>
      </div>
    );
  }

  if (!onboarded) return <Onboarding />;

  return <Shell route={route} setRoute={setRoute} />;
}

function Shell({ route, setRoute }: { route: Route; setRoute: (route: Route) => void }) {
  // One projection for the whole app: it is the single source of truth every
  // screen reads from, so no two screens can ever show different answers.
  const projection = useProjection();

  useEffect(() => {
    // A tab change should always start at the top of the new screen.
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <main className="app__main">
        {route === 'home' && (
          <Dashboard projection={projection} onNavigate={setRoute} />
        )}
        {route === 'goals' && <GoalsScreen projection={projection} />}
        {route === 'money' && <MoneyScreen projection={projection} />}
        {route === 'forecast' && <ForecastScreen projection={projection} />}
        {route === 'track' && <TrackScreen projection={projection} />}
        {route === 'plan' && <PlanScreen projection={projection} />}
        {route === 'settings' && <SettingsScreen onBack={() => setRoute('home')} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tabbar__item"
            aria-current={route === tab.id ? 'page' : undefined}
            onClick={() => setRoute(tab.id)}
          >
            <span className="tabbar__glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
