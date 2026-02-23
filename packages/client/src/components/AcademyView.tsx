import React, { useState, useEffect } from 'react';
import type { Tutorial, QuizQuestion, AcademyProgress } from '@signalforge/shared';

export const AcademyView: React.FC = () => {
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [progress, setProgress] = useState<AcademyProgress | null>(null);
  const [activeTutorial, setActiveTutorial] = useState<Tutorial | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [tab, setTab] = useState<'tutorials' | 'quiz' | 'playground'>('tutorials');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number | null>>({});
  const [quizResults, setQuizResults] = useState<Record<string, { correct: boolean; explanation: string }>>({});

  useEffect(() => {
    fetch('/api/academy/tutorials').then(r => r.json()).then(setTutorials).catch(() => {});
    fetch('/api/academy/quiz').then(r => r.json()).then(setQuizQuestions).catch(() => {});
    fetch('/api/academy/progress').then(r => r.json()).then(setProgress).catch(() => {});
  }, []);

  const submitAnswer = async (qId: string, idx: number) => {
    setQuizAnswers(prev => ({ ...prev, [qId]: idx }));
    const res = await fetch('/api/academy/quiz/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qId, answerIndex: idx }),
    });
    const result = await res.json();
    setQuizResults(prev => ({ ...prev, [qId]: result }));
    fetch('/api/academy/progress').then(r => r.json()).then(setProgress).catch(() => {});
  };

  const completeTutorial = async (id: string) => {
    await fetch(`/api/academy/tutorials/${id}/complete`, { method: 'POST' });
    setActiveTutorial(null);
    fetch('/api/academy/progress').then(r => r.json()).then(setProgress).catch(() => {});
  };

  const diffColors = { beginner: 'text-green-400 bg-green-500/20 border-green-500/30', intermediate: 'text-amber-400 bg-amber-500/20 border-amber-500/30', advanced: 'text-red-400 bg-red-500/20 border-red-500/30' };

  return (
    <div className="h-full flex flex-col bg-forge-bg">
      <div className="flex items-center gap-3 p-3 border-b border-forge-border bg-forge-surface/50">
        <span className="text-cyan-400 font-mono text-sm font-bold">🎓 SignalForge Academy</span>
        {progress && (
          <div className="flex items-center gap-2 ml-3">
            <span className="text-xs font-mono text-amber-400">🏆 {progress.rank}</span>
            <span className="text-xs font-mono text-gray-500">{progress.totalPoints} pts</span>
            <span className="text-xs font-mono text-gray-500">{progress.completedTutorials.length} tutorials done</span>
          </div>
        )}
        <div className="flex-1" />
        <div className="flex gap-1">
          {(['tutorials', 'quiz', 'playground'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setActiveTutorial(null); }}
              className={`px-3 py-1 rounded text-xs font-mono ${tab === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-500 border border-forge-border'}`}>
              {t === 'tutorials' ? '📖 Tutorials' : t === 'quiz' ? '❓ Quiz' : '🎮 Playground'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'tutorials' && !activeTutorial && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tutorials.map(tut => {
              const completed = progress?.completedTutorials.includes(tut.id);
              return (
                <div key={tut.id} className={`bg-forge-surface border rounded p-4 cursor-pointer hover:border-cyan-500/30 transition-colors ${completed ? 'border-green-500/30' : 'border-forge-border'}`}
                  onClick={() => { setActiveTutorial(tut); setActiveStep(0); }}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{tut.iconEmoji}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-mono text-white font-bold">{tut.title}</h3>
                        {completed && <span className="text-green-400 text-xs">✓ Done</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{tut.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${diffColors[tut.difficulty]}`}>{tut.difficulty}</span>
                        <span className="text-[10px] text-gray-500 font-mono">⏱ {tut.estimatedMinutes} min</span>
                        <span className="text-[10px] text-gray-500 font-mono">{tut.steps.length} steps</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'tutorials' && activeTutorial && (
          <div className="max-w-3xl mx-auto">
            <button onClick={() => setActiveTutorial(null)} className="text-xs font-mono text-gray-500 hover:text-cyan-400 mb-3">← Back to tutorials</button>
            <div className="bg-forge-surface border border-forge-border rounded p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">{activeTutorial.iconEmoji}</span>
                <h2 className="text-lg font-mono text-white font-bold">{activeTutorial.title}</h2>
              </div>
              {/* Step indicators */}
              <div className="flex gap-1 mb-4">
                {activeTutorial.steps.map((_, i) => (
                  <div key={i} className={`h-1 flex-1 rounded ${i <= activeStep ? 'bg-cyan-400' : 'bg-forge-border'}`} />
                ))}
              </div>
              {/* Step content */}
              <div className="mb-4">
                <h3 className="text-sm font-mono text-cyan-400 font-bold mb-2">
                  Step {activeStep + 1}: {activeTutorial.steps[activeStep].title}
                </h3>
                <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                  {activeTutorial.steps[activeStep].content.replace(/^#+\s/gm, '').replace(/\*\*/g, '')}
                </div>
              </div>
              {/* Navigation */}
              <div className="flex gap-2">
                {activeStep > 0 && (
                  <button onClick={() => setActiveStep(prev => prev - 1)}
                    className="px-3 py-1 rounded text-xs font-mono text-gray-400 border border-forge-border hover:text-white">← Previous</button>
                )}
                <div className="flex-1" />
                {activeStep < activeTutorial.steps.length - 1 ? (
                  <button onClick={() => setActiveStep(prev => prev + 1)}
                    className="px-3 py-1 rounded text-xs font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">Next →</button>
                ) : (
                  <button onClick={() => completeTutorial(activeTutorial.id)}
                    className="px-3 py-1 rounded text-xs font-mono bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30">✓ Complete Tutorial</button>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'quiz' && (
          <div className="max-w-3xl mx-auto space-y-3">
            {quizQuestions.map((q, qi) => {
              const answered = quizAnswers[q.id] !== undefined;
              const result = quizResults[q.id];
              return (
                <div key={q.id} className={`bg-forge-surface border rounded p-4 ${result ? (result.correct ? 'border-green-500/30' : 'border-red-500/30') : 'border-forge-border'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-gray-500">Q{qi + 1}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${diffColors[q.difficulty]}`}>{q.difficulty}</span>
                  </div>
                  <p className="text-sm text-white font-mono mb-3">{q.question}</p>
                  <div className="space-y-1">
                    {q.options.map((opt, oi) => (
                      <button key={oi} onClick={() => !answered && submitAnswer(q.id, oi)} disabled={answered}
                        className={`w-full text-left px-3 py-2 rounded text-xs font-mono border transition-colors ${
                          answered && oi === q.correctIndex ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          answered && quizAnswers[q.id] === oi && !result?.correct ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                          answered ? 'text-gray-500 border-forge-border' :
                          'text-gray-300 border-forge-border hover:border-cyan-500/30 hover:text-cyan-400'
                        }`}>
                        {String.fromCharCode(65 + oi)}. {opt}
                      </button>
                    ))}
                  </div>
                  {result && (
                    <div className={`mt-2 text-xs font-mono p-2 rounded ${result.correct ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {result.correct ? '✓ Correct! ' : '✗ Incorrect. '}{result.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'playground' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-4xl mb-3">🎮</div>
              <h3 className="text-lg font-mono text-white mb-2">Signal Playground</h3>
              <p className="text-sm text-gray-400 font-mono max-w-md">
                Practice signal identification with simulated signals — no hardware required.
                Connect a simulated SDR source and explore different modulation types, decoders, and analysis tools.
              </p>
              <button className="mt-4 px-4 py-2 rounded text-sm font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                🚀 Launch Playground
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
