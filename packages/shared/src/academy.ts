// Phase 8: Training / Academy types

export type TutorialDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type TutorialStatus = 'locked' | 'available' | 'in-progress' | 'completed';

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  difficulty: TutorialDifficulty;
  category: string;
  estimatedMinutes: number;
  steps: TutorialStep[];
  prerequisites: string[];
  flowgraphTemplate?: any;
  iconEmoji: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  content: string; // markdown
  highlightElement?: string; // CSS selector
  action?: string; // required action to proceed
  hint?: string;
}

export interface QuizQuestion {
  id: string;
  spectrogramUrl?: string;
  audioUrl?: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: TutorialDifficulty;
}

export interface AcademyProgress {
  completedTutorials: string[];
  currentTutorial?: string;
  currentStep?: number;
  quizScores: Record<string, number>;
  totalPoints: number;
  rank: string;
}
