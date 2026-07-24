# Arena SAEP — Cloudflare Pages + Workers AI + D1 + R2

Esta versão não depende de Ollama, Python ou servidor aberto no computador do instrutor.

## Arquitetura

- **Cloudflare Pages:** publica o jogo.
- **Pages Functions / Workers AI:** analisa PDF e classifica toda questão aprovada.
- **D1:** guarda texto, alternativas, gabarito, classificação, autoria e uma revisão imutável a cada aprovação.
- **R2:** guarda os recortes de figuras e alternativas visuais.
- **Firebase (opcional):** continua responsável pelo modo multiplayer em tempo real.

## Publicação sem instalar programas no Windows

### 1. Enviar o projeto ao GitHub pelo navegador

1. Crie um repositório vazio no GitHub.
2. Descompacte este projeto.
3. No repositório, use **Add file > Upload files**.
4. Envie as pastas `public`, `functions` e os arquivos `schema.sql` e `README.md`.
5. Confirme o commit.

> O upload direto pelo painel do Pages não executa Pages Functions. Use integração com GitHub ou Wrangler.

### 2. Criar o projeto Pages

1. No Cloudflare, abra **Workers & Pages**.
2. Escolha **Create application > Pages > Connect to Git**.
3. Selecione o repositório.
4. Configuração de build:
   - Framework preset: **None**
   - Build command: deixe vazio
   - Build output directory: `public`
5. Publique.

### 3. Criar o D1

1. Abra **Storage & Databases > D1 SQL Database**.
2. Crie `arena-saep-db`.
3. Abra a aba **Console**.
4. Copie e execute todo o conteúdo de `schema.sql`.

### 4. Criar o R2

1. Abra **R2 Object Storage**.
2. Crie o bucket `arena-saep-images`.
3. Não é necessário tornar o bucket público. As imagens são entregues pela função `/api/images/...`.

### 5. Adicionar bindings no Pages

No projeto Pages, abra **Settings > Bindings** e adicione:

- Workers AI: variável `AI`
- D1 database: variável `DB`, banco `arena-saep-db`
- R2 bucket: variável `QUESTION_IMAGES`, bucket `arena-saep-images`

Faça isso no ambiente **Production**. Depois, execute um novo deploy.

### 6. Adicionar variáveis e segredo

Em **Settings > Variables and Secrets**, adicione:

- Secret: `ARENA_ADMIN_KEY` — crie uma senha longa exclusiva para os instrutores.
- Variable: `AI_VISION_MODEL` = `@cf/google/gemma-4-26b-a4b-it`
- Variable: `AI_CLASSIFY_MODEL` = `@cf/meta/llama-3.1-8b-instruct-fast`

A chave do instrutor não deve ser escrita no HTML. Ela será digitada no painel e mantida somente durante a sessão do navegador.

### 7. Testar

1. Abra o endereço `https://SEU-PROJETO.pages.dev`.
2. Entre como instrutor.
3. Abra **PDF + IA na nuvem**.
4. Mantenha a URL da API como `/api`.
5. Informe o nome e a chave do instrutor.
6. Clique em **Testar conexão**.

O painel deve indicar:

- IA: OK
- D1: OK
- R2: OK

## Banco de questões

- Ao aprovar um rascunho de PDF, a API classifica novamente a questão e a arquiva.
- Questões importadas de XLSX/CSV podem ser enviadas pelo botão **Classificar e arquivar banco local**.
- IDs e conteúdo repetido são detectados no D1. O registro principal é atualizado, mas cada aprovação também gera uma revisão no histórico.
- Imagens Base64 são transferidas ao R2 e substituídas por URLs internas.
- A aba **Banco em nuvem** permite pesquisar e adicionar questões ao jogo em outro aparelho.

## Observações importantes

- A camada gratuita da Cloudflare possui cotas. Quando a cota de Workers AI acabar, a extração estrutural, a leitura do gabarito, o recorte manual e o arquivamento provisório continuam disponíveis.
- O gabarito não é inventado pela IA. Quando existe uma tabela GABARITO no PDF, a resposta é associada automaticamente pelo código SAEP e precisa ser confirmada pelo instrutor; na ausência da tabela, o preenchimento é manual.
- O modelo de IA pode ser alterado nas variáveis do Pages sem editar o HTML.
- Para produção institucional, recomenda-se substituir a chave compartilhada por Cloudflare Access ou autenticação corporativa.


## Cotas gratuitas

A aplicação foi configurada para economizar a cota: o PDF.js extrai o texto no navegador e somente as páginas relevantes são enviadas à IA. O modelo visual padrão é `@cf/google/gemma-4-26b-a4b-it`, mas pode ser trocado nas variáveis do Pages. As cotas da Cloudflare podem mudar; acompanhe o painel de uso.


## Correção 1.3.1 — erro ao aprovar e arquivar

A versão 1.3.1 corrige a chamada ao Workers AI para usar `max_tokens`, que é o parâmetro aceito pelos modelos do Workers AI. A versão anterior enviava `max_completion_tokens`, podendo causar falha na classificação.

