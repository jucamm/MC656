import './Historico.css';

function Historico() {
    const pautas = ['Pauta 1', 'Pauta 2', 'Pauta 3'];

  return (
    <section className="pagina">

        <section id="header">
        </section>

        <section id="historico">

            <h1>Histórico</h1>

            <div className="CaixaFiltros">

                <h2>Filtros</h2>

                <div className="filtros">

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