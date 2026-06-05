import { memo, type ReactNode } from 'react';
import type { DirectConversation, Teammate } from '../../api/messaging';
import type { User } from '../../types/auth';
import BrandLockup from '../BrandLockup';
import Avatar from './Avatar';
import { formatMessagePreview, getInitials } from './messageUtils';

type WorkspaceSidebarProps = {
  activeConversationId?: string;
  conversations: DirectConversation[];
  isLoading: boolean;
  isSearching: boolean;
  isStartingConversation: string;
  onLogout: () => Promise<void>;
  onQueryChange: (query: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onStartConversation: (teammate: Teammate) => void;
  query: string;
  searchResults: Teammate[];
  user: User;
};

function WorkspaceSidebar({
  activeConversationId,
  conversations,
  isLoading,
  isSearching,
  isStartingConversation,
  onLogout,
  onQueryChange,
  onSelectConversation,
  onStartConversation,
  query,
  searchResults,
  user
}: WorkspaceSidebarProps) {
  const hasQuery = Boolean(query.trim());

  return (
    <aside className="workspace-sidebar border-r border-white/10 bg-[#18242d] text-white lg:sticky lg:top-0 lg:h-screen">
      <div className="flex h-full flex-col">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <BrandLockup inverted />
            <button className="workspace-icon-button border-white/10 bg-white/8 text-white hover:bg-white/14" title="Start direct message" type="button">
              +
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/8 p-3 shadow-lg shadow-black/10">
            <p className="truncate text-sm font-black">{user.workspaceName}</p>
            <p className="mt-1 text-xs font-semibold text-white/52">Direct messages only</p>
          </div>
        </div>

        <div className="scrollbar-soft flex-1 overflow-y-auto px-3 py-4">
          <label className="dm-search-field">
            <span>Find teammate</span>
            <input
              autoComplete="off"
              name="dm-search"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by name"
              type="search"
              value={query}
            />
          </label>

          <SidebarSection title={hasQuery ? 'Search results' : 'Recent DMs'}>
            {hasQuery ? (
              <SearchResults
                isLoading={isSearching}
                isStartingConversation={isStartingConversation}
                onStartConversation={onStartConversation}
                results={searchResults}
              />
            ) : (
              <ConversationList activeConversationId={activeConversationId} conversations={conversations} onSelect={onSelectConversation} />
            )}
          </SidebarSection>
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="account-strip">
            <Avatar initials={getInitials(user.name)} tone="light" status="online" />
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
  );
}

function SearchResults({
  results,
  isLoading,
  isStartingConversation,
  onStartConversation
}: {
  results: Teammate[];
  isLoading: boolean;
  isStartingConversation: string;
  onStartConversation: (teammate: Teammate) => void;
}) {
  if (isLoading) {
    return <p className="sidebar-empty">Searching...</p>;
  }

  if (!results.length) {
    return <p className="sidebar-empty">No matching teammate in this workspace.</p>;
  }

  return (
    <>
      {results.map((person) => (
        <button className="dm-row" disabled={Boolean(isStartingConversation)} key={person.id} onClick={() => onStartConversation(person)} type="button">
          <Avatar initials={getInitials(person.name)} size="sm" status="online" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{person.name}</span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{person.email}</span>
          </span>
          <span className="dm-start-chip">{isStartingConversation === person.id ? '...' : 'DM'}</span>
        </button>
      ))}
    </>
  );
}

function ConversationList({
  conversations,
  activeConversationId,
  onSelect
}: {
  conversations: DirectConversation[];
  activeConversationId?: string;
  onSelect: (conversationId: string) => void;
}) {
  if (!conversations.length) {
    return <p className="sidebar-empty">Search for a teammate to start your first DM.</p>;
  }

  return (
    <>
      {conversations.map((conversation) => {
        const participant = conversation.participant;

        if (!participant) {
          return null;
        }

        return (
          <button className={`dm-row ${activeConversationId === conversation.id ? 'dm-row-active' : ''}`} key={conversation.id} onClick={() => onSelect(conversation.id)} type="button">
            <Avatar initials={getInitials(participant.name)} size="sm" status="online" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-black">{participant.name}</span>
              <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{conversation.lastMessage ? formatMessagePreview(conversation.lastMessage.content) : 'No messages yet'}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-black uppercase tracking-[0.14em] text-white/42">{title}</h2>
      </div>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

export default memo(WorkspaceSidebar);
