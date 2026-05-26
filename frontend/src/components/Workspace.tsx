import type { ReactNode } from 'react';
import { User } from '../types/auth';
import BrandLockup from './BrandLockup';

type WorkspaceProps = {
  user: User;
  isLoading: boolean;
  onLogout: () => Promise<void>;
};

type Channel = {
  name: string;
  label: string;
  description: string;
  members: number;
  unread?: number;
  mention?: boolean;
  active?: boolean;
  muted?: boolean;
  updated: string;
};

type DirectMessage = {
  name: string;
  title: string;
  status: 'online' | 'away' | 'offline' | 'focus';
  initials: string;
  lastSeen: string;
  unread?: number;
};

type Message = {
  author: string;
  role: string;
  avatar: string;
  time: string;
  body: string;
  tone?: 'normal' | 'highlight' | 'own';
  reactions: Array<{ label: string; count: number; active?: boolean }>;
  replies?: number;
  attachment?: {
    title: string;
    meta: string;
    status: string;
  };
};

const channels: Channel[] = [
  {
    name: 'product-briefing',
    label: 'Product briefing',
    description: 'Launch scope, blockers, and product decisions',
    members: 28,
    unread: 4,
    mention: true,
    active: true,
    updated: 'now'
  },
  {
    name: 'design-review',
    label: 'Design review',
    description: 'Flows, polish passes, and UX critique',
    members: 16,
    unread: 2,
    updated: '7m'
  },
  {
    name: 'engineering',
    label: 'Engineering',
    description: 'Build updates, incidents, and architecture notes',
    members: 42,
    unread: 9,
    updated: '12m'
  },
  {
    name: 'customer-signal',
    label: 'Customer signal',
    description: 'Feedback from support, sales, and research',
    members: 21,
    updated: '24m'
  },
  {
    name: 'go-to-market',
    label: 'Go to market',
    description: 'Launch calendar and enablement',
    members: 19,
    updated: '1h'
  },
  {
    name: 'coffee-chat',
    label: 'Coffee chat',
    description: 'Lightweight team updates',
    members: 54,
    muted: true,
    updated: '3h'
  }
];

const directMessages: DirectMessage[] = [
  { name: 'Maya Chen', title: 'Product lead', status: 'online', initials: 'MC', lastSeen: 'typing' },
  { name: 'Jordan Lee', title: 'Design systems', status: 'focus', initials: 'JL', unread: 2, lastSeen: 'focus mode' },
  { name: 'Sam Rivera', title: 'Frontend engineer', status: 'online', initials: 'SR', lastSeen: 'active' },
  { name: 'Priya Shah', title: 'Customer research', status: 'away', initials: 'PS', lastSeen: '18m ago' },
  { name: 'Nolan Brooks', title: 'Platform', status: 'offline', initials: 'NB', lastSeen: 'yesterday' }
];

const navItems = [
  { label: 'Inbox', count: 6 },
  { label: 'Threads', count: 3 },
  { label: 'Drafts' },
  { label: 'Files' }
];

const upcoming = [
  { time: '11:30', title: 'Launch readiness', people: '8 people' },
  { time: '13:00', title: 'Design QA review', people: '5 people' },
  { time: '15:15', title: 'Customer insight sync', people: '4 people' }
];

const activity = [
  { user: 'Maya', action: 'pinned the beta launch checklist', time: '2m' },
  { user: 'Jordan', action: 'resolved the onboarding copy thread', time: '11m' },
  { user: 'Priya', action: 'shared 6 customer clips', time: '28m' },
  { user: 'Sam', action: 'moved mobile polish to ready', time: '44m' }
];

const files = [
  { name: 'Launch-readiness.md', meta: 'Updated 9m ago' },
  { name: 'Mobile-QA-notes.fig', meta: 'Commented by Jordan' },
  { name: 'Customer-quotes.csv', meta: 'Shared by Priya' }
];

