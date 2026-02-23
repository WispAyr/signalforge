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
import { ChatPanel } from './components/ChatPanel';
import { PluginsPage } from './components/PluginsPage';
import { EdgeNodesPage } from './components/EdgeNodesPage';
import { FrequencyScanner } from './components/FrequencyScanner';
import { TimelineView } from './components/TimelineView';
import { TelemetryDashboard } from './components/TelemetryDashboard';
import { ThemeProvider } from './components/ThemeProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
// Phase 6
import { SatNOGSView } from './components/SatNOGSView';
import { GeofenceView } from './components/GeofenceView';
import { VoiceDecoderView } from './components/VoiceDecoderView';
import { PropagationView } from './components/PropagationView';
import { LogbookView } from './components/LogbookView';
import { AnalyticsView } from './components/AnalyticsView';
import { DXClusterView } from './components/DXClusterView';
import { AudioStreamView } from './components/AudioStreamView';
// Phase 7
import { RTL433View } from './components/RTL433View';
import { PagerView } from './components/PagerView';
import { SubGHzView } from './components/SubGHzView';
import { SSTVView } from './components/SSTVView';
import { MeterView } from './components/MeterView';
import { WiFiView } from './components/WiFiView';
import { BluetoothView } from './components/BluetoothView';
import { TSCMView } from './components/TSCMView';
import { MeshtasticView } from './components/MeshtasticView';
import { NumberStationsView } from './components/NumberStationsView';
import { FieldModeView } from './components/FieldModeView';
import { VDL2View } from './components/VDL2View';
// Phase 8
import { GlobeView } from './components/GlobeView';
import { WebGPUDSPView } from './components/WebGPUDSPView';
import { NarratorView } from './components/NarratorView';
import { CommunityView } from './components/CommunityView';
import { AcademyView } from './components/AcademyView';
import { HistoryView } from './components/HistoryView';
import { IntegrationsView } from './components/IntegrationsView';
import { EquipmentView } from './components/EquipmentView';
import { CinematicView } from './components/CinematicView';

export type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'sdr' | 'analyzer' | 'scheduler' | 'signals' | 'settings' | 'scanner' | 'timeline' | 'telemetry' | 'plugins' | 'edge' | 'satnogs' | 'geofence' | 'voice' | 'propagation' | 'logbook' | 'analytics' | 'dxcluster' | 'audio' | 'rtl433' | 'pager' | 'subghz' | 'sstv' | 'meters' | 'wifi' | 'bluetooth' | 'tscm' | 'meshtastic' | 'numberstations' | 'fieldmode' | 'vdl2' | 'globe' | 'dsp' | 'narrator' | 'community' | 'academy' | 'history' | 'integrations' | 'equipment' | 'cinematic';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [transitioning, setTransitioning] = useState(false);
  const [showChat, setShowChat] = useState(false);

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
      if (e.ctrlKey || e.metaKey) return;
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
        case 'c': if (e.altKey) setShowChat(prev => !prev); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeView]);

  return (
    <ThemeProvider>
      <div className="h-screen w-screen flex flex-col bg-forge-bg grid-overlay overflow-hidden">
        <Header activeView={activeView} onViewChange={changeView} onToggleChat={() => setShowChat(prev => !prev)} showChat={showChat} />

        <div className="flex-1 flex overflow-hidden">
          {(activeView === 'flow') && <Sidebar />}

          <main className={`flex-1 overflow-hidden relative transition-opacity duration-150 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
            <ErrorBoundary>
              {activeView === 'dashboard' && <Dashboard onNavigate={changeView} />}
              {activeView === 'flow' && <FlowEditor />}
              {activeView === 'waterfall' && <WaterfallView />}
              {activeView === 'map' && <MapView />}
              {activeView === 'sdr' && <SDRPanel />}
              {activeView === 'analyzer' && <SpectrumAnalyzer />}
              {activeView === 'scheduler' && <ObservationScheduler />}
              {activeView === 'signals' && <SignalGuide />}
              {activeView === 'scanner' && <FrequencyScanner />}
              {activeView === 'timeline' && <TimelineView />}
              {activeView === 'telemetry' && <TelemetryDashboard />}
              {activeView === 'plugins' && <PluginsPage />}
              {activeView === 'edge' && <EdgeNodesPage />}
              {activeView === 'satnogs' && <SatNOGSView />}
              {activeView === 'geofence' && <GeofenceView />}
              {activeView === 'voice' && <VoiceDecoderView />}
              {activeView === 'propagation' && <PropagationView />}
              {activeView === 'logbook' && <LogbookView />}
              {activeView === 'analytics' && <AnalyticsView />}
              {activeView === 'dxcluster' && <DXClusterView />}
              {activeView === 'audio' && <AudioStreamView />}
              {activeView === 'rtl433' && <RTL433View />}
              {activeView === 'pager' && <PagerView />}
              {activeView === 'subghz' && <SubGHzView />}
              {activeView === 'sstv' && <SSTVView />}
              {activeView === 'meters' && <MeterView />}
              {activeView === 'wifi' && <WiFiView />}
              {activeView === 'bluetooth' && <BluetoothView />}
              {activeView === 'tscm' && <TSCMView />}
              {activeView === 'meshtastic' && <MeshtasticView />}
              {activeView === 'numberstations' && <NumberStationsView />}
              {activeView === 'fieldmode' && <FieldModeView />}
              {activeView === 'vdl2' && <VDL2View />}
              {activeView === 'globe' && <GlobeView />}
              {activeView === 'dsp' && <WebGPUDSPView />}
              {activeView === 'narrator' && <NarratorView />}
              {activeView === 'community' && <CommunityView />}
              {activeView === 'academy' && <AcademyView />}
              {activeView === 'history' && <HistoryView />}
              {activeView === 'integrations' && <IntegrationsView />}
              {activeView === 'equipment' && <EquipmentView />}
              {activeView === 'cinematic' && <CinematicView />}
              {activeView === 'settings' && <SettingsPage />}
            </ErrorBoundary>
          </main>

          {/* Chat panel (floating) */}
          {showChat && (
            <div className="w-80 border-l border-forge-border bg-forge-surface">
              <ChatPanel onClose={() => setShowChat(false)} />
            </div>
          )}
        </div>

        <StatusBar />
      </div>
    </ThemeProvider>
  );
};
