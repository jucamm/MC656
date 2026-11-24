 import { useState, useEffect } from 'react';
    import { authApi } from './services/authApi';
    import type { User } from './types/auth';
    import { LoginForm } from './components/auth/LoginForm';
    import { RegisterForm } from './components/auth/RegisterForm';
    import { VerificationView } from './components/auth/VerificationView';
    import { GroupsDashboard } from './components/groups/GroupsDashboard';
    import { MeetingsDashboard } from './components/meetings/MeetingsDashboard';
    import { meetingFromNotification } from './components/meetings/meeting-notification-link';
    import './App.css';
    
    type Screen = 'login' | 'register' | 'verification' | 'dashboard';
    
    function App() {
      const [currentUser, setCurrentUser] = useState<User | null>(null);
      const [currentScreen, setCurrentScreen] = useState<Screen>('login');
      const [loadingInitial, setLoadingInitial] = useState(true);
      const [initialDeliveryFailed, setInitialDeliveryFailed] = useState(false);
    
      // Recupera sessão existente ao recarregar a página
      useEffect(() => {
        const init = async () => {
          if (authApi.getToken()) {
            try {
              const res = await authApi.getMe();
              setCurrentUser(res.user);
              setCurrentScreen(res.user.status === 'verified' ? 'dashboard' : 'verification');
            } catch {
              authApi.setToken(null);
              setCurrentScreen('login');
            }
          }
          setLoadingInitial(false);
        };
        void init();
      }, []);
    
      const handleLogout = async () => {
        try {
          await authApi.logout();
        } catch {
          // O cliente de autenticação já encerrou a sessão local.
        } finally {
          setCurrentUser(null);
          setInitialDeliveryFailed(false);
          setCurrentScreen('login');
        }
      };
    
      if (loadingInitial) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="text-gray-600 font-medium">Carregando aplicação...</div>
          </div>
        );
      }
    
      return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
          {/* Barra de Navegação Superior */}
          <header className="app-header">
            <div className="flex items-center gap-3">
              <span className="app-brand"><img src="/favicon.svg" alt="" />Unidebates</span>
            </div>
    
            {currentUser && (
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 break-words text-right">
                  <div className="text-sm font-semibold text-gray-800">{currentUser.name}</div>
                  <div className="text-xs text-gray-500">
                    Status:{' '}
                    <span className={`font-semibold ${currentUser.status === 'verified' ? 'text-green-800' : 'text-amber-800'}`}>
                      {currentUser.status === 'verified' ? 'Verificado' : 'E-mail pendente'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg transition"
                >
                  Sair
                </button>
              </div>
            )}
          </header>
    
          {/* Conteúdo Principal */}
          <main className="app-content flex-1 p-4 sm:p-8">
            {currentScreen === 'login' && (
              <LoginForm
                onSuccess={(user) => {
                  setCurrentUser(user);
                  setCurrentScreen(user.status === 'verified' ? 'dashboard' : 'verification');
                }}
                onSwitchToRegister={() => setCurrentScreen('register')}
              />
            )}
    
            {currentScreen === 'register' && (
              <RegisterForm
                onSuccess={async (deliveryFailed) => {
                  const res = await authApi.getMe();
                  setCurrentUser(res.user);
                  setInitialDeliveryFailed(deliveryFailed);
                  setCurrentScreen('verification');
                }}
                onSwitchToLogin={() => setCurrentScreen('login')}
              />
            )}
    
            {currentScreen === 'verification' && currentUser && (
              <VerificationView
                user={currentUser}
                initialDeliveryFailed={initialDeliveryFailed}
                onUserUpdated={(updated) => setCurrentUser(updated)}
                onContinue={() => setCurrentScreen('dashboard')}
              />
            )}
    
            {currentScreen === 'dashboard' && currentUser?.status === 'verified' && (
              <div className="max-w-6xl mx-auto flex flex-col gap-8">
                <MeetingsDashboard key={`meetings-${currentUser.id}`} userId={currentUser.id} userName={currentUser.name}
                  initialMeetingId={meetingFromNotification(window.location.hash)} />
                <GroupsDashboard key={currentUser.id} userId={currentUser.id} />
              </div>
            )}
          </main>
        </div>
      );
    }
    
    export default App;
