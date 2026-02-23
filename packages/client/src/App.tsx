import React, { useState } from 'react';
import { Header } from './components/Header';
import { FlowEditor } from './components/FlowEditor';
import { WaterfallView } from './components/WaterfallView';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Dashboard } from './components/Dashboard';

type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'split';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('dashboard');

  return (
    <div className="h-screen w-screen flex flex-col bg-forge-bg grid-overlay overflow-hidden">
      <Header activeView={activeView} onViewChange={setActiveView} />

      <div className="flex-1 flex overflow-hidden">
        {activeView !== 'dashboard' && <Sidebar />}

        <main className="flex-1 overflow-hidden relative">
          {activeView === 'dashboard' && <Dashboard onNavigate={setActiveView} />}
          {activeView === 'flow' && <FlowEditor />}
          {activeView === 'waterfall' && <WaterfallView />}
          {activeView === 'map' && <MapView />}
          {activeView === 'split' && (
            <div className="h-full grid grid-rows-2 gap-px bg-forge-border">
              <WaterfallView />
              <FlowEditor />
            </div>
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
};
