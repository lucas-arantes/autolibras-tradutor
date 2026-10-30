/**
 * Dados linguísticos do tradutor por regras. As convenções de saída seguem as
 * glosas do VLibras (o player usado pelo app): palavras em maiúsculas,
 * expressões compostas unidas por "_", verbos no infinitivo, substantivos no
 * singular, adjetivos no masculino e marcadores [PONTO]/[INTERROGAÇÃO]/[EXCLAMAÇÃO].
 */

const words = (list: string) => new Set(list.trim().split(/\s+/));

/** Artigos, contrações e preposições que não têm sinal próprio na frase. */
export const DROPPED = words(`
  o a os as um uma uns umas
  do da dos das no na nos nas ao aos à às pelo pela pelos pelas
  num numa nuns numas dum duma duns dumas
  de em por para pra pro pros pras
  e
  se me te lhe lhes
`);

/** Formas de "ser" e "estar", omitidas como cópula (ELA CANSADO HOJE). */
export const COPULA = words(`
  ser sou é somos são era eras éramos eram fui foi fomos foram seja sejam será serão seria
  estar estou está estamos estão estava estavas estávamos estavam estive esteve estivemos
  estiveram esteja estejam estará estarão estaria sendo sido estando estado
`);

/** Pretérito de "ser"/"ir": é IR quando seguido de destino ("foi à escola"). */
export const FOI_FORMS = words("fui foi fomos foram");
export const DESTINATION_WORDS = words("a ao à aos às para pra pro pros pras embora");

/** Formas de "ir" que, antes de um infinitivo, só marcam futuro e são omitidas. */
export const IR_AUXILIARY = words("vou vai vamos vão ia iam irei irá iremos irão");

/** Palavras que, antes de outra, indicam que ela é substantivo e não verbo. */
export const DETERMINERS = words(`
  o a os as um uma uns umas meu minha meus minhas seu sua seus suas teu tua teus tuas
  nosso nossa nossos nossas este esta estes estas esse essa esses essas aquele aquela
  aqueles aquelas do da dos das no na nos nas ao à pelo pela num numa dum duma
`);

