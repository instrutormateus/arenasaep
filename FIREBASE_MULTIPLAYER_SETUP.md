# Firebase gratuito — Sala Multiplayer e Torcida

Esta versão usa apenas **Firebase Authentication anônima** e **Realtime Database**, compatíveis com o plano gratuito Spark dentro das cotas do serviço. Não utiliza Cloud Functions nem Cloud Storage.

## 1. Criar o projeto

1. Entre no Console do Firebase e crie um projeto.
2. Em **Configurações do projeto > Seus apps**, adicione um aplicativo Web.
3. Em **Authentication > Settings > Authorized domains**, adicione o domínio do Cloudflare Pages, por exemplo `arena-saep-pages.pages.dev`, caso ele ainda não apareça.
4. Copie o objeto `firebaseConfig`.
5. Cole os valores em `FIREBASE_CONFIG`, no início de `public/index.html`.

## 2. Habilitar autenticação anônima

1. Abra **Authentication > Sign-in method**.
2. Ative **Anonymous/Anônimo**.

## 3. Criar o Realtime Database

1. Abra **Realtime Database > Create database**.
2. Escolha uma região.
3. Depois de criado, copie o campo `databaseURL` para `FIREBASE_CONFIG`.

## 4. Instalar as regras

Abra **Realtime Database > Rules**, substitua o conteúdo pelas regras do arquivo `firebase_rules_multiplayer.json` e publique. As mesmas regras também podem ser abertas pelo botão **Regras Firebase** dentro do jogo.

## 5. Publicar novamente

Faça commit das alterações no GitHub. O Cloudflare Pages publicará a nova versão.

## Estrutura em tempo real

- `rooms/{codigo}/players`: jogadores que podem ocupar as estações A–D.
- `rooms/{codigo}/spectators`: espectadores da torcida.
- `rooms/{codigo}/presence`: estado online/offline.
- `rooms/{codigo}/publicState`: placar, questão e cronômetro.
- `rooms/{codigo}/actions`: respostas e passagens.
- `rooms/{codigo}/reactions`: emojis temporários. O navegador do instrutor remove as reações depois da animação.

## Observações

- A partida aceita 2, 3 ou 4 estações.
- Espectadores não ocupam estações e entram sem aprovação.
- Apenas espectadores cadastrados podem gravar reações.
- O plano Spark do Realtime Database limita as conexões simultâneas; jogadores, instrutor e espectadores contam nesse total.

## Correção de sincronização da versão 1.3.8

Depois de atualizar o `public/index.html`, também substitua e publique as regras do arquivo `firebase_rules_multiplayer.json`.

A regra principal da sala permite:

- criar a sala somente quando `hostUid` corresponde ao usuário autenticado;
- atualizar qualquer campo da sala somente pelo instrutor proprietário;
- manter as permissões específicas para jogadores, espectadores, presença, ações e reações.

Se a Arena informar que a sala pertence a outra sessão anônima, crie uma nova sala. Isso pode acontecer quando os dados do navegador são apagados ou quando a sala foi criada em outro navegador/perfil.
