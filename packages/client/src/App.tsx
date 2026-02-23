import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { TopBar } from './components/layout/TopBar';
import { AppSidebar } from './components/layout/AppSidebar';
import { CommandPalette } from './components/layout/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { ThemeProvider } from './components/ThemeProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toast } from './components/ui/Toast';
import { Skeleton } from './components/ui/Skeleton';
import { useUIStore } from './stores/ui';
import { VIEW_MAP } from './components/layout/navigation';

// Lazy-load all views for code splitting
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const FlowEditor = lazy(() => import('./components/FlowEditor').then(m => ({ default: m.FlowEditor })));
const WaterfallView = lazy(() => import('./components/WaterfallView').then(m => ({ default: m.WaterfallView })));
const MapView = lazy(() => import('./components/MapView').then(m => ({ default: m.MapView })));
const SDRPanel = lazy(() => import('./components/SDRPanel').then(m => ({ default: m.SDRPanel })));
const SpectrumAnalyzer = lazy(() => import('./components/SpectrumAnalyzer').then(m => ({ default: m.SpectrumAnalyzer })));
const ObservationScheduler = lazy(() => import('./components/ObservationScheduler').then(m => ({ default: m.ObservationScheduler })));
const SignalGuide = lazy(() => import('./components/SignalGuide').then(m => ({ default: m.SignalGuide })));
const FrequencyScanner = lazy(() => import('./components/FrequencyScanner').then(m => ({ default: m.FrequencyScanner })));
const TimelineView = lazy(() => import('./components/TimelineView').then(m => ({ default: m.TimelineView })));
const TelemetryDashboard = lazy(() => import('./components/TelemetryDashboard').then(m => ({ default: m.TelemetryDashboard })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const PluginsPage = lazy(() => import('./components/PluginsPage').then(m => ({ default: m.PluginsPage })));
const EdgeNodesPage = lazy(() => import('./components/EdgeNodesPage').then(m => ({ default: m.EdgeNodesPage })));
const ChatPanel = lazy(() => import('./components/ChatPanel').then(m => ({ default: m.ChatPanel })));
// Phase 6
const SatNOGSView = lazy(() => import('./components/SatNOGSView').then(m => ({ default: m.SatNOGSView })));
const GeofenceView = lazy(() => import('./components/GeofenceView').then(m => ({ default: m.GeofenceView })));
const VoiceDecoderView = lazy(() => import('./components/VoiceDecoderView').then(m => ({ default: m.VoiceDecoderView })));
const PropagationView = lazy(() => import('./components/PropagationView').then(m => ({ default: m.PropagationView })));
const LogbookView = lazy(() => import('./components/LogbookView').then(m => ({ default: m.LogbookView })));
const AnalyticsView = lazy(() => import('./components/AnalyticsView').then(m => ({ default: m.AnalyticsView })));
const DXClusterView = lazy(() => import('./components/DXClusterView').then(m => ({ default: m.DXClusterView })));
const AudioStreamView = lazy(() => import('./components/AudioStreamView').then(m => ({ default: m.AudioStreamView })));
// Phase 7
const RTL433View = lazy(() => import('./components/RTL433View').then(m => ({ default: m.RTL433View })));
const PagerView = lazy(() => import('./components/PagerView').then(m => ({ default: m.PagerView })));
const SubGHzView = lazy(() => import('./components/SubGHzView').then(m => ({ default: m.SubGHzView })));
const SSTVView = lazy(() => import('./components/SSTVView').then(m => ({ default: m.SSTVView })));
const MeterView = lazy(() => import('./components/MeterView').then(m => ({ default: m.MeterView })));
const WiFiView = lazy(() => import('./components/WiFiView').then(m => ({ default: m.WiFiView })));
const BluetoothView = lazy(() => import('./components/BluetoothView').then(m => ({ default: m.BluetoothView })));
const TSCMView = lazy(() => import('./components/TSCMView').then(m => ({ default: m.TSCMView })));
const MeshtasticView = lazy(() => import('./components/MeshtasticView').then(m => ({ default: m.MeshtasticView })));
const NumberStationsView = lazy(() => import('./components/NumberStationsView').then(m => ({ default: m.NumberStationsView })));
const FieldModeView = lazy(() => import('./components/FieldModeView').then(m => ({ default: m.FieldModeView })));
const VDL2View = lazy(() => import('./components/VDL2View').then(m => ({ default: m.VDL2View })));
// Phase 8
const GlobeView = lazy(() => import('./components/GlobeView').then(m => ({ default: m.GlobeView })));
const WebGPUDSPView = lazy(() => import('./components/WebGPUDSPView').then(m => ({ default: m.WebGPUDSPView })));
const NarratorView = lazy(() => import('./components/NarratorView').then(m => ({ default: m.NarratorView })));
const CommunityView = lazy(() => import('./components/CommunityView').then(m => ({ default: m.CommunityView })));
const AcademyView = lazy(() => import('./components/AcademyView').then(m => ({ default: m.AcademyView })));
const HistoryView = lazy(() => import('./components/HistoryView').then(m => ({ default: m.HistoryView })));
const IntegrationsView = lazy(() => import('./components/IntegrationsView').then(m => ({ default: m.IntegrationsView })));
const EquipmentView = lazy(() => import('./components/EquipmentView').then(m => ({ default: m.EquipmentView })));
const CinematicView = lazy(() => import('./components/CinematicView').then(m => ({ default: m.CinematicView })));

// Node palette sidebar (only for flow editor)
const FlowSidebar = lazy(() => import('./components/Sidebar').then(m => ({ default: m.Sidebar })));

export type View = 'dashboard' | 'flow' | 'waterfall' | 'map' | 'sdr' | 'analyzer' | 'scheduler' | 'signals' | 'settings' | 'scanner' | 'timeline' | 'telemetry' | 'plugins' | 'edge' | 'satnogs' | 'geofence' | 'voice' | 'propagation' | 'logbook' | 'analytics' | 'dxcluster' | 'audio' | 'rtl433' | 'pager' | 'subghz' | 'sstv' | 'meters' | 'wifi' | 'bluetooth' | 'tscm' | 'meshtastic' | 'numberstations' | 'fieldmode' | 'vdl2' | 'globe' | 'dsp' | 'narrator' | 'community' | 'academy' | 'history' | 'integrations' | 'equipment' | 'cinematic';

// Loading skeleton for lazy views
const ViewLoader: React.FC = () => (
  <div className="h-full p-6 space-y-4 animate-pulse">
    <Skeleton variant="rect" height="32px" width="200px" />
    <div className="grid grid-cols-3 gap-4">
      <Skeleton variant="card" height="120px" />
      <Skeleton variant="card" height="120px" />
      <Skeleton variant="card" height="120px" />
    </div>
    <Skeleton variant="card" height="300px" />
  </div>
);

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [showChat, setShowChat] = useState(false);
  const { sidebarPinned, sidebarHovered, markViewVisited } = useUIStore();

  const sidebarExpanded = sidebarPinned || sidebarHovered;

  const changeView = useCallback((view: View) => {
    if (view === activeView) return;
    setActiveView(view);
    markViewVisited(view);
    // Update section
    const entry = VIEW_MAP[view];
    if (entry) useUIStore.getState().setActiveSection(entry.section.label);
  }, [activeView, markViewVisited]);

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

  // Density keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        const { density, setDensity } = useUIStore.getState();
        const cycle: ('compact' | 'comfortable' | 'spacious')[] = ['compact', 'comfortable', 'spacious'];
        setDensity(cycle[(cycle.indexOf(density) + 1) % 3]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const renderView = () => {
    switch (activeView) {
      case 'dashboard': return <Dashboard onNavigate={changeView} />;
      case 'flow': return <FlowEditor />;
      case 'waterfall': return <WaterfallView />;
      case 'map': return <MapView />;
      case 'sdr': return <SDRPanel />;
      case 'analyzer': return <SpectrumAnalyzer />;
      case 'scheduler': return <ObservationScheduler />;
      case 'signals': return <SignalGuide />;
      case 'scanner': return <FrequencyScanner />;
      case 'timeline': return <TimelineView />;
      case 'telemetry': return <TelemetryDashboard />;
      case 'plugins': return <PluginsPage />;
      case 'edge': return <EdgeNodesPage />;
      case 'satnogs': return <SatNOGSView />;
      case 'geofence': return <GeofenceView />;
      case 'voice': return <VoiceDecoderView />;
      case 'propagation': return <PropagationView />;
      case 'logbook': return <LogbookView />;
      case 'analytics': return <AnalyticsView />;
      case 'dxcluster': return <DXClusterView />;
      case 'audio': return <AudioStreamView />;
      case 'rtl433': return <RTL433View />;
      case 'pager': return <PagerView />;
      case 'subghz': return <SubGHzView />;
      case 'sstv': return <SSTVView />;
      case 'meters': return <MeterView />;
      case 'wifi': return <WiFiView />;
      case 'bluetooth': return <BluetoothView />;
      case 'tscm': return <TSCMView />;
      case 'meshtastic': return <MeshtasticView />;
      case 'numberstations': return <NumberStationsView />;
      case 'fieldmode': return <FieldModeView />;
      case 'vdl2': return <VDL2View />;
      case 'globe': return <GlobeView />;
      case 'dsp': return <WebGPUDSPView />;
      case 'narrator': return <NarratorView />;
      case 'community': return <CommunityView />;
      case 'academy': return <AcademyView />;
      case 'history': return <HistoryView />;
      case 'integrations': return <IntegrationsView />;
      case 'equipment': return <EquipmentView />;
      case 'cinematic': return <CinematicView />;
      case 'settings': return <SettingsPage />;
      default: return <Dashboard onNavigate={changeView} />;
    }
  };

  return (
    <ThemeProvider>
      <Toast>
        <div className="h-screen w-screen flex flex-col bg-forge-bg grid-overlay overflow-hidden">
          <TopBar activeView={activeView} onToggleChat={() => setShowChat(prev => !prev)} showChat={showChat} />

          <div className="flex-1 flex overflow-hidden relative">
            {/* Navigation sidebar */}
            <AppSidebar activeView={activeView} onViewChange={changeView} />

            {/* Main content area — offset by sidebar width */}
            <main
              className={`flex-1 overflow-hidden relative transition-all duration-300 ${
                sidebarExpanded ? 'ml-56' : 'ml-12'
              }`}
              role="main"
            >
              {/* Flow editor node palette */}
              {activeView === 'flow' && (
                <Suspense fallback={null}>
                  <FlowSidebar />
                </Suspense>
              )}

              <ErrorBoundary>
                <Suspense fallback={<ViewLoader />}>
                  <div className="h-full animate-[fadeIn_200ms_ease-out]">
                    {renderView()}
                  </div>
                </Suspense>
              </ErrorBoundary>
            </main>

            {/* Chat panel */}
            {showChat && (
              <div className="w-80 border-l border-forge-border bg-forge-surface flex-shrink-0">
                <Suspense fallback={<ViewLoader />}>
                  <ChatPanel onClose={() => setShowChat(false)} />
                </Suspense>
              </div>
            )}
          </div>

          <StatusBar />

          {/* Command palette overlay */}
          <CommandPalette onViewChange={changeView} />
        </div>
      </Toast>
    </ThemeProvider>
  );
};