/** Formas verbais irregulares (ou ambíguas) e seu infinitivo. */
export const IRREGULAR_VERBS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    ter: "tenho tens tem temos têm tinha tinhas tínhamos tinham tive teve tivemos tiveram terei terá teremos terão teria tenha tenham tendo tido há houve havia haverá haja",
    ir: "vou vais vai vamos vão ia iam irei irá iremos irão iria indo",
    fazer:
      "faço fazes faz fazemos fazem fiz fez fizemos fizeram fazia faziam farei fará faremos farão faria fazendo",
    poder:
      "posso podes pode podemos podem pude pôde pudemos puderam podia podiam poderei poderá poderia podendo",
    querer:
      "quero queres quer queremos querem quis quisemos quiseram queria queriam quererei quererá",
    dizer:
      "digo dizes diz dizemos dizem disse dissemos disseram dizia diziam direi dirá diremos dirão diria dizendo",
    ver: "vejo vês vê vemos veem vi viu viram via viam verei verá veremos verão veria vendo",
    vir: "venho vens vem vêm veio viemos vieram vinha vinham virei virá viremos virão viria vindo",
    dar: "dou dás dá damos dão dei deu demos deram dava davam darei dará daremos darão daria dando",
    saber:
      "sei sabes sabe sabemos sabem soube soubemos souberam sabia sabiam saberei saberá saberia sabendo",
    trazer:
      "trago trazes traz trazemos trazem trouxe trouxemos trouxeram trazia traziam trarei trará trazendo",
    ler: "leio lês lê lemos leem li leu lemos leram lia liam lerei lerá lendo",
    sair: "saio sais sai saímos saem saí saiu saíram saía saíam sairei sairá saindo",
    ouvir: "ouço ouves ouve ouvimos ouvem ouvi ouviu ouviram ouvia ouviam ouvirei ouvirá ouvindo",
    pedir: "peço pedes pede pedimos pedem pedi pediu pediram pedia pediam pedirei pedirá pedindo",
    dormir:
      "durmo dormes dorme dormimos dormem dormi dormiu dormiram dormia dormiam dormirei dormirá dormindo",
    sentir:
      "sinto sentes sente sentimos sentem senti sentiu sentiram sentia sentiam sentirei sentirá sentindo",
    preferir:
      "prefiro preferes prefere preferimos preferem preferi preferiu preferiram preferia preferindo",
    seguir: "sigo segues segue seguimos seguem segui seguiu seguiram seguia seguindo",
    vestir: "visto vestes veste vestimos vestem vesti vestiu vestiram vestia vestindo",
    servir: "sirvo serves serve servimos servem servi serviu serviram servia servindo",
    perder:
      "perco perdes perde perdemos perdem perdi perdeu perderam perdia perdiam perderei perdendo",
    pôr: "ponho pões põe pomos põem pus pôs pusemos puseram punha punham porei porá pondo",
    sorrir: "sorrio sorris sorri sorrimos sorriem sorriu sorriram sorria sorrindo",
    subir: "subo sobes sobe subimos sobem subi subiu subiram subia subindo",
    conseguir:
      "consigo consegues consegue conseguimos conseguem consegui conseguiu conseguiram conseguia conseguindo",
    construir:
      "construo constróis constrói construímos constroem construí construiu construíram construía construindo",
    caber: "caibo cabe cabem coube couberam cabia",
    cair: "caio cais cai caímos caem caí caiu caíram caía caíam cairei cairá caindo caia caiam",
    // Sem "rio", que quase sempre é o substantivo.
    rir: "ris ri rimos riem riu riram ria riam rirei rindo",
    odiar: "odeio odeias odeia odiamos odeiam odiei odiou odiaram odiava odiavam odeie odeiem",
    sumir: "sumo somes some sumimos somem sumi sumiu sumiram sumia sumiam sumindo suma",
    traduzir:
      "traduzo traduzes traduz traduzimos traduzem traduzi traduziu traduziram traduzia traduzindo traduza",
    reduzir:
      "reduzo reduzes reduz reduzimos reduzem reduzi reduziu reduziram reduzia reduzindo reduza",
    medir: "meço medes mede medimos medem medi mediu mediram medindo meça",
    doer: "dói doem doeu doeram doía doíam doendo",
    descobrir:
      "descubro descobres descobre descobrimos descobrem descobri descobriu descobriram descobria descobrindo descubra",
    repetir:
      "repito repetes repete repetimos repetem repeti repetiu repetiram repetia repetindo repita",
  }).flatMap(([lemma, forms]) => forms.split(" ").map((form) => [form, lemma] as const)),
);

/** Verbos regulares cujas formas conjugadas são geradas automaticamente. */
export const REGULAR_VERBS = words(`
  falar gostar estudar trabalhar morar comprar andar ajudar amar chamar chegar começar
  conversar cozinhar dançar deixar descansar desenhar encontrar ensinar entrar escutar
  esperar explicar ficar ganhar gastar jogar lavar levar ligar limpar mandar mudar nadar
  olhar pagar parar passar pensar perguntar precisar procurar tomar trocar usar viajar
  voltar acordar almoçar jantar lembrar tirar achar acabar aceitar acreditar acompanhar
  adorar apresentar aproveitar avisar brincar buscar cantar casar cuidar custar demorar
  desculpar entregar enviar evitar faltar fechar funcionar gravar guardar imaginar
  importar interessar juntar levantar lutar marcar melhorar mostrar ocupar organizar
  participar pegar preparar preocupar quebrar reclamar respeitar salvar sonhar tentar
  terminar tocar treinar votar visitar namorar telefonar estacionar alugar cansar
  aprender beber comer compreender conhecer correr crescer defender depender descer
  entender escolher escrever esquecer merecer morrer nascer oferecer parecer perceber
  receber responder resolver vender viver acontecer
  abrir assistir decidir desistir discutir dividir existir insistir partir permitir
  cumprir unir imprimir garantir admitir dirigir proibir
  atrasar colocar chorar gritar sentar deitar consertar copiar assinar apagar desligar
  abraçar beijar cumprimentar pular cortar pintar secar molhar esquentar esfriar
  emprestar combinar
  acender agradecer bater morder devolver mexer chover atender
  latir tossir
  acalmar aconselhar acostumar adiar adivinhar ajoelhar alcançar alimentar amarrar ameaçar
  anotar apertar aplaudir apoiar aprovar arrumar assustar atrapalhar aumentar brigar
  caminhar carregar cobrar colar comemorar comentar comparar completar comunicar concordar
  confiar consultar contar continuar controlar convidar costurar criar curtir descrever
  desejar destruir diminuir discordar divertir dobrar duvidar economizar educar empurrar
  encher enganar ensaiar enxergar errar esconder escovar espalhar estragar exagerar
  experimentar festejar filmar fingir fumar incluir informar instalar inventar lamentar
  libertar machucar mastigar matar mentir misturar necessitar negociar obedecer observar
  operar orar passear perdoar pesquisar plantar praticar preencher prometer proteger
  provar publicar puxar queimar reconhecer recusar relaxar respirar reunir rezar roubar
  segurar separar sofrer soltar somar sujar surgir temer transformar tratar vencer vigiar
  voar xingar
`);

