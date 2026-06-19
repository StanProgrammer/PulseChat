import { memo } from 'react';

type AvatarProps = {
  initials: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'light';
  status?: 'online' | 'away' | 'offline' | 'focus';
};

function Avatar({ initials, size = 'md', tone = 'default', status }: AvatarProps) {
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  const toneClass = tone === 'light' ? 'bg-white text-[#18242d]' : 'avatar-gradient text-white';

  return (
    <span className={`avatar relative grid shrink-0 place-items-center rounded-xl font-black shadow-sm ${sizeClass} ${toneClass}`}>
      {initials}
      {status && <span className={`avatar-status presence-${status}`} />}
    </span>
  );
}

export default memo(Avatar);
