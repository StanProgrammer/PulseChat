import { useEffect, useState } from 'react';
import {
  clearStoredAccessToken,
  getProfile,
  getStoredAccessToken,
  login,
  logout,
  refreshSession,
  register,
  storeAccessToken,
  verifyEmail
} from './api/auth';
import AuthCard from './components/AuthCard';
import MarketingPanel from './components/MarketingPanel';
import Workspace from './components/Workspace';
import { AuthMode, AuthResponse, LoginPayload, RegisterPayload, User } from './types/auth';

function App() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [accessToken, setAccessToken] = useState(getStoredAccessToken);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const verificationToken = new URLSearchParams(window.location.search).get('verifyToken');

        if (verificationToken) {
          const verification = await verifyEmail(verificationToken);

          if (isMounted) {
            clearSession();
            setMode('login');
            setSuccess(verification.message);
            window.history.replaceState({}, document.title, window.location.pathname);
          }

          return;
        }

        if (accessToken) {
          const profile = await getProfile(accessToken);

          if (isMounted) {
            setUser(profile.user);
            return;
          }
        }

        const refreshed = await refreshSession();

        if (isMounted) {
          saveSession(refreshed);
        }
      } catch {
        if (isMounted) {
          clearSession();
        }
      } finally {
        if (isMounted) {
          setIsSessionLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveSession = (authResponse: AuthResponse) => {
    storeAccessToken(authResponse.accessToken);
    setAccessToken(authResponse.accessToken);
    setUser(authResponse.user);
  };

  const clearSession = () => {
    clearStoredAccessToken();
    setAccessToken('');
    setUser(null);
  };

  const handleAuthSubmit = async (payload: LoginPayload | RegisterPayload) => {
    const isRegister = mode === 'register';

    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (isRegister) {
        const registerResponse = await register(payload as RegisterPayload);

        setMode('login');
        setSuccess(registerResponse.message);
        return true;
      }

      const authResponse = await login(payload);

      saveSession(authResponse);
      setSuccess('Signed in successfully.');
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to complete authentication.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    setError('');

    try {
      if (accessToken) {
        await logout(accessToken);
      }
    } catch {
      setError('Your local session was cleared, but the server logout request could not complete.');
    } finally {
      clearSession();
      setIsLoading(false);
      setSuccess('');
    }
  };

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setSuccess('');
  };

  if (user) {
    return <Workspace accessToken={accessToken} isLoading={isLoading} onLogout={handleLogout} user={user} />;
  }

  return (
    <main className="auth-shell min-h-dvh overflow-x-hidden bg-[#f6f3ef] text-[#1d1c1d]">
      <div className="auth-grid relative mx-auto grid min-h-dvh w-full max-w-7xl items-center gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <MarketingPanel />
        <AuthCard
          error={error}
          isLoading={isLoading}
          isSessionLoading={isSessionLoading}
          mode={mode}
          onModeChange={handleModeChange}
          onSubmit={handleAuthSubmit}
          success={success}
        />
      </div>
    </main>
  );
}

export default App;
