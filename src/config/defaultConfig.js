const defaultConfig = {
    delays: {
        entreMensagens: 800,
        entreEnquetes: 100,
        finalizacao: 800,
        inicial: 1000
    },
    nomes: {
        professores: [
            'Rafael Bayma',
            'André Cruz'
        ],
        bolsistas: [
            'Lucas Soares.',
            'Jessica Sousa.',
            'Richard Cavalcante',
            'Benedito Gaia.',
            'Victoria Oliveira'
        ],
        usuariosFrequentes: [
            'Alessandra Gabriele.',
            'Ana Karlla',
            'Moisaniel',
            'Daiane Rosa',
            'Elielson Sales.',
            'Geovana Carvalho',
            'Hartur Sousa',
            'Henrique Fernandes.',
            'Igor Emanoel.',
            'Jovana Ferreira',
            'João Paulo',
            'Kleber Peres.',
            'Laura Santos.',
            'Marcos Aurélio',
            'Victor'
        ],
        devedores: [
            'Ana Karlla',
            'Daiane Rosa',
            'Hartur Sousa',
            'Jovana Ferreira',
            'Marcos Aurélio'
        ]
    },
    maxOpcoesPorEnquete: 10,
    grupoAlvo: 'Copa_FabLab',
    pix: {
        chave: 'santander.lucas.pix@gmail.com',
        copiaCola: '00020126660014br.gov.bcb.pix0129santander.lucas.pix@gmail.com0211Coleta copa5204000053039865802BR5925LUCAS GONCALVES SOARES SO6007TUCURUI62580520SAN2025110112555739250300017br.gov.bcb.brcode01051.0.06304919F'
    },
    valoresContribuicao: [
        'R$ 10,00',
        'R$ 12,00',
        'R$ 15,00',
        'R$ 20,00',
        'Outro valor'
    ]
};

module.exports = defaultConfig;