function Workspace({ user, isLoading, onLogout }: WorkspaceProps) {
  const initials = getInitials(user.name);
  const activeChannel = channels.find((channel) => channel.active) ?? channels[0];
  const messages: Message[] = [
    {
      author: 'Maya Chen',
      role: 'Product lead',
      avatar: 'MC',
      time: '9:42 AM',
      body:
        'Morning. I consolidated the readiness review into one checklist. The only launch risk I see is the mobile empty-state copy, and Jordan already left a cleaner direction in the thread.',
      tone: 'highlight',
      reactions: [
        { label: 'Aligned', count: 7, active: true },
        { label: 'Reading', count: 3 }
      ],
      replies: 6,
      attachment: {
        title: 'Beta launch readiness',
        meta: '12 tasks, 3 owners, due Friday',
        status: 'On track'
      }
    },
    {
      author: 'Jordan Lee',
      role: 'Design systems',
      avatar: 'JL',
      time: '10:08 AM',
      body:
        'I tightened the composer states and channel list density. The workspace feels calmer when unread urgency is reserved for mentions and the rest stays visually quiet.',
      reactions: [
        { label: 'Nice', count: 5 },
        { label: 'Ship', count: 2 }
      ],
      replies: 3
    },
    {
      author: 'Sam Rivera',
      role: 'Frontend engineer',
      avatar: 'SR',
      time: '10:19 AM',
      body:
        'I can pick up the responsive pass after lunch. The right panel will collapse below the conversation on tablet, and the sidebar should stay compact without losing channel context.',
      reactions: [{ label: 'Thanks', count: 4 }],
      replies: 2
    },
    {
      author: user.name,
      role: 'You',
      avatar: initials,
      time: '10:31 AM',
      body:
        'Great. I will keep the first version focused on navigation, channel context, account controls, and a believable conversation surface. Backend hooks can slot in after the UI stabilizes.',
      tone: 'own',
      reactions: [{ label: 'Plan', count: 1, active: true }]
    }
  ];

  return (
    <main className="workspace-shell min-h-screen bg-[#eef1f4] text-[#17191c]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[304px_minmax(0,1fr)]">
        <aside className="workspace-sidebar border-r border-white/10 bg-[#18242d] text-white lg:sticky lg:top-0 lg:h-screen">
          <div className="flex h-full flex-col">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <BrandLockup inverted />
                <button className="workspace-icon-button border-white/10 bg-white/8 text-white hover:bg-white/14" title="Create new item" type="button">
                  +
                </button>
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/8 p-3 shadow-lg shadow-black/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">Northstar Team</p>
                    <p className="mt-1 text-xs font-semibold text-white/52">28 online members</p>
                  </div>
                  <span className="rounded-full bg-[#2eb67d]/18 px-2 py-1 text-xs font-black text-[#7ee0af]">live</span>
                </div>
              </div>
            </div>

            <div className="scrollbar-soft flex-1 overflow-y-auto px-3 py-4">
              <nav className="grid gap-1">
                {navItems.map((item, index) => (
                  <button className={`workspace-nav-item ${index === 0 ? 'workspace-nav-item-active' : ''}`} key={item.label} type="button">
                    <span className="workspace-nav-dot" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count && <span className="sidebar-soft-badge">{item.count}</span>}
                  </button>
                ))}
              </nav>

              <SidebarSection action="+" title="Priority channels">
                {channels.map((channel) => (
                  <button className={`channel-row ${channel.active ? 'channel-row-active' : ''}`} key={channel.name} type="button">
                    <span className="channel-symbol">#</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-black ${channel.muted ? 'text-white/48' : ''}`}>{channel.label}</span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{channel.updated} - {channel.members} members</span>
                    </span>
                    {channel.mention && <span className="mention-dot" />}
                    {channel.unread && <span className="sidebar-badge">{channel.unread}</span>}
                  </button>
                ))}
              </SidebarSection>

              <SidebarSection action="+" title="Direct messages">
                {directMessages.map((person) => (
                  <button className="dm-row" key={person.name} type="button">
                    <Avatar initials={person.initials} size="sm" status={person.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{person.name}</span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{person.lastSeen}</span>
                    </span>
                    {person.unread && <span className="sidebar-badge">{person.unread}</span>}
                  </button>
                ))}
              </SidebarSection>
            </div>

            <div className="border-t border-white/10 p-3">
              <div className="account-strip">
                <Avatar initials={initials} tone="light" status="online" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black">{user.name}</p>
                  <p className="truncate text-xs font-semibold text-white/52">{user.email}</p>
                </div>
                <button className="workspace-icon-button border-white/10 bg-white/8 text-white hover:bg-white/14" disabled={isLoading} onClick={onLogout} title="Sign out" type="button">
                  {isLoading ? '...' : 'out'}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="workspace-header sticky top-0 z-20 border-b border-[#d9dee4] bg-white/86 backdrop-blur-xl">
            <div className="flex min-h-[76px] flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#707984]">
                  <span className="h-2 w-2 rounded-full bg-[#2eb67d] shadow-[0_0_0_4px_rgba(46,182,125,0.13)]" />
                  Product workspace
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-black text-[#17191c]"># {activeChannel.label}</h1>
                  <span className="channel-meta-pill">{activeChannel.members} members</span>
                  <span className="channel-meta-pill">Updated {activeChannel.updated}</span>
                </div>
                <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[#606975]">{activeChannel.description}</p>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button className="header-action" title="Channel notes" type="button">Notes</button>
                <button className="header-action" title="Start huddle" type="button">Huddle</button>
                <div className="workspace-search">
                  <span className="font-black text-[#4a154b]">S</span>
                  <span className="truncate">Search messages, files, and people</span>
                  <kbd>Ctrl K</kbd>
                </div>
                <Avatar initials={initials} />
              </div>
            </div>
          </header>

          <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_356px]">
            <div className="min-w-0 px-4 py-5 sm:px-6">
              <div className="conversation-panel animate-workspace-in">
                <div className="conversation-hero">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#707984]">Today</p>
                    <h2 className="mt-1 text-xl font-black">Launch readiness and workspace polish</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#606975]">
                      A focused channel for product decisions, design quality, and frontend readiness before the beta rollout.
                    </p>
                  </div>
                  <div className="hero-score">
                    <span>84%</span>
                    <p>confidence</p>
                  </div>
                </div>

                <div className="conversation-stream">
                  <DateDivider label="Today, May 26" />
                  {messages.map((message, index) => (
                    <MessageItem message={message} key={`${message.author}-${message.time}`} index={index} />
                  ))}
                </div>

                <div className="composer-shell">
                  <div className="composer-input">
                    <span className="text-[#8a939d]">Share an update in #product-briefing</span>
                  </div>
                  <div className="composer-footer">
                    <div className="flex flex-wrap gap-1">
                      {['B', 'I', 'Link', 'Task', '@'].map((tool) => (
                        <button className="composer-tool" key={tool} type="button">{tool}</button>
                      ))}
                    </div>
                    <button className="send-button" type="button">Send update</button>
                  </div>
                </div>
              </div>
            </div>

            <aside className="right-panel border-t border-[#d9dee4] bg-[#f8fafb] px-4 py-5 sm:px-6 xl:border-l xl:border-t-0">
              <div className="space-y-5">
                <PanelBlock eyebrow="Channel pulse" title="Work is moving">
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="Open tasks" value="12" tone="green" />
                    <Metric label="Mentions" value="4" tone="pink" />
                    <Metric label="Files" value="18" tone="blue" />
                  </div>
                </PanelBlock>

                <PanelBlock eyebrow="Upcoming" title="Today's syncs">
                  <div className="space-y-2">
                    {upcoming.map((item) => (
                      <button className="right-list-row" key={`${item.time}-${item.title}`} type="button">
                        <span className="time-chip">{item.time}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-black">{item.title}</span>
                          <span className="mt-0.5 block text-xs font-semibold text-[#707984]">{item.people}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </PanelBlock>

                <PanelBlock eyebrow="Activity" title="Recent movement">
                  <div className="space-y-3">
                    {activity.map((item) => (
                      <div className="activity-row" key={`${item.user}-${item.time}`}>
                        <span className="activity-dot" />
                        <p><strong>{item.user}</strong> {item.action}</p>
                        <span>{item.time}</span>
                      </div>
                    ))}
                  </div>
                </PanelBlock>

                <PanelBlock eyebrow="Shared files" title="Pinned resources">
                  <div className="space-y-2">
                    {files.map((file) => (
                      <button className="file-row" key={file.name} type="button">
                        <span className="file-icon">F</span>
                        <span className="min-w-0">
                          <span className="block truncate font-black">{file.name}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-[#707984]">{file.meta}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </PanelBlock>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

type SidebarSectionProps = {
  title: string;
  action: string;
  children: ReactNode;
};

function SidebarSection({ title, action, children }: SidebarSectionProps) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-black uppercase tracking-[0.14em] text-white/42">{title}</h2>
        <button className="section-action" type="button">{action}</button>
      </div>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

function MessageItem({ message, index }: { message: Message; index: number }) {
  return (
    <article className={`message-card ${message.tone === 'highlight' ? 'message-card-highlight' : ''} ${message.tone === 'own' ? 'message-card-own' : ''}`} style={{ animationDelay: `${index * 55}ms` }}>
      <Avatar initials={message.avatar} status={message.tone === 'own' ? 'online' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-black">{message.author}</h3>
          <span className="rounded-full bg-[#eef1f4] px-2 py-0.5 text-xs font-black text-[#606975]">{message.role}</span>
          <span className="text-xs font-bold text-[#8a939d]">{message.time}</span>
        </div>
        <p className="mt-2 text-[0.95rem] leading-7 text-[#343940]">{message.body}</p>
        {message.attachment && (
          <div className="message-attachment">
            <div className="attachment-bar" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-black">{message.attachment.title}</p>
              <p className="mt-1 text-sm font-semibold text-[#707984]">{message.attachment.meta}</p>
            </div>
            <span>{message.attachment.status}</span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {message.reactions.map((reaction) => (
            <button className={`reaction-pill ${reaction.active ? 'reaction-pill-active' : ''}`} key={reaction.label} type="button">
              <span>{reaction.label}</span>
              {reaction.count}
            </button>
          ))}
          {message.replies && <button className="thread-link" type="button">{message.replies} replies</button>}
        </div>
      </div>
    </article>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="date-divider">
      <span />
      <p>{label}</p>
      <span />
    </div>
  );
}

type AvatarProps = {
  initials: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'light';
  status?: DirectMessage['status'];
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

type PanelBlockProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
};

function PanelBlock({ eyebrow, title, children }: PanelBlockProps) {
  return (
    <section className="panel-block">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#707984]">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-black">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

type MetricProps = {
  label: string;
  value: string;
  tone: 'green' | 'pink' | 'blue';
};

function Metric({ label, value, tone }: MetricProps) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <p>{value}</p>
      <span>{label}</span>
    </div>
  );
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return 'PC';
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export default Workspace;
