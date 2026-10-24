 import { useState, useEffect } from 'react';
    import { authApi } from './services/authApi';
    import type { User } from './types/auth';
    import { LoginForm } from './components/auth/LoginForm';
    import { RegisterForm } from './components/auth/RegisterForm';
    import { VerificationView } from './components/auth/VerificationView';
    import Historico from './components/Historico';
    import FormularioPauta from './components/formulario-pauta';
    import './App.css';
    
    type Screen = 'login' | 'register' | 'verification' | 'dashboard';
    
    function App() {
      const [currentUser, setCurrentUser] = useState<User | null>(null);
      const [currentScreen, setCurrentScreen] = useState<Screen>('login');
      const [loadingInitial, setLoadingInitial] = useState(true);
    
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
        init();
      }, []);
    
      const handleLogout = async () => {
        await authApi.logout();
        setCurrentUser(null);
        setCurrentScreen('login');
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
          <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-indigo-600">MC656</span>
              <span className="text-sm bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-full font-mono">HU01</span>
            </div>
    
            {currentUser && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-800">{currentUser.name}</div>
                  <div className="text-xs text-gray-500">
                    Status:{' '}
                    <span className={`font-semibold ${currentUser.status === 'verified' ? 'text-green-600' : 'text-amber-600'}`}>
                      {currentUser.status === 'verified' ? 'Verificado' : 'Pendente (2FA)'}
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
          <main className="flex-1 p-8">
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
                onSuccess={async () => {
                  const res = await authApi.getMe();
                  setCurrentUser(res.user);
                  setCurrentScreen('verification');
                }}
                onSwitchToLogin={() => setCurrentScreen('login')}
              />
            )}
    
            {currentScreen === 'verification' && currentUser && (
              <VerificationView
                user={currentUser}
                onUserUpdated={(updated) => setCurrentUser(updated)}
                onContinue={() => setCurrentScreen('dashboard')}
              />
            )}
    
            {currentScreen === 'dashboard' && currentUser && (
              <div className="max-w-6xl mx-auto flex flex-col gap-8">
                <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg shadow-sm">
                  <h3 className="font-bold text-green-800">Bem-vindo(a) à Área Protegida!</h3>
                  <p className="text-sm text-green-700">
                    Sua conta foi autenticada e validada com dois fatores (e-mail e celular).
                  </p>
                </div>
                {/* Componentes de negócio já existentes */}
                <Historico />
                <FormularioPauta />
              </div>
            )}
          </main>
        </div>
      );
    }
    
    export default App;

    