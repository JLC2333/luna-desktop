import React, { useEffect, useState } from 'react';
import { ChatStats, StatSnapshot, STAT_NAMES } from '../types';
import { setStat, getStatHistory, ensureChatStats } from '../utils/db';

interface StatsPanelProps {
  chatId: number;
  onClose: () => void;
}

const STAT_EMOJI: Record<string, string> = {
  stat_happy: '😊',
  stat_discomfort: '😖',
  stat_trust: '🤝',
  stat_energy: '⚡',
  stat_affection: '💕',
  stat_curiosity: '🤔',
  stat_relax: '😌',
  stat_depression: '😞',
};

const STAT_HEX: Record<string, string> = {
  stat_happy: '#22c55e',
  stat_discomfort: '#ef4444',
  stat_trust: '#3b82f6',
  stat_energy: '#eab308',
  stat_affection: '#ec4899',
  stat_curiosity: '#a855f7',
  stat_relax: '#14b8a6',
  stat_depression: '#78716c',
};

const StatsPanel: React.FC<StatsPanelProps> = ({ chatId, onClose }) => {
  const [stats, setStatsLocal] = useState<ChatStats | null>(null);
  const [history, setHistory] = useState<StatSnapshot[]>([]);
  

  useEffect(() => {
    loadStats();
  }, [chatId]);

  async function loadStats() {
    const data = await ensureChatStats(chatId);
    if (data) {
      setStatsLocal(data);
      const hist = await getStatHistory(chatId);
      setHistory(hist);
    }
  }

  async function handleSlider(key: string, newVal: number) {
    if (!stats) return;
    const clamped = Math.max(0, Math.min(100, Math.round(newVal)));
    await setStat(chatId, key, clamped);
    setStatsLocal(prev => prev ? { ...prev, [key]: clamped, updated_at: new Date().toISOString() } : null);
  }

  const dragRef = React.useRef<{ key: string; onChange: (v: number) => void } | null>(null);
  
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const el = document.querySelector(`[data-dragbar="${d.key}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      d.onChange(Math.max(0, Math.min(100, pct)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!stats) {
    // 初次进入时 stats 可能还没初始化
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="bg-luna-bg border border-luna-border rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-luna-text-secondary text-center">暂无属性数据</p>
        </div>
      </div>
    );
  }

  const statKeys = ['stat_happy', 'stat_discomfort', 'stat_trust', 'stat_energy', 'stat_affection', 'stat_curiosity', 'stat_relax', 'stat_depression'];
  
  // 极简折线图 (SVG)
  const chartPoints = history.length > 1
    ? history.map((s, i) => ({
        x: (i / (history.length - 1)) * 100,
        happy: s.stat_happy,
        discomfort: s.stat_discomfort,
        trust: s.stat_trust,
        energy: s.stat_energy,
        affection: s.stat_affection,
        curiosity: s.stat_curiosity,
        relax: s.stat_relax,
        depression: s.stat_depression,
      }))
    : [];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-luna-bg border border-luna-border rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-luna-text">属性值</h2>
          <button onClick={onClose} className="text-luna-text-tertiary hover:text-luna-text text-lg leading-none">&times;</button>
        </div>

        <div className="space-y-3 mb-5">
          {statKeys.map((key) => {
            const val = Math.round((stats as any)[key] || 0);
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-luna-text">{STAT_EMOJI[key]} {STAT_NAMES[key]}</span>
                  <span className="text-luna-text-secondary">{val}</span>
                </div>
                <div
                  data-dragbar={key}
                  className="relative h-5 rounded-full overflow-hidden cursor-pointer"
                  onMouseDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                    handleSlider(key, Math.max(0, Math.min(100, pct)));
                    dragRef.current = { key, onChange: (v) => handleSlider(key, v) };
                  }}>
                  <div className="absolute inset-0"
                       style={{ background: 'var(--color-luna-border, #3a3a4a)' }} />
                  <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                       style={{ width: `${val}%`, backgroundColor: STAT_HEX[key] }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* 历史曲线 */}
        {chartPoints.length > 1 && (
          <div>
            <div className="text-xs font-semibold text-luna-text mb-2">变化趋势</div>
            <svg viewBox="0 0 100 50" className="w-full h-16">
              {['happy', 'discomfort', 'trust', 'energy', 'affection', 'curiosity', 'relax', 'depression'].map((type, idx) => {
                const color = ['#22c55e', '#ef4444', '#3b82f6', '#eab308', '#ec4899', '#a855f7', '#14b8a6', '#78716c'][idx];
                const points = chartPoints.map(p =>
                  `${p.x.toFixed(1)},${(50 - (p as any)[type] * 0.45).toFixed(1)}`
                ).join(' ');
                return <polyline key={type} points={points} fill="none" stroke={color} strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />;
              })}
            </svg>
            <div className="flex gap-3 justify-center text-[10px] text-luna-text-secondary mt-1">
              {[['happy', '😊'], ['discomfort', '😖'], ['trust', '🤝'], ['energy', '⚡'], ['affection', '💕'], ['curiosity', '🤔'], ['relax', '😌'], ['depression', '😞']].map(([k, e]) => (
                <span key={k}>{e}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsPanel;