O teste de conexão agora também confirma se as tabelas `questions` e `question_revisions` existem no D1. Se aparecer **tabelas D1: PENDENTES**, abra o banco D1 no painel Cloudflare, entre em **Console** e execute todo o conteúdo de `schema.sql`.

As mensagens de erro da interface agora exibem a etapa exata: classificação por IA, armazenamento no R2, gravação no D1 ou histórico.


## Versão 1.3.2 — cota gratuita do Workers AI

A cota gratuita do Workers AI é de 10.000 Neurons por dia e reinicia às 00:00 UTC.
A partir da versão 1.3.2, o esgotamento dessa cota não bloqueia o arquivamento:

- a classificação produzida na análise visual do PDF é reutilizada, evitando uma segunda chamada de IA;
- quando nenhuma classificação anterior estiver disponível, a questão é arquivada com os metadados revisados pelo instrutor e uma classificação heurística provisória;
- o registro recebe `classificationPending: true` e pode ser atualizado posteriormente;
- para exigir IA obrigatoriamente e voltar ao comportamento estrito, crie a variável `ARCHIVE_WITHOUT_AI=false`.

Essa estratégia mantém o D1 e o R2 disponíveis mesmo quando a cota diária da IA termina.

## Versão 1.3.3 - estrutura característica das provas SAEP

A importação de PDF passou a reconhecer a estrutura completa dos arquivos de prova:

- questões com exatamente **2, 4 ou 5 alternativas**;
- alternativas com texto, somente imagem ou combinação de texto e imagem;
- figuras no enunciado e figuras específicas nas alternativas A, B, C, D ou E;
- o título **FOLHA DE RESPOSTA** como marcador obrigatório de encerramento da seção de questões;
- a seção **GABARITO** nas páginas finais;
- associação automática da resposta correta ao código `SAEP_XXXXX`;
- interrupção da leitura de questões antes da folha de respostas, evitando que os códigos listados na folha ou no gabarito sejam importados como novas questões;
- exibição da quantidade de alternativas e da origem do gabarito na tela de revisão.

O gabarito extraído da tabela oficial é pré-selecionado, mas permanece editável e deve ser confirmado pelo instrutor. Se a tabela não for localizada ou não possuir o código da questão, o campo fica pendente para preenchimento manual.

No PDF de validação `avaliações-3.pdf`, o importador reconhece 40 questões antes da FOLHA DE RESPOSTA, localiza 40 respostas na tabela GABARITO e associa todas pelo código SAEP.

Esta atualização não exige alteração no `schema.sql` nem recriação dos bindings. Basta substituir as pastas `public` e `functions` e realizar um novo deployment no Cloudflare Pages.


## Versão 1.3.4 — correção do arquivamento e histórico atômico

- Corrige o erro `alternativas is not defined` ao converter uma linha do D1 para o formato da Arena.
- A gravação da questão e da revisão histórica passou a ocorrer no mesmo `DB.batch`, evitando registros em `questions` sem a correspondente entrada em `question_revisions`.
- Quando a análise do PDF já identificou o esgotamento da cota diária, o arquivamento não tenta chamar a IA novamente: usa diretamente a classificação provisória revisada pelo instrutor.
- Ao detectar a cota esgotada durante uma importação, as questões seguintes permanecem em processamento local, sem repetir chamadas que inevitavelmente falhariam.
- A mensagem amarela de cota passa a indicar explicitamente que ela não bloqueia a aprovação e o arquivamento.

Questões que já ficaram em `questions` sem histórico devido ao erro anterior podem ser reaprovadas uma vez após esta atualização; uma revisão será criada normalmente.

### Reparar registros antigos sem revisão

Na aba **Banco em nuvem**, use o botão **Reparar histórico**. Ele cria uma revisão-base para toda questão ativa cujo `content_hash` ainda não exista em `question_revisions`. O procedimento não altera o conteúdo atual da questão.

## Versão 1.3.5 — exclusão permanente e limpeza do banco

A aba **Banco em nuvem** passa a oferecer três operações administrativas:

- **Excluir definitivamente** em cada questão: remove o registro da tabela `questions`, todas as revisões da tabela `question_revisions` e todos os objetos do R2 armazenados sob o prefixo da questão.
- **Excluir selecionadas**: aplica a mesma exclusão permanente às questões marcadas.
- **Limpar banco e imagens**: apaga todas as questões, todo o histórico e todos os objetos do R2 com prefixo `questions/`.

As operações exigem confirmação explícita na interface. Para a limpeza completa, é necessário digitar `LIMPAR TUDO`.

A limpeza é idempotente: caso o D1 seja apagado e uma falha temporária impeça a remoção de algum objeto do R2, a mesma operação pode ser executada novamente para eliminar imagens órfãs. Objetos de outros sistemas ou com prefixos diferentes de `questions/` não são removidos.


