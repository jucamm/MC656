import React, { useState } from 'react';

interface FormData {
  titulo: string;
  descricao: string;
}

export default function FormularioPauta() {
  const [formData, setFormData] = useState<FormData>({
    titulo: '',
    descricao: '',
  });

  const [errors, setErrors] = useState<{ [key in keyof FormData]?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Atualiza os valores do estado conforme o usuário digita
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Limpa a mensagem de erro do campo enquanto o usuário digita
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  // Validação simples dos campos obrigatórios
  const validate = (): boolean => {
    const newErrors: { [key in keyof FormData]?: string } = {};

    if (!formData.titulo.trim()) {
      newErrors.titulo = 'O título da pauta é obrigatório.';
    }
    if (!formData.descricao.trim()) {
      newErrors.descricao = 'A descrição da pauta é obrigatória.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');
    setErrorMessage('');

    // Critério: Impedir envio caso campos obrigatórios não estejam preenchidos
    if (!validate()) {
      return;
    }

    // Critério: Desabilitar botão durante a requisição
    setIsSubmitting(true);

    try {
      // Substitua o URL abaixo pela rota correta da sua API no Express
      const response = await fetch('http://localhost:3000/api/pautas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Falha ao enviar a pauta. Tente novamente.');
      }

      // Critério: Mensagem de sucesso quando enviado corretamente
      setSuccessMessage('Pauta submetida com sucesso!');
      setFormData({ titulo: '', descricao: '' }); // Limpa o formulário
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Ocorreu um erro inesperado.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md border border-gray-200">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Nova Pauta para Reunião</h2>

      {/* Alerta de Sucesso */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          {successMessage}
        </div>
      )}

      {/* Alerta de Erro de Requisição */}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Campo Título */}
        <div>
          <label htmlFor="titulo" className="block text-sm font-medium text-gray-700 mb-1">
            Título da Pauta *
          </label>
          <input
            type="text"
            id="titulo"
            name="titulo"
            value={formData.titulo}
            onChange={handleChange}
            className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 ${
              errors.titulo ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-200'
            }`}
            placeholder="Ex: Discussão sobre novos requisitos"
          />
          {errors.titulo && (
            <p className="mt-1 text-xs text-red-500">{errors.titulo}</p>
          )}
        </div>

        {/* Campo Descrição */}
        <div>
          <label htmlFor="descricao" className="block text-sm font-medium text-gray-700 mb-1">
            Descrição *
          </label>
          <textarea
            id="descricao"
            name="descricao"
            rows={4}
            value={formData.descricao}
            onChange={handleChange}
            className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 ${
              errors.descricao ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-200'
            }`}
            placeholder="Detalhe os pontos principais da pauta..."
          />
          {errors.descricao && (
            <p className="mt-1 text-xs text-red-500">{errors.descricao}</p>
          )}
        </div>

        {/* Botão de Envio */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Enviando...' : 'Enviar Pauta'}
        </button>
      </form>
    </div>
  );
}