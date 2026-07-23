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

- A camada gratuita da Cloudflare possui cotas. Quando a cota de Workers AI acabar, a extração local do texto e o recorte manual continuam disponíveis, mas a aprovação em nuvem dependerá da renovação da cota.
- O gabarito nunca é definido automaticamente pela IA. Ele precisa ser confirmado pelo instrutor antes do arquivamento.
- O modelo de IA pode ser alterado nas variáveis do Pages sem editar o HTML.
- Para produção institucional, recomenda-se substituir a chave compartilhada por Cloudflare Access ou autenticação corporativa.


## Cotas gratuitas

A aplicação foi configurada para economizar a cota: o PDF.js extrai o texto no navegador e somente as páginas relevantes são enviadas à IA. O modelo visual padrão é `@cf/google/gemma-4-26b-a4b-it`, mas pode ser trocado nas variáveis do Pages. As cotas da Cloudflare podem mudar; acompanhe o painel de uso.