## Versão 1.3.7 — normalização do texto e alerta de 15 segundos

- A extração local por PDF.js e os resultados do Workers AI passam por normalização automática para remover quebras de linha inseridas pela diagramação do PDF no meio das frases.
- Espaços indevidos antes de pontuação são corrigidos; listas e itens numerados preservam linhas separadas.
- O enunciado e as alternativas são exibidos com alinhamento justificado, hifenização e melhor distribuição em telas grandes e celulares.
- Ao cruzar a marca de 15 segundos, todos os aparelhos conectados recebem um alerta breve: tremor visual, faixa de aviso, vibração quando suportada e sirene curta quando os sons estão habilitados.
- O alerta é executado uma única vez por turno de resposta, inclusive após passagens ou retorno obrigatório. Nos últimos 5 segundos, o cronômetro e o card da questão entram em estado crítico vermelho.


## Multiplayer gratuito com torcida — 1.3.7

- 2, 3 ou 4 estações de jogo.
- Entrada de espectadores sem ocupar estações.
- Reações animadas com emojis visíveis no painel, celulares e projeção.
- Firebase Authentication anônima + Realtime Database no plano Spark.
- Novo alerta industrial de 15 segundos com sobreposição de tela, sirene reforçada, vibração e tremor intenso.
- Consulte `FIREBASE_MULTIPLAYER_SETUP.md` e `firebase_rules_multiplayer.json`.

## Firebase pré-configurado nesta cópia

Esta distribuição já contém o `FIREBASE_CONFIG` do projeto `arena-saep-multiplayer-mateus` em `public/index.html` e em `arena_saep_multiplayer_cloudflare.html`. Antes do uso, confirme no Console Firebase que a autenticação anônima está habilitada, o Realtime Database está ativo e as regras de `firebase_rules_multiplayer.json` foram publicadas.

## Atualização 1.3.8 — sincronização multiplayer

Esta versão corrige a sala em que jogadores e espectadores permaneciam no lobby mesmo após o início da partida.

Correções principais:

- preserva o UID de cada participante ao transformar os registros do Firebase em estações do jogo;
- remove valores `undefined` antes de enviar o estado ao Realtime Database;
- valida se a sessão atual ainda é proprietária da sala;
- sincroniza o início da partida em uma única operação;
- mostra o motivo real quando a sincronização falha;
- evita mensagem de sucesso quando o Firebase recusou a gravação;
- limita imagens Base64 muito grandes no estado em tempo real;
- mantém autenticação anônima com persistência local explícita;
- amplia as regras para permitir ao instrutor atualizar todos os campos da sala, incluindo `startedAt` e `updatedAt`.

### Ação obrigatória após atualizar o site

Publique novamente o conteúdo de `firebase_rules_multiplayer.json` em:

`Firebase Console → Realtime Database → Rules → Publish`

Sem essa atualização, o Firebase poderá recusar o início e a sincronização da partida.


## Versão 1.3.9 — relatório remoto e reconhecimentos

- O relatório final completo é sincronizado e exibido nos aparelhos dos jogadores e espectadores.
- Jogadores fora da vez acompanham a mesma visualização da torcida, com cartas, questão e feedback em modo somente leitura.
- O instrutor pode enviar, em tempo real, o certificado ao vencedor e uma mensagem reflexiva aos demais jogadores.
- A torcida pode receber um certificado criativo e animado, com convite para assumir uma estação na próxima partida.
- Os certificados são gerados no próprio navegador e podem ser impressos ou salvos em PDF.

Não há alteração nas regras do Firebase, no D1, no R2 ou no `schema.sql`.

## Versão 1.4.0 — transições sincronizadas, torcida ampliada e cronômetro persistente

- A animação industrial de passagem e retorno obrigatório agora é registrada no estado público do Firebase e exibida simultaneamente no painel, nas telas de todos os jogadores e na torcida.
- A transição mostra as estações de origem e destino, a esteira, a caixa em movimento, a sinalização industrial e o alerta vermelho no retorno obrigatório.
- A torcida passa a contar com reações positivas e de tensão: aplausos, apoio, celebração, dúvida, susto e desaprovação. As reações continuam animadas e visíveis para todos.
- O cronômetro foi ampliado e centralizado em uma faixa aderente ao topo da questão. Ele permanece visível enquanto o usuário rola o enunciado e as alternativas.
- Entre 15 e 6 segundos, o relógio pulsa em laranja; nos últimos 5 segundos, aumenta e pulsa em vermelho.

Não há alteração nas regras do Firebase, no D1, no R2 ou no `schema.sql`.


## Versão 1.4.1 — painel de reações em duas linhas

- Emojis positivos e de tensão são exibidos em duas linhas fixas.
- Todos os emojis permanecem visíveis em celulares, tablets e computadores.
- A barra de reações não utiliza mais rolagem horizontal.
- Os botões se redimensionam automaticamente para caber na largura disponível.
- Os rótulos Apoio e Tensão permanecem visíveis sem ocupar uma linha adicional.
