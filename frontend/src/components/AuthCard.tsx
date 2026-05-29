import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AuthMode, LoginPayload, RegisterPayload } from '../types/auth';
import BrandLockup from './BrandLockup';

type AuthCardProps = {
  mode: AuthMode;
  error: string;
  success: string;
  isLoading: boolean;
  isSessionLoading: boolean;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (payload: LoginPayload | RegisterPayload) => Promise<boolean>;
};

function AuthCard({ mode, error, success, isLoading, isSessionLoading, onModeChange, onSubmit }: AuthCardProps) {
  return (
    <section className="mx-auto w-full max-w-[500px] py-6 sm:py-10 lg:max-w-[540px]">
      <div className="mb-8 flex items-center justify-between lg:hidden">
        <BrandLockup />
      </div>

      <div className="auth-card rounded-[28px] border border-white/80 bg-white/82 p-5 shadow-2xl shadow-[#4a154b]/10 backdrop-blur-xl sm:p-8">
        {isSessionLoading ? (
          <SessionLoader />
        ) : (
          <AuthForm error={error} isLoading={isLoading} mode={mode} onModeChange={onModeChange} onSubmit={onSubmit} success={success} />
        )}
      </div>
    </section>
  );
}

type AuthFormProps = {
  mode: AuthMode;
  error: string;
  success: string;
  isLoading: boolean;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (payload: LoginPayload | RegisterPayload) => Promise<boolean>;
};

function AuthForm({ mode, error, success, isLoading, onModeChange, onSubmit }: AuthFormProps) {
  const isRegister = mode === 'register';
  const [clientError, setClientError] = useState('');
  const formError = clientError || error;

  useEffect(() => {
    setClientError('');
  }, [mode, error]);

  const content = useMemo(
    () => ({
      eyebrow: isRegister ? 'Start your workspace' : 'Welcome back',
      title: isRegister ? 'Create your team account' : 'Sign in to your workspace',
      subtitle: isRegister
        ? 'Verify your email first, then bring your conversations into one focused place.'
        : 'Pick up every channel, mention, and decision right where you left it.',
      button: isRegister ? 'Send verification email' : 'Sign in',
      switchLabel: isRegister ? 'Already have an account?' : 'New to PulseChat?',
      switchAction: isRegister ? 'Sign in' : 'Create one'
    }),
    [isRegister]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || '')
    };
    const confirmPassword = String(formData.get('confirmPassword') || '');

    setClientError('');

    if (isRegister && payload.password !== confirmPassword) {
      setClientError('Passwords do not match.');
      return;
    }

    const didAuthenticate = await onSubmit(
      isRegister
        ? {
            ...payload,
            confirmPassword,
            name: String(formData.get('name') || '').trim(),
            workspaceName: String(formData.get('workspaceName') || '').trim()
          }
        : payload
    );

    if (didAuthenticate) {
      form.reset();
    }
  };

  return (
    <>
      <div className="mb-8 rounded-2xl bg-[#f1ecef] p-1">
        <div className="grid grid-cols-2 gap-1">
          {(['login', 'register'] as AuthMode[]).map((item) => (
            <button
              className={`rounded-xl px-4 py-3 text-sm font-bold transition duration-300 ${
                mode === item ? 'bg-white text-[#4a154b] shadow-sm' : 'text-[#69646b] hover:bg-white/55 hover:text-[#1d1c1d]'
              }`}
              key={item}
              onClick={() => onModeChange(item)}
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

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          {isRegister && (
            <label className="field-group">
              <span>Full name</span>
              <input autoComplete="name" minLength={2} name="name" placeholder="Alex Morgan" required type="text" />
            </label>
          )}

          <label className="field-group">
            <span>Email address</span>
            <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
          </label>

          {isRegister && (
            <label className="field-group">
              <span>Workspace name</span>
              <input autoComplete="organization" minLength={2} name="workspaceName" placeholder="Acme Studio" required type="text" />
            </label>
          )}

          <label className="field-group">
            <span>Password</span>
            <input autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} name="password" placeholder="At least 8 characters" required type="password" />
          </label>

          {isRegister && (
            <label className="field-group">
              <span>Confirm password</span>
              <input autoComplete="new-password" minLength={8} name="confirmPassword" placeholder="Re-enter your password" required type="password" />
            </label>
          )}

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

          {formError && <p className="notice-error">{formError}</p>}
          {success && <p className="notice-success">{success}</p>}

          <button className="primary-button" disabled={isLoading} type="submit">
            {isLoading ? (
              <>
                <span className="loader" />
                {isRegister ? 'Sending email' : 'Preparing workspace'}
              </>
            ) : (
              content.button
            )}
          </button>
        </form>

        <p className="mt-7 text-center text-sm text-[#69646b]">
          {content.switchLabel}{' '}
          <button className="font-black text-[#611f69] transition hover:text-[#4a154b]" onClick={() => onModeChange(isRegister ? 'login' : 'register')} type="button">
            {content.switchAction}
          </button>
        </p>
      </div>
    </>
  );
}

function SessionLoader() {
  return (
    <div className="grid min-h-[420px] place-items-center text-center">
      <div>
        <span className="loader mx-auto border-[#611f69]/25 border-t-[#611f69]" />
        <p className="mt-4 font-bold text-[#4a154b]">Checking your session</p>
      </div>
    </div>
  );
}

export default AuthCard;
