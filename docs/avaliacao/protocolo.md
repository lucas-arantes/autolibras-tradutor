# Protocolo do teste de compreensão

Este protocolo descreve como testar se pessoas surdas entendem a sinalização do avatar próprio do AutoLibras. As sessões são aplicadas com a página [`avaliacao.html`](../../apps/web/avaliacao.html) do app web, e o termo para os participantes está em [`tcle.md`](tcle.md).

## Antes de tudo: ética

No Brasil, pesquisa acadêmica com pessoas precisa ser aprovada por um Comitê de Ética em Pesquisa (CEP) antes de recrutar alguém. O projeto é submetido pela Plataforma Brasil e segue as Resoluções CNS 466/2012 e 510/2016. Se os resultados forem publicados como pesquisa (artigo, TCC, dissertação), conte com essa aprovação e com o tempo que ela leva.

Testes internos de usabilidade, sem objetivo de pesquisa, podem ter outro enquadramento. Mesmo assim, valem os mesmos cuidados: consentimento informado, participação voluntária e dados sem identificação. Na dúvida, consulte um CEP. A decisão sobre como conduzir o teste é de quem coordena o projeto.

## Objetivos

1. Medir quanto as pessoas surdas entendem das frases sinalizadas pelo avatar próprio.
2. Comparar com o avatar do VLibras e, quando houver vídeos, com um intérprete humano.
3. Descobrir quais tipos de frase o avatar sinaliza pior: datilologia, números, perguntas, negação ou expressões faciais.
4. Ouvir o que os participantes acham da naturalidade da sinalização e do que precisa melhorar.

O teste avalia o avatar, não o tradutor de português para glosa. Por isso cada frase tem uma glosa fixa, escrita à mão.

## Participantes

- Pessoas surdas adultas (18 anos ou mais) que usam Libras no dia a dia.
- Se possível, um grupo separado de intérpretes de Libras ou filhos ouvintes de pais surdos (CODAs), que avaliam sobretudo a naturalidade e a correção dos sinais.
- Um piloto com 3 a 4 pessoas ajuda a acertar o tempo e as frases antes do teste principal.
- Para o teste principal, use um número de participantes múltiplo do número de condições (por exemplo, 12 ou 18 com três condições). Assim cada frase aparece o mesmo número de vezes em cada condição.

Recrute em associações de surdos, escolas bilíngues e cursos de Libras. A participação é voluntária. Em pesquisa no Brasil não se paga para participar, mas despesas como transporte e alimentação podem ser ressarcidas.

## Material

O conjunto padrão tem 24 frases curtas em 7 categorias. Todas usam sinais que existem no dicionário do VLibras.

| Categoria | Frases | O que testa |
|---|---|---|
| Cotidiano | 5 | Sinais comuns em frases simples |
| Datilologia | 4 | Nomes soletrados, incluindo letra repetida (OTTO) |
| Números | 4 | Idade, hora, ano e valor com MIL |
| Pergunta sim/não | 3 | Sobrancelhas erguidas e inclinação da cabeça |
| Pergunta QU- | 3 | QUAL, ONDE e QUANDO, com testa franzida |
| Negação | 3 | Sinais com negação incorporada e balanço da cabeça |
| Emoção | 2 | Expressão facial do próprio sinal (FELIZ, TRISTE) |

As frases, as glosas e as palavras-chave ficam em `apps/web/src/lib/evaluation.ts`. Para usar outro conjunto, ou acrescentar os vídeos do intérprete, prepare um arquivo JSON e carregue na página:

```json
[
  {
    "id": "c1",
    "category": "cotidiano",
    "text": "Eu gosto de café.",
    "gloss": "EU GOSTAR CAFÉ [PONTO]",
    "keywords": [["gosto", "gostar"], ["cafe"]],
    "video": "https://exemplo.org/videos/c1.mp4"
  }
]
```

Os vídeos do intérprete precisam do mesmo enquadramento do avatar (da cintura para cima, fundo liso) e da mesma glosa, sinalizada sem acrescentar informação. Grave cada frase uma vez, sem cortes no meio.

## Desenho

Cada participante vê todas as frases uma única vez, numa ordem sorteada a partir do código dele. As condições se alternam frase a frase em rodízio (quadrado latino). O número do participante desloca o rodízio, então a mesma frase aparece em condições diferentes para participantes diferentes. Ninguém vê a mesma frase duas vezes, o que evita que a segunda exibição fique mais fácil.

Condições possíveis:

- avatar próprio (VRM do AutoLibras);
- avatar do VLibras (Ícaro);
- vídeo de intérprete humano, só nas frases que têm vídeo.

O avatar do VLibras não pode ser usado em produções audiovisuais com tradução automática, mas aqui ele só serve de comparação num teste, com glosas fixas.

## Duração e roteiro da sessão