/**
 * Formas geradas que são, na maioria das vezes, substantivos ou outras classes.
 * Formas de 1ª pessoa ("trabalho", "estudo") não precisam estar aqui: só viram
 * verbo depois de "eu" ou no início da frase. "como" é exceção ("Como você está?").
 */
export const NOT_VERBS = words(`
  casa casas conta contas volta troca compras marca pena falta forma formas prova nota
  notas parte partes como nada entre leve grave interesse telefone toque corte cortes
  seca pinta
  alimento aperto apoio aumento caminho conto desejo engano ensaio erro estrago exagero
  experimento fumo lamento seguro completo completa dobro sujo curto solto solta calo colo
  ameaça briga cobra cobre cola consulta consultas controle costura dobra escova filme
  informe mata mente menta mistura pesquisa planta puxa reza segura tema vigia alcance
`);

/** Expressões de várias palavras com sinal próprio. */
export const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["bom dia", "BOM_DIA"],
  ["boa tarde", "BOA_TARDE"],
  ["boa noite", "BOA_NOITE"],
  ["tudo bem", "TUDO_BEM"],
  ["por favor", "POR_FAVOR"],
  ["de nada", "DE_NADA"],
  ["com licença", "COM_LICENÇA"],
  ["até logo", "ATÉ_LOGO"],
  ["até amanhã", "ATÉ_AMANHÃ"],
  ["por que", "PORQUE"],
  ["por quê", "PORQUE"],
  ["quantos anos", "QUANTO IDADE"],
  ["muito obrigado", "MUITO OBRIGADO"],
  ["muito obrigada", "MUITO OBRIGADO"],
  ["fim de semana", "FIM_DE_SEMANA"],
  ["todos os dias", "TODO_DIA"],
  ["todo dia", "TODO_DIA"],
  ["mais tarde", "DEPOIS"],
  ["há quanto tempo", "QUANTO TEMPO"],
  ["são paulo", "SÃO_PAULO"],
  ["rio de janeiro", "RIO_DE_JANEIRO"],
  ["belo horizonte", "BELO_HORIZONTE"],
];

export const NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  dois: 2,
  duas: 2,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  mil: 1000,
};

/** Palavras terminadas em "s" que não são plurais (ou que o VLibras mantém). */
export const NOT_PLURALS = words(`
  mais menos depois antes pois após atrás através lápis ônibus vírus tênis óculos
  parabéns férias simples deus adeus jesus eles elas vocês nós vós alguns algumas libras
  três seis dois duas país mês
`);

/** Irregularidades do plural para o singular. */
export const SINGULAR_EXCEPTIONS: Readonly<Record<string, string>> = {
  meses: "mês",
  pais: "pai",
  países: "país",
  ingleses: "inglês",
  portugueses: "português",
  pães: "pão",
  cães: "cão",
  mães: "mãe",
};

/**
 * Adjetivos e substantivos de papel no feminino e sua forma masculina, que é a
 * usada nas glosas do VLibras (PROFESSORA → PROFESSOR).
 */
export const MASCULINE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    `bonita linda nova velha feia alta baixa gorda magra rica cheia vazia ocupada
     preocupada nervosa famosa gostosa obrigada sozinha pequena primeira outra muita pouca
     toda mesma cansada animada atrasada casada solteira chateada`
      .trim()
      .split(/\s+/)
      .map((w) => [w, `${w.slice(0, -1)}o`]),
  ),
  professora: "professor",
};
