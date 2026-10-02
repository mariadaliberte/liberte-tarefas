# Liberte Tarefas

App de tarefas e compromissos integrado ao Google Agenda. Funciona no celular (instala como app) e no computador.

**Endereço depois de publicado:** https://mariadaliberte.github.io/liberte-tarefas/

## O que ele faz

- **Captura rápida por texto, voz ou foto.** Escreva ou fale do jeito que você fala: o app entende data, hora, prioridade e responsável.
  - `reunião com fornecedor sexta às 15h urgente @Ana`
  - `pagar DAS dia 20 prioridade alta`
  - `me lembra de ligar para o contador amanhã`
  - `entregar relatório até 15/10 responsável Marcos`
  - `organizar drive sem pressa` (sem data: fica guardada em “Sem data”, nunca some)
- **Google Agenda:** toda tarefa com data vira evento com lembrete no seu celular.
  - Compromisso com hora → evento normal (lembrete 30 min antes e 1 dia antes).
  - Tarefa com data → bloco de 15 min às 9h, marcado como “livre” (não bloqueia sua agenda), com lembrete na hora e na véspera.
  - Cor por prioridade (vermelho = urgente, laranja = alta, cinza = baixa).
  - Concluiu? O evento ganha ✔ e os lembretes param. Excluiu? Sai da agenda.
- **Responsável:** use `@Nome`. Se a pessoa tiver e-mail cadastrado em Ajustes → Pessoas, ela recebe convite na agenda.
- **Prioridade:** Urgente, Alta, Normal, Baixa (lista ordenada automaticamente).
- **Visões:** Tudo (Atrasadas, Hoje, Amanhã, Próximos 7 dias, Mais adiante, Sem data), Agenda (próximos 30 dias junto com seus compromissos do Google), Pessoas (o que está com cada um) e Feitas.
- **Data de criação automática:** cada tarefa mostra quando foi criada (e como: digitada, por voz, foto ou caderno). Tarefas paradas há 7 dias ou mais ganham o aviso “há N dias”. A data também vai na descrição do evento no Google Agenda.
- **Caderno (tablet com caneta):** aba “Caderno” com folha pautada.
  - *Escrever:* escreva à mão, uma tarefa por linha; o tablet converte sua letra em texto (Scribble no iPad com Apple Pencil; S Pen ou teclado com escrita à mão no Android). O app mostra ao lado como cada linha vai virar tarefa (data, prioridade, responsável) e salva todas de uma vez. O rascunho fica guardado se você sair.
  - *Desenhar:* rascunho livre (setas, esquemas). A folha vira imagem anexada a uma tarefa. Com a caneta, a palma da mão apoiada na tela é ignorada.
- **Revisão diária:** em Ajustes, cria um lembrete recorrente (seg a sex) para revisar as tarefas sem data.
- **Nada se perde:** tudo é salvo no aparelho na hora, inclusive sem internet, e copiado para o seu Google Drive (pasta oculta do app + pasta “Liberte Tarefas - Anexos” para fotos e áudios). Abre no celular e no computador com os mesmos dados.
- **Compartilhar para o app (Android):** no WhatsApp, segure a mensagem → Compartilhar → Tarefas.

## Configuração (uma vez só, ~15 minutos)

### 1. Publicar o app

1. No GitHub, abra o repositório → **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.
3. Junte esta branch na `main` (o pull request). A publicação acontece sozinha em ~1 minuto.

### 2. Criar a chave de acesso ao Google (Client ID)

1. Acesse https://console.cloud.google.com/ com a conta Google da sua agenda.
2. Crie um projeto: menu do topo → **Novo projeto** → nome `Liberte Tarefas`.
3. Ative as APIs: menu **APIs e serviços → Biblioteca** → ative **Google Calendar API** e **Google Drive API**.
4. **APIs e serviços → Tela de consentimento OAuth** (ou “Google Auth Platform”):
   - Tipo de usuário: **Externo** → nome do app `Liberte Tarefas`, seu e-mail de suporte e de contato.
   - Em **Público-alvo / Usuários de teste**, adicione o seu e-mail (e de quem mais for usar).
5. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - **Origens JavaScript autorizadas:** `https://mariadaliberte.github.io`
   - Salve e copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).
6. Cole o ID em `js/config.js` (vale para todos os aparelhos) **ou** no app em **Ajustes → Configuração técnica**.

> No modo “teste”, o Google mostra o aviso “O Google não verificou este app”. É o seu próprio app: clique em **Continuar**. Marque todas as permissões (Agenda e Drive).

### 3. Instalar no celular

- **Android (Chrome):** abra o endereço → menu ⋮ → **Instalar app**.
- **iPhone (Safari):** abra o endereço → botão Compartilhar → **Adicionar à Tela de Início**.

Depois: **Ajustes → Conectar Google**, escolha em qual agenda os eventos serão criados (ex.: “Mariá Pinheiro | Liberte-SE”) e cadastre as pessoas da equipe com e-mail.

## Como os lembretes chegam

O canal principal é o **Google Agenda**: as notificações chegam pelo app do Google Agenda no celular, mesmo com o Liberte Tarefas fechado. Garanta que as notificações do Google Agenda estejam ativas no celular.

Opcional: **Ajustes → Ativar notificações neste aparelho** (útil se você não usa o Google Agenda no celular).

## Voz

- **Android / Chrome:** toque no microfone e fale; o texto aparece e a tarefa é salva quando você para de falar.
- **iPhone:** se o microfone do app não transcrever, ele grava o áudio e anexa à tarefa. Para transcrever, use o microfone do próprio teclado do iPhone dentro da caixa de texto.

## Desenvolvimento

Sem build, sem servidor: HTML + JavaScript puro.

```bash
npm test     # testes do interpretador de linguagem natural e do mapeamento para a Agenda
npm start    # servidor local em http://localhost:8080
```

Para testar localmente com Google, adicione `http://localhost:8080` às origens autorizadas do Client ID.

Arquivos principais:

- `js/parser.js` — entende “sexta às 15h urgente @Ana”
- `js/event-map.js` — transforma tarefa em evento do Google Agenda
- `js/sync.js` — sincronização com Google Agenda e Drive
- `js/google.js` — login e chamadas às APIs do Google
- `js/store.js` — armazenamento no aparelho
- `js/app.js` — interface
- `js/notebook.js` — modo Caderno (escrita e desenho com caneta)
- `css/styles.css` — visual (cores da marca no topo do arquivo)
