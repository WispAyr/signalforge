// Resilience & Production Types

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: number;
  components: ComponentHealth[];
  system: {
    cpuUsage: number;
    memoryUsed: number;
    memoryTotal: number;
    nodeVersion: string;
    platform: string;
  };
}

export interface ComponentHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latency?: number;
  lastCheck: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipPaths: string[];
}

export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: number;
  checksum: string;
}

export interface GracefulShutdownState {
  shutdownRequested: boolean;
  activeConnections: number;
  pendingOperations: number;
  savedState: boolean;
}