Uma sessão leva de 60 a 75 minutos, com uma pausa no meio.

| Etapa | Tempo |
|---|---|
| Acolhimento, explicação e termo de consentimento (em Libras e em português) | 10 a 15 min |
| Questionário de perfil | 5 min |
| Treino com uma frase que não conta | 5 min |
| Primeira metade das frases | 15 min |
| Pausa | 5 min |
| Segunda metade das frases | 15 min |
| Conversa final | 10 min |

Em cada frase:

1. Quem aplica clica em Mostrar. A pessoa assiste à sinalização.
2. A pessoa pode pedir para repetir até duas vezes. A página conta as repetições.
3. A pessoa diz o que entendeu, em Libras ou por escrito. Um intérprete passa a resposta para o português, e quem aplica digita na página com as palavras da pessoa, sem corrigir nem completar.
4. A pessoa dá duas notas de 1 a 5: se a sinalização pareceu natural e quanta certeza tem da resposta.
5. Comentários entram no campo de comentário.

Quem aplica não mostra a frase em português, não confirma se a resposta está certa e não sinaliza a frase de novo. Se a pessoa não entender nada, registre isso como resposta ("não entendi") em vez de pular.

## Questionário de perfil

- Faixa de idade.
- Com que idade aprendeu Libras.
- Escolaridade.
- Estado ou região onde mora (o dicionário segue a variante nacional do VLibras, e sinais regionais podem atrapalhar).
- Se já usou o VLibras ou outro avatar e com que frequência.

Guarde o questionário junto com o código do participante, nunca com o nome.

## Medidas

- Compreensão, a medida principal. Duas pessoas corrigem cada resposta sem saber a condição, de preferência uma delas surda. A escala tem três níveis: 0 (não entendeu ou entendeu outra coisa), 1 (entendeu parte do sentido) e 2 (entendeu o sentido completo, mesmo com outras palavras). As divergências são resolvidas em conversa. Calcule a concordância entre as duas (kappa ponderado) antes da conversa.
- Palavras-chave: a página calcula a fração das palavras-chave presentes na resposta. É só um apoio para conferir a correção, porque não reconhece sinônimos nem frases reformuladas.
- Naturalidade, de 1 (nada natural) a 5 (muito natural).
- Confiança na resposta, de 1 a 5.
- Repetições e tempo de resposta, que a página registra sozinha.
- Comentários de cada frase e da conversa final.

Perguntas da conversa final:

- Qual dos avatares foi mais fácil de entender? Por quê?
- O que mais atrapalhou: as mãos, o rosto, a velocidade ou outra coisa?
- Algum sinal pareceu errado ou de outra região?
- Você usaria o avatar numa transmissão ao vivo? Em que situações não usaria?

## Análise

Compare a compreensão média por condição e por categoria. Com amostras pequenas, mostre medianas e a distribuição das notas em vez de testes estatísticos. Com amostras maiores, um modelo misto com participante e frase como efeitos aleatórios separa a dificuldade da frase da diferença entre condições.

Antes de começar, defina o que conta como resultado bom, por exemplo: compreensão do avatar próprio igual ou maior que a do VLibras, e nenhuma categoria abaixo de 1 na escala de 0 a 2. Registre esse critério junto com o protocolo.

## Dados e privacidade

- A página guarda as respostas só no navegador onde roda, até alguém baixar o CSV ou apagar. Baixe o CSV ao fim de cada sessão e apague os dados do computador quando o teste terminar.
- O CSV tem o código do participante, não o nome. A lista que liga códigos a nomes fica separada, com quem coordena o teste.
- Não grave vídeo do participante sem um consentimento específico para isso. Se gravar, guarde os vídeos em local protegido e apague ao fim do prazo previsto no termo.
- Os dados seguem a LGPD (Lei 13.709/2018): só são usados para o fim informado no termo.

## Como usar a página

1. Abra `avaliacao.html` no app (`npm run dev` e depois http://localhost:5173/avaliacao.html, ou no endereço publicado). Use `?signs=URL` para indicar o pacote de sinais, ou preencha o campo na página.
2. Preencha o código e o número do participante, escolha as condições e, se tiver, carregue o conjunto de frases com vídeos.
3. Use Treino para mostrar uma frase que não conta e ajustar a velocidade, se for preciso.
4. Clique em Começar. Ao fim, baixe o CSV da sessão.

O avatar do VLibras aparece numa janela no canto da tela e depende dos servidores do governo. Teste a conexão antes da sessão. O avatar próprio precisa de WebGL. Use um computador com tela grande, na distância em que a pessoa assiste confortavelmente.

Colunas do CSV: `participant`, `session`, `trial`, `sentenceId`, `category`, `condition`, `text`, `gloss`, `answer`, `keywordScore`, `naturalness`, `confidence`, `replays`, `responseSeconds`, `comment` e `startedAt`.
