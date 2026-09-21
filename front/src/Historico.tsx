import { useState } from 'react';
import './Historico.css';
import { mockDatabase } from './data/mockDatabase';

const coresCategorias = ['#d97706', '#2563eb', '#059669', '#db2777', '#7c3aed'];

function Historico() {
    const [pautaAberta, setPautaAberta] = useState<number | null>(null);
    const [filtrosSelecionados, setFiltrosSelecionados] = useState<number[]>([]);
    const [filtrosAplicados, setFiltrosAplicados] = useState<number[]>([]);

    const pautasExibidas = mockDatabase.pautas.filter((pauta) => (
        filtrosAplicados.length === 0
            || pauta.categorias.some((categoria) => filtrosAplicados.includes(categoria))
    ));

    const alternarFiltro = (indiceCategoria: number) => {
        setFiltrosSelecionados((filtrosAtuais) => (
            filtrosAtuais.includes(indiceCategoria)
                ? filtrosAtuais.filter((categoria) => categoria !== indiceCategoria)
                : [...filtrosAtuais, indiceCategoria]
        ));
    };

  return (
    <section className="pagina">

        <section id="header">
        </section>

        <section id="historico">

            <h1>Histórico</h1>

            <div className="CaixaFiltros">

                <h2>Filtros</h2>

                <div className="filtros">
                    <ul className="ListaFiltros">
                        {mockDatabase.categorias.map((categoria) => (
                            <li key={categoria}>
                                <button
                                    type="button"
                                    className={`FiltroButton ${filtrosSelecionados.includes(
                                        mockDatabase.categorias.indexOf(categoria),
                                    ) ? 'FiltroButtonSelecionado' : ''}`}
                                    aria-pressed={filtrosSelecionados.includes(
                                        mockDatabase.categorias.indexOf(categoria),
                                    )}
                                    onClick={() => alternarFiltro(
                                        mockDatabase.categorias.indexOf(categoria),
                                    )}
                                >
                                    {categoria}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <div className="LinhaBotao">
                        <button
                            type="button"
                            className="BotaoApply"
                            onClick={() => {
                                setFiltrosAplicados(filtrosSelecionados);
                                setPautaAberta(null);
                            }}
                        >
                            Aplicar
                        </button>
                    </div>
                </div>

            </div>

            <div className="CaixaPautas">

                <h2>Pautas</h2>

                <div className="Pautas">
                    <ul className="ListaPautas">
                        {pautasExibidas.map((pauta) => (
                            <li key={pauta.id}>
                                <button
                                    type="button"
                                    className={`PautaButton ${pautaAberta === pauta.id ? 'PautaButtonAberta' : ''}`}
                                    aria-expanded={pautaAberta === pauta.id}
                                    onClick={() => setPautaAberta(
                                        pautaAberta === pauta.id ? null : pauta.id,
                                    )}
                                >
                                    <span className="NomePauta">{pauta.nome}</span>
                                    <span className="ListaCategorias">
                                        {pauta.categorias.map((indiceCategoria) => (
                                            <span
                                                className="CategoriaTag"
                                                key={indiceCategoria}
                                                style={{
                                                    backgroundColor:
                                                        coresCategorias[indiceCategoria % coresCategorias.length],
                                                }}
                                            >
                                                {mockDatabase.categorias[indiceCategoria]}
                                            </span>
                                        ))}
                                    </span>
                                    {pautaAberta === pauta.id && (
                                        <span className="TextoPauta">{pauta.texto}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    </section>
  );
}

export default Historico;