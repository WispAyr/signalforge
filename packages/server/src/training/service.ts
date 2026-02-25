// ============================================================================
// SignalForge Training Service — loads tutorials from JSON files
// ============================================================================
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../services/database.js';

export interface TrainingTutorial {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  estimatedMinutes: number;
  icon: string;
  content: string;
  steps: Array<{ title: string; content: string }>;
  quiz: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>;
}

// Create progress table
db.exec(`
  CREATE TABLE IF NOT EXISTS training_progress (
    user_id TEXT NOT NULL DEFAULT 'default',
    tutorial_id TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    quiz_score REAL DEFAULT 0,
    completed_at INTEGER,
    PRIMARY KEY (user_id, tutorial_id)
  )
`);

export class TrainingService {
  private tutorials: TrainingTutorial[] = [];
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(process.cwd(), 'data', 'training');
    this.loadTutorials();
  }

  private loadTutorials() {
    if (!existsSync(this.dataDir)) return;

    const files = readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(this.dataDir, file), 'utf-8'));
        this.tutorials.push(data);
      } catch (err: any) {
        console.error(`⚠️ Training: failed to load ${file} — ${err.message}`);
      }
    }

    console.log(`📚 Loaded ${this.tutorials.length} training tutorials`);
  }

  getTutorials(category?: string, difficulty?: string): Array<Omit<TrainingTutorial, 'content' | 'steps' | 'quiz'>> {
    let results = this.tutorials;
    if (category) results = results.filter(t => t.category === category);
    if (difficulty) results = results.filter(t => t.difficulty === difficulty);
    return results.map(({ content, steps, quiz, ...rest }) => ({
      ...rest,
      stepCount: steps.length,
      quizCount: quiz.length,
    }));
  }

  getTutorial(id: string): TrainingTutorial | null {
    return this.tutorials.find(t => t.id === id) || null;
  }

  saveProgress(userId: string, tutorialId: string, completed: boolean, quizScore?: number): void {
    db.prepare(`
      INSERT OR REPLACE INTO training_progress (user_id, tutorial_id, completed, quiz_score, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, tutorialId, completed ? 1 : 0, quizScore || 0, completed ? Date.now() : null);
  }

  getProgress(userId = 'default'): Array<{ tutorialId: string; completed: boolean; quizScore: number; completedAt: number | null }> {
    const rows = db.prepare('SELECT * FROM training_progress WHERE user_id = ?').all(userId) as any[];
    return rows.map(r => ({
      tutorialId: r.tutorial_id,
      completed: r.completed === 1,
      quizScore: r.quiz_score,
      completedAt: r.completed_at,
    }));
  }
}
