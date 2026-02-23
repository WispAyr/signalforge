// Phase 8: Community Hub types

export type FlowgraphCategory = 'satellite' | 'aviation' | 'amateur' | 'iot' | 'sigint' | 'weather' | 'marine' | 'utility' | 'other';

export interface CommunityFlowgraph {
  id: string;
  name: string;
  description: string;
  author: string;
  authorCallsign?: string;
  category: FlowgraphCategory;
  tags: string[];
  flowData: any;
  rating: number;
  ratingCount: number;
  downloads: number;
  comments: CommunityComment[];
  createdAt: number;
  updatedAt: number;
}

export interface CommunityComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface CommunityPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: FlowgraphCategory;
  downloads: number;
  rating: number;
  url?: string;
  installed: boolean;
}

export interface UserProfile {
  id: string;
  callsign?: string;
  name: string;
  location?: string;
  gridSquare?: string;
  equipment: string[];
  bio?: string;
  sharedFlowgraphs: number;
  joinedAt: number;
}
