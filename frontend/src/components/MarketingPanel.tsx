import BrandLockup from './BrandLockup';

const workspaceStats = [
  { label: 'Channels', value: '18' },
  { label: 'Members', value: '142' },
  { label: 'Uptime', value: '99%' }
];

const activityItems = [
  { name: 'Design', message: 'Shared the new onboarding notes', time: '2m' },
  { name: 'Product', message: 'Pinned sprint planning in #roadmap', time: '8m' },
  { name: 'Support', message: 'Resolved 12 customer handoffs', time: '14m' }
];

function MarketingPanel() {
  return (
    <section className="relative hidden min-h-[760px] overflow-hidden rounded-[28px] bg-[#4a154b] p-8 text-white shadow-2xl shadow-[#4a154b]/25 lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,197,240,0.28),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(236,178,46,0.24),transparent_24%),radial-gradient(circle_at_70%_84%,rgba(46,182,125,0.22),transparent_30%)]" />
      <div className="floating-dot left-[12%] top-[22%] bg-[#36c5f0]" />
      <div className="floating-dot delay-300 right-[17%] top-[32%] bg-[#ecb22e]" />
      <div className="floating-dot delay-700 bottom-[19%] left-[18%] bg-[#2eb67d]" />

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <BrandLockup inverted />

          <div className="mt-20 max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#ecb22e]">PulseChat</p>
            <h1 className="mt-4 text-5xl font-black leading-[1.02] tracking-tight">
              Work conversations that feel organized from the first message.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-white/76">
              Create channels, follow team updates, and keep every decision searchable in a calm, focused workspace.
            </p>
          </div>
        </div>

        <div className="relative">
          <div className="workspace-preview animate-rise rounded-3xl border border-white/16 bg-white/12 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/12 pb-4">
              <div>
                <p className="text-sm font-semibold text-white/60"># product-launch</p>
                <p className="mt-1 text-lg font-bold">Monday standup</p>
              </div>
              <div className="flex -space-x-2">
                {['A', 'M', 'K'].map((avatar) => (
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#4a154b] bg-white text-sm font-bold text-[#4a154b]" key={avatar}>
                    {avatar}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {activityItems.map((item) => (
                <div className="group flex items-start gap-3 rounded-2xl p-3 transition duration-300 hover:bg-white/10" key={item.name}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/16 font-bold text-white">
                    {item.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-xs text-white/45">{item.time}</p>
                    </div>
                    <p className="mt-1 text-sm text-white/68">{item.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {workspaceStats.map((stat) => (
              <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur" key={stat.label}>
                <p className="text-2xl font-black">{stat.value}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-white/50">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default MarketingPanel;
