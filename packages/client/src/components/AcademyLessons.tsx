import React, { useState, useEffect, useCallback } from 'react';

interface AcademyModule {
  id: number;
  title: string;
  description: string;
  icon: string;
  lessonCount: number;
}

interface QuizItem {
  question: string;
  options: string[];
  correct: number;
}

interface Lesson {
  id: string;
  module: string;
  moduleId: number;
  lessonNumber: number;
  title: string;
  content: string;
  quiz: QuizItem[];
  interactive?: string;
}

const PROGRESS_KEY = 'signalforge-academy-progress';

function getProgress(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function setLessonComplete(lessonId: string) {
  const p = getProgress();
  p[lessonId] = true;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

export const AcademyLessons: React.FC = () => {
  const [modules, setModules] = useState<AcademyModule[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number | null>>({});
  const [quizRevealed, setQuizRevealed] = useState<Record<number, boolean>>({});
  const [progress, setProgress] = useState<Record<string, boolean>>(getProgress());

  useEffect(() => {
    fetch('/api/academy/modules').then(r => r.json()).then(setModules).catch(() => {});
    fetch('/api/academy/lessons').then(r => r.json()).then(setLessons).catch(() => {});
  }, []);

  const moduleLessons = useCallback((moduleId: number) =>
    lessons.filter(l => l.moduleId === moduleId).sort((a, b) => a.lessonNumber - b.lessonNumber),
  [lessons]);

  const completedCount = Object.values(progress).filter(Boolean).length;
  const totalLessons = lessons.length;

  const handleQuizAnswer = (qi: number, ai: number) => {
    setQuizAnswers(prev => ({ ...prev, [qi]: ai }));
    setQuizRevealed(prev => ({ ...prev, [qi]: true }));
  };

  const markComplete = () => {
    if (!activeLesson) return;
    setLessonComplete(activeLesson.id);
    setProgress(getProgress());
    // Also tell server
    fetch('/api/academy/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId: activeLesson.id, completed: true }),
    }).catch(() => {});
  };

  if (activeLesson) {
    return (
      <div className="h-full flex flex-col bg-forge-bg">
        <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
          <button onClick={() => { setActiveLesson(null); setQuizAnswers({}); setQuizRevealed({}); }}
            className="text-xs font-mono text-gray-500 hover:text-cyan-400">← Back</button>
          <span className="text-cyan-400 font-mono text-sm font-bold">{activeLesson.module} › {activeLesson.title}</span>
          {activeLesson.interactive && (
            <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30">🎛️ Interactive</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            {/* Render markdown content */}
            <div className="prose prose-invert prose-sm max-w-none
              [&_h1]:text-cyan-400 [&_h1]:font-mono [&_h1]:text-lg [&_h1]:mb-4
              [&_h2]:text-cyan-300 [&_h2]:font-mono [&_h2]:text-sm [&_h2]:mt-6 [&_h2]:mb-2
              [&_h3]:text-amber-400 [&_h3]:font-mono [&_h3]:text-sm [&_h3]:mt-4
              [&_p]:text-gray-300 [&_p]:text-sm [&_p]:leading-relaxed
              [&_code]:text-green-400 [&_code]:bg-forge-surface [&_code]:px-1 [&_code]:rounded
              [&_pre]:bg-forge-surface [&_pre]:border [&_pre]:border-forge-border [&_pre]:rounded [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-green-400 [&_pre]:overflow-x-auto
              [&_table]:text-xs [&_table]:font-mono [&_th]:text-cyan-400 [&_th]:text-left [&_th]:p-2 [&_th]:border-b [&_th]:border-forge-border
              [&_td]:text-gray-300 [&_td]:p-2 [&_td]:border-b [&_td]:border-forge-border/50
              [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-500 [&_blockquote]:pl-4 [&_blockquote]:text-cyan-300 [&_blockquote]:italic
              [&_strong]:text-white [&_li]:text-gray-300 [&_li]:text-sm
            ">
              {/* Simple markdown-to-JSX: split by lines and render */}
              {activeLesson.content.split('\n').map((line, i) => {
                if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
                if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
                if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
                if (line.startsWith('> ')) return <blockquote key={i}><p>{line.slice(2)}</p></blockquote>;
                if (line.startsWith('```')) return null; // skip fences, handled in pre blocks
                if (line.startsWith('| ')) {
                  // Simple table rendering — just show as preformatted
                  return <pre key={i} style={{ margin: 0, padding: '2px 8px', border: 'none', background: 'transparent' }}>{line}</pre>;
                }
                if (line.startsWith('- ')) return <li key={i}>{renderInline(line.slice(2))}</li>;
                if (/^\d+\.\s/.test(line)) return <li key={i}>{renderInline(line.replace(/^\d+\.\s/, ''))}</li>;
                if (line.trim() === '') return <br key={i} />;
                return <p key={i}>{renderInline(line)}</p>;
              })}
            </div>

            {/* Quiz section */}
            {activeLesson.quiz.length > 0 && (
              <div className="mt-8 border-t border-forge-border pt-6">
                <h2 className="text-sm font-mono text-amber-400 font-bold mb-4">📝 Knowledge Check</h2>
                {activeLesson.quiz.map((q, qi) => (
                  <div key={qi} className={`mb-4 bg-forge-surface border rounded p-4 ${
                    quizRevealed[qi] ? (quizAnswers[qi] === q.correct ? 'border-green-500/30' : 'border-red-500/30') : 'border-forge-border'
                  }`}>
                    <p className="text-sm text-white font-mono mb-3">{q.question}</p>
                    <div className="space-y-1">
                      {q.options.map((opt, oi) => (
                        <button key={oi} onClick={() => !quizRevealed[qi] && handleQuizAnswer(qi, oi)}
                          disabled={!!quizRevealed[qi]}
                          className={`w-full text-left px-3 py-2 rounded text-xs font-mono border transition-colors ${
                            quizRevealed[qi] && oi === q.correct ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                            quizRevealed[qi] && quizAnswers[qi] === oi ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                            quizRevealed[qi] ? 'text-gray-600 border-forge-border' :
                            'text-gray-300 border-forge-border hover:border-cyan-500/30 hover:text-cyan-400 cursor-pointer'
                          }`}>
                          {String.fromCharCode(65 + oi)}. {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Complete button */}
            <div className="mt-6 flex justify-end">
              {progress[activeLesson.id] ? (
                <span className="px-4 py-2 rounded text-xs font-mono bg-green-500/20 text-green-400 border border-green-500/30">✓ Completed</span>
              ) : (
                <button onClick={markComplete}
                  className="px-4 py-2 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                  ✓ Mark Complete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">📚 Training Academy — Curriculum</span>
        <span className="text-xs font-mono text-gray-500 ml-2">{completedCount}/{totalLessons} lessons completed</span>
        {totalLessons > 0 && (
          <div className="ml-3 w-32 h-1.5 bg-forge-border rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 rounded-full transition-all" style={{ width: `${(completedCount / totalLessons) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-6">
          {modules.map(mod => (
            <div key={mod.id}>
              <h2 className="text-sm font-mono text-cyan-400 font-bold mb-2 flex items-center gap-2">
                <span className="text-lg">{mod.icon}</span>
                Module {mod.id}: {mod.title}
              </h2>
              <p className="text-xs text-gray-500 font-mono mb-3">{mod.description}</p>
              <div className="space-y-2">
                {moduleLessons(mod.id).map(lesson => {
                  const done = progress[lesson.id];
                  return (
                    <div key={lesson.id}
                      onClick={() => setActiveLesson(lesson)}
                      className={`bg-forge-surface border rounded p-3 cursor-pointer hover:border-cyan-500/30 transition-colors flex items-center gap-3 ${
                        done ? 'border-green-500/20' : 'border-forge-border'
                      }`}>
                      <span className={`text-xs font-mono w-6 h-6 rounded-full flex items-center justify-center ${
                        done ? 'bg-green-500/20 text-green-400' : 'bg-forge-border text-gray-500'
                      }`}>
                        {done ? '✓' : lesson.lessonNumber}
                      </span>
                      <div className="flex-1">
                        <h3 className="text-sm font-mono text-white">{lesson.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-gray-500 font-mono">{lesson.quiz.length} quiz questions</span>
                          {lesson.interactive && (
                            <span className="text-[10px] text-purple-400 font-mono">🎛️ Interactive</span>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-600 text-xs">→</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Simple inline markdown renderer
function renderInline(text: string): React.ReactNode {
  // Handle **bold**, `code`, and *italic*
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Code
    const codeMatch = remaining.match(/`(.+?)`/);

    let firstMatch: { index: number; length: number; node: React.ReactNode } | null = null;

    if (boldMatch && boldMatch.index !== undefined) {
      const candidate = { index: boldMatch.index, length: boldMatch[0].length, node: <strong key={key++}>{boldMatch[1]}</strong> };
      if (!firstMatch || candidate.index < firstMatch.index) firstMatch = candidate;
    }
    if (codeMatch && codeMatch.index !== undefined) {
      const candidate = { index: codeMatch.index, length: codeMatch[0].length, node: <code key={key++}>{codeMatch[1]}</code> };
      if (!firstMatch || candidate.index < firstMatch.index) firstMatch = candidate;
    }

    if (firstMatch) {
      if (firstMatch.index > 0) parts.push(remaining.slice(0, firstMatch.index));
      parts.push(firstMatch.node);
      remaining = remaining.slice(firstMatch.index + firstMatch.length);
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
