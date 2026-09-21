import './Historico.css';

function Historico() {
    const pautas = ['Pauta 1', 'Pauta 2', 'Pauta 3'];
    const filtros = ['Filtro 1', 'Filtro 2', 'Filtro 3', 'Filtro 4', 'Filtro 5', 'Filtro 6', 'Filtro 7', 'Filtro 8', 'Filtro 9', 'Filtro 10'];

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
                        {filtros.map((filtro) => (
                            <li key={filtro}>
                                <button type="button" className="FiltroButton">
                                    {filtro}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <div className="LinhaBotao">
                        <button className="BotaoApply">Aplicar</button>
                    </div>
                </div>

            </div>

            <div className="CaixaPautas">

                <h2>Pautas</h2>

                <div className="Pautas">
                    <ul className="ListaPautas">
                        {pautas.map((pauta) => (
                            <li key={pauta}>
                                <button type="button" className="PautaButton">
                                    {pauta}
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