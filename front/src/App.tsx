import Historico from './components/Historico';
import FormularioPauta from './components/formulario-pauta';
import './App.css';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col gap-8">
      <Historico />
      <FormularioPauta />
    </div>
  );
}

export default App;