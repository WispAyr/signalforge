import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { FlowEditor } from './components/FlowEditor';
import { WaterfallView } from './components/WaterfallView';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Dashboard } from './components/Dashboard';
import { SettingsPage } from './components/SettingsPage';
import { SignalGuide } from './components/SignalGuide';
import { SDRPanel } from './components/SDRPanel';
import { SpectrumAnalyzer } from './components/SpectrumAnalyzer';
import { ObservationScheduler } from './components/ObservationScheduler';

export type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'sdr' | 'analyzer' | 'scheduler' | 'signals' | 'settings';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [transitioning, setTransitioning] = useState(false);

  const changeView = useCallback((view: View) => {
    if (view === activeView) return;
    setTransitioning(true);
    setTimeout(() => {
      setActiveView(view);
      setTransitioning(false);
    }, 150);
  }, [activeView]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key) {
        case '1': changeView('dashboard'); break;
        case '2': changeView('flow'); break;
        case '3': changeView('waterfall'); break;
        case '4': changeView('map'); break;
        case '5': changeView('sdr'); break;
        case '6': changeView('analyzer'); break;
        case '7': changeView('scheduler'); break;
        case '8': changeView('signals'); break;
        case '9': changeView('settings'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeView]);

  return (
    <div className="h-screen w-screen flex flex-col bg-forge-bg grid-overlay overflow-hidden">
      <Header activeView={activeView} onViewChange={changeView} />

      <div className="flex-1 flex overflow-hidden">
        {(activeView === 'flow') && <Sidebar />}

        <main className={`flex-1 overflow-hidden relative transition-opacity duration-150 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
          {activeView === 'dashboard' && <Dashboard onNavigate={changeView} />}
          {activeView === 'flow' && <FlowEditor />}
          {activeView === 'waterfall' && <WaterfallView />}
          {activeView === 'map' && <MapView />}
          {activeView === 'sdr' && <SDRPanel />}
          {activeView === 'analyzer' && <SpectrumAnalyzer />}
          {activeView === 'scheduler' && <ObservationScheduler />}
          {activeView === 'signals' && <SignalGuide />}
          {activeView === 'settings' && <SettingsPage />}
        </main>
      </div>

      <StatusBar />
    </div>
  );
};
