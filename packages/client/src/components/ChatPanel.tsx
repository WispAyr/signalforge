import React, { useState, useEffect, useRef } from 'react';
import type { ChatMessage, UserSession } from '@signalforge/shared';

interface ChatPanelProps {
  onClose?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<UserSession[]>([]);
  const [input, setInput] = useState('');
  const [nickname, setNickname] = useState('');
  const [session, setSession] = useState<UserSession | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);
    setWs(socket);

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'chat_message') {
          setMessages(prev => [...prev, msg.message].slice(-200));
        }
        if (msg.type === 'users_update') {
          setUsers(msg.users);
        }
        if (msg.type === 'session') {
          setSession(msg.session);
        }
      } catch { /* ignore */ }
    };

    // Load chat history
    fetch('/api/chat?limit=50').then(r => r.json()).then(setMessages).catch(() => {});

    return () => socket.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const join = () => {
    if (!nickname.trim() || !ws) return;
    ws.send(JSON.stringify({ type: 'user_join', nickname: nickname.trim() }));
  };

  const sendMessage = () => {
    if (!input.trim() || !ws || !session) return;
    ws.send(JSON.stringify({ type: 'chat_send', text: input.trim() }));
    setInput('');
  };

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-4">
        <div className="text-xs font-mono text-forge-cyan tracking-wider">JOIN SIGNALFORGE COMMS</div>
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && join()}
          placeholder="Enter callsign / nickname..."
          className="w-64 px-3 py-2 bg-forge-bg border border-forge-border rounded text-sm font-mono text-forge-text focus:border-forge-cyan focus:outline-none"
        />
        <button onClick={join} className="px-4 py-1.5 bg-forge-cyan/20 border border-forge-cyan/40 rounded text-xs font-mono text-forge-cyan hover:bg-forge-cyan/30 transition-colors">
          JOIN
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-forge-cyan tracking-wider">📡 COMMS</span>
          <span className="text-[10px] font-mono text-forge-text-dim">{users.length} online</span>
        </div>
        {onClose && <button onClick={onClose} className="text-forge-text-dim hover:text-forge-text text-xs">✕</button>}
      </div>

      {/* Who's listening */}
      <div className="px-3 py-1.5 border-b border-forge-border/50 flex gap-1.5 flex-wrap">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-forge-bg text-[9px] font-mono" title={u.tuning ? `${(u.tuning.frequency / 1e6).toFixed(3)} MHz ${u.tuning.mode}` : 'Idle'}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: u.color }} />
            <span style={{ color: u.color }}>{u.nickname}</span>
            {u.tuning && <span className="text-forge-text-dim">{(u.tuning.frequency / 1e6).toFixed(1)}</span>}
          </div>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {messages.map(m => (
          <div key={m.id} className={`text-xs font-mono ${m.type === 'system' ? 'text-forge-text-dim italic' : ''}`}>
            {m.type !== 'system' && (
              <span style={{ color: m.color }} className="mr-1.5">{m.nickname}:</span>
            )}
            <span className="text-forge-text">{m.text}</span>
            <span className="text-forge-text-dim text-[9px] ml-1.5">
              {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-forge-border flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type message..."
          className="flex-1 px-2 py-1 bg-forge-bg border border-forge-border rounded text-xs font-mono text-forge-text focus:border-forge-cyan focus:outline-none"
        />
        <button onClick={sendMessage} className="px-3 py-1 bg-forge-cyan/20 border border-forge-cyan/30 rounded text-xs font-mono text-forge-cyan hover:bg-forge-cyan/30">
          SEND
        </button>
      </div>
    </div>
  );
};
