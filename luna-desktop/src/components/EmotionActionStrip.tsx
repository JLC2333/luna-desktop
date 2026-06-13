import React from 'react';

interface EmotionActionStripProps {
  emotion?: string | null;
  speech?: string | null;
  action?: string | null;
}

const EMOTION_EMOJI: Record<string, string> = {
  happy: '😊',
  love: '🥰',
  excited: '🤩',
  sad: '😢',
  angry: '😠',
  scared: '😱',
  confused: '😕',
  shy: '😊',
  tired: '😫',
  surprised: '😲',
  idle: '😐',
};

function getEmotionEmoji(emotion: string): string {
  return EMOTION_EMOJI[emotion?.toLowerCase()] || '';
}

const EmotionActionStrip: React.FC<EmotionActionStripProps> = ({ emotion, speech, action }) => {
  const tags: { text: string; className: string }[] = [];

  if (action) {
    tags.push({ text: '🚶 ' + action, className: 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800' });
  }

  if (speech) {
    tags.push({ text: '💬 ' + speech, className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' });
  }

  if (emotion && emotion !== 'idle' && emotion !== '') {
    tags.push({ text: getEmotionEmoji(emotion) + ' ' + emotion, className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800' });
  }

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {tags.map((tag, i) => (
        <span
          key={i}
          className={'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] leading-tight border ' + tag.className}
        >
          {tag.text}
        </span>
      ))}
    </div>
  );
};

export default EmotionActionStrip;
