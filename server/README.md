# Servidor do Liberte: guia de ativação (~30 min, só navegador)

O servidor libera três coisas:

1. **Google conectado de verdade.** Acabam o limite das 18h e o "toque para reconectar". Você conecta uma vez em cada aparelho e pronto.
2. **Caixa de entrada pelo WhatsApp.** Uma mensagem começando com "tarefa" (texto, áudio ou foto) vira tarefa no app.
3. **Acesso da equipe.** Cada pessoa entra com o próprio Google num link e vê só as tarefas dela. Ela pode concluir, marcar o checklist e comentar, e você recebe o aviso no app.

Custo: **zero**, porque o plano gratuito do Cloudflare cobre com folga. As tarefas continuam no seu Google Drive; o servidor guarda só a autorização do Google, a lista da equipe e as mensagens até o app buscar.

---

## Passo 1: conta no Cloudflare (3 min)

1. Acesse **dash.cloudflare.com** e clique em **Sign up**. Use o e-mail da Liberte. O plano é o Free e não pede cartão.
2. Confirme o e-mail.

## Passo 2: banco de dados (3 min)

1. No menu da esquerda, abra **Storage & Databases → D1 SQL Database** e clique em **Create**.
2. Em Name, digite `liberte` e clique em **Create**.
3. Abra a aba **Console**.
4. Cole **todo** o conteúdo do arquivo [`schema.sql`](schema.sql) e clique em **Execute**. Deve aparecer "success".

## Passo 3: criar o servidor (5 min)

1. No menu, abra **Compute (Workers) → Workers & Pages → Create → Start with Hello World**.
2. Em Name, digite `liberte` e clique em **Deploy**.
3. Clique em **Edit code**, apague tudo o que estiver lá e cole **todo** o conteúdo de [`src/index.js`](src/index.js). Depois clique em **Deploy**.
4. Anote o endereço que aparece, no formato `https://liberte.SEU-NOME.workers.dev`.

## Passo 4: ligar o banco ao servidor (2 min)

Abra o Worker `liberte` e vá em **Settings → Bindings → Add → D1 database**:
- Variable name: `DB` (maiúsculas)
- D1 database: `liberte`

Depois clique em **Deploy** ou **Save**.

## Passo 5: configurações (5 min)

Ainda no Worker, abra **Settings → Variables and Secrets → Add**.

| Nome | Tipo | Valor |
|---|---|---|
| `ALLOWED_ORIGIN` | Text | `https://mariadaliberte.github.io` |
| `GOOGLE_CLIENT_ID` | Text | `559871219811-frs39k63p0hfc22f42ofdrt3p5687fro.apps.googleusercontent.com` |
| `OWNER_EMAILS` | Text | o e-mail Google que você usa no app (aparece em Ajustes → "Conectado como …") |
| `GOOGLE_CLIENT_SECRET` | **Secret** | a "chave secreta do cliente" do Google (veja o passo 6) |
| `INBOX_KEY` | **Secret** | uma senha longa inventada por você, por exemplo `liberte-caixa-7Hq2-pXv9-2026` (guarde-a: o Make vai usar) |

Clique em **Deploy** ou **Save**.

## Passo 6: Google Cloud (5 min)

1. Abra **console.cloud.google.com**, no mesmo projeto em que você criou o Client ID.
2. Vá em **APIs e serviços → Credenciais** e clique no cliente OAuth do Liberte.
3. Copie a **Chave secreta do cliente**. Se ela não aparecer, clique em **Adicionar chave secreta** e copie a nova. Cole no `GOOGLE_CLIENT_SECRET` do passo 5.
4. Vá em **Tela de consentimento OAuth** (ou **Público-alvo**) e clique em **Publicar app**, para o status mudar para **Em produção**.

> ⚠️ **Não pule o item 4.** Em modo "Teste", o Google derruba a conexão a cada 7 dias. Em produção, o Google mostra uma vez a tela "o Google não verificou este app". Clique em **Avançado → Acessar Liberte**. Isso é normal para app de uso interno.

Não precisa cadastrar nenhum endereço novo de redirecionamento.

## Passo 7: me mande o endereço

Mande o endereço do passo 3 (`https://liberte....workers.dev`). Eu coloco no app e publico. Depois disso:

- **Em cada aparelho:** abra **Ajustes → Conectar Google**, escolha a conta e marque **todas** as permissões. Deve aparecer "✅ Conexão permanente ativa". É a última vez que ele pede login.
- **Equipe:** em **Pessoas**, confira se cada pessoa tem o e-mail Google dela. Copie o link em **Ajustes → "Link para a equipe"** e mande para elas.

## Passo 8: WhatsApp → tarefas (eu faço, com a sua aprovação)

O seu WhatsApp no Make (Z-API) só envia as mensagens recebidas para **um** cenário, e hoje esse cenário é o **"LinkedIn - captura aprovacao WhatsApp"**. A proposta é colocar um desvio no começo dele:

- Mensagem que começa com **"tarefa"** (por exemplo, "tarefa ligar para Joana sexta às 10h urgente"), ou áudio ou foto com essa legenda, vai para o Liberte.
- Todo o resto continua indo para a aprovação do LinkedIn, sem mudança nenhuma.

Com o seu "ok" e a `INBOX_KEY`, eu faço a alteração pelo Make e testo. Se preferir, você mesma pode adicionar no cenário um módulo **HTTP → Make a request**:
- URL: `https://liberte....workers.dev/inbox`, método `POST`
- Cabeçalho `X-Inbox-Key`: a sua `INBOX_KEY`
- Corpo (JSON):
  `{"text": "{{texto sem a palavra tarefa}}", "from": "WhatsApp", "mediaUrl": "{{1.audio.audioUrl ou 1.image.imageUrl}}"}`

---

## Para quem for mexer no código

- `src/index.js` é o Worker inteiro, num arquivo só (Cloudflare Workers + D1).
- `schema.sql` cria as tabelas.
- `npm test` roda o teste de ponta a ponta local (`wrangler dev` com um Google falso).
- Também dá para publicar pela linha de comando: `npx wrangler login`, depois `npx wrangler d1 create liberte` (copie o id para o `wrangler.toml`), `npm run db:init`, `npx wrangler secret put GOOGLE_CLIENT_SECRET`, `npx wrangler secret put INBOX_KEY` e `npm run deploy`.

### Rotas

| Rota | Quem usa | O que faz |
|---|---|---|
| `POST /auth/exchange` | app e equipe | troca o código do Google por uma sessão (180 dias, renovada a cada uso) |
| `POST /auth/token` | app da dona | entrega um acesso novo ao Google, sem janelinha |
| `POST /auth/logout` | todos | encerra a sessão |
| `POST /inbox` | Make, atalhos | recebe uma mensagem (chave em `X-Inbox-Key`): texto e arquivo, ou link do arquivo |
| `GET /inbox`, `GET /inbox/:id/file`, `POST /inbox/ack` | app da dona | busca as mensagens, baixa os anexos e confirma |
| `PUT /team` | app da dona | envia a equipe e as tarefas de cada pessoa |
| `GET /team/updates`, `POST /team/updates/ack` | app da dona | o que a equipe fez |
| `GET /my/tasks`, `POST /my/tasks/:id` | equipe | ver, concluir, reabrir, checklist e comentar |
