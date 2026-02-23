import React, { useState } from 'react';
import { Header } from './components/Header';
import { FlowEditor } from './components/FlowEditor';
import { WaterfallView } from './components/WaterfallView';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';

type View = 'flow' | 'waterfall' | 'map' | 'split';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('flow');

  return (
    <div className="h-screen w-screen flex flex-col bg-forge-bg grid-overlay overflow-hidden">
      <Header activeView={activeView} onViewChange={setActiveView} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-hidden relative">
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
