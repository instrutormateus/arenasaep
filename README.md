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
