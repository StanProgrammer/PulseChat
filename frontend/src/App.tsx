import { FormEvent, useMemo, useState } from 'react';

type AuthMode = 'login' | 'register';

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

function App() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [isLoading, setIsLoading] = useState(false);
  const isRegister = mode === 'register';

  const content = useMemo(
    () => ({
      eyebrow: isRegister ? 'Start your workspace' : 'Welcome back',
      title: isRegister ? 'Create your team account' : 'Sign in to your workspace',
      subtitle: isRegister
        ? 'Bring your conversations, channels, and teammates into one focused place.'
        : 'Pick up every channel, mention, and decision right where you left it.',
      button: isRegister ? 'Create account' : 'Sign in',
      switchLabel: isRegister ? 'Already have an account?' : 'New to PulseChat?',
      switchAction: isRegister ? 'Sign in' : 'Create one'
    }),
    [isRegister]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    window.setTimeout(() => setIsLoading(false), 900);
  };

  return (
    <main className="auth-shell min-h-screen overflow-hidden bg-[#f6f3ef] text-[#1d1c1d]">
      <div className="auth-grid relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <section className="relative hidden min-h-[760px] overflow-hidden rounded-[28px] bg-[#4a154b] p-8 text-white shadow-2xl shadow-[#4a154b]/25 lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(54,197,240,0.28),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(236,178,46,0.24),transparent_24%),radial-gradient(circle_at_70%_84%,rgba(46,182,125,0.22),transparent_30%)]" />
          <div className="floating-dot left-[12%] top-[22%] bg-[#36c5f0]" />
          <div className="floating-dot delay-300 right-[17%] top-[32%] bg-[#ecb22e]" />
          <div className="floating-dot delay-700 bottom-[19%] left-[18%] bg-[#2eb67d]" />

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-xl font-black text-[#4a154b] shadow-lg">
                  P
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">PulseChat</p>
                  <p className="text-sm text-white/75">Team communication hub</p>
                </div>
              </div>

              <div className="mt-20 max-w-xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#ecb22e]">Mini Slack-like chat</p>
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
                      <span
                        className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#4a154b] bg-white text-sm font-bold text-[#4a154b]"
                        key={avatar}
                      >
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

        <section className="mx-auto w-full max-w-[500px] py-6 sm:py-10 lg:max-w-[540px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#4a154b] text-lg font-black text-white shadow-lg shadow-[#4a154b]/20">
                P
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#4a154b]">PulseChat</p>
                <p className="text-sm text-[#69646b]">Team communication hub</p>
              </div>
            </div>
          </div>

          <div className="auth-card rounded-[28px] border border-white/80 bg-white/82 p-5 shadow-2xl shadow-[#4a154b]/10 backdrop-blur-xl sm:p-8">
            <div className="mb-8 rounded-2xl bg-[#f1ecef] p-1">
              <div className="grid grid-cols-2 gap-1">
                {(['login', 'register'] as AuthMode[]).map((item) => (
                  <button
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition duration-300 ${
                      mode === item ? 'bg-white text-[#4a154b] shadow-sm' : 'text-[#69646b] hover:bg-white/55 hover:text-[#1d1c1d]'
                    }`}
                    key={item}
                    onClick={() => setMode(item)}
                    type="button"
                  >
                    {item === 'login' ? 'Login' : 'Register'}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-swap" key={mode}>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#611f69]">{content.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-[#1d1c1d] sm:text-4xl">{content.title}</h2>
              <p className="mt-3 text-base leading-7 text-[#69646b]">{content.subtitle}</p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <button className="social-button" type="button">
                  <span className="social-mark bg-white text-[#4285f4]">G</span>
                  Google
                </button>
                <button className="social-button" type="button">
                  <span className="social-mark bg-[#24292f] text-white">GH</span>
                  GitHub
                </button>
              </div>

              <div className="my-7 flex items-center gap-4 text-xs font-bold uppercase tracking-[0.18em] text-[#9a949c]">
                <span className="h-px flex-1 bg-[#ddd5dd]" />
                or continue with email
                <span className="h-px flex-1 bg-[#ddd5dd]" />
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                {isRegister && (
                  <label className="field-group">
                    <span>Full name</span>
                    <input autoComplete="name" placeholder="Alex Morgan" type="text" />
                  </label>
                )}

                <label className="field-group">
                  <span>Email address</span>
                  <input autoComplete="email" placeholder="you@company.com" type="email" />
                </label>

                {isRegister && (
                  <label className="field-group">
                    <span>Workspace name</span>
                    <input autoComplete="organization" placeholder="Acme Studio" type="text" />
                  </label>
                )}

                <label className="field-group">
                  <span>Password</span>
                  <input autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="Enter your password" type="password" />
                </label>

                <div className="flex flex-col gap-3 text-sm text-[#69646b] sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input className="h-4 w-4 rounded border-[#cfc7cf] accent-[#611f69]" type="checkbox" />
                    <span>{isRegister ? 'Send product tips' : 'Remember me'}</span>
                  </label>
                  {!isRegister && (
                    <button className="font-bold text-[#611f69] transition hover:text-[#4a154b]" type="button">
                      Forgot password?
                    </button>
                  )}
                </div>

                <button className="primary-button" disabled={isLoading} type="submit">
                  {isLoading ? (
                    <>
                      <span className="loader" />
                      Preparing workspace
                    </>
                  ) : (
                    content.button
                  )}
                </button>
              </form>

              <p className="mt-7 text-center text-sm text-[#69646b]">
                {content.switchLabel}{' '}
                <button className="font-black text-[#611f69] transition hover:text-[#4a154b]" onClick={() => setMode(isRegister ? 'login' : 'register')} type="button">
                  {content.switchAction}
                </button>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
