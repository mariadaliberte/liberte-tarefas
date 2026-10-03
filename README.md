# Liberte Tarefas

App de tarefas e compromissos integrado ao Google Agenda. Funciona no celular (instala como app) e no computador.

**Endereço depois de publicado:** https://mariadaliberte.github.io/liberte-tarefas/

## O que ele faz

- **Painel (tela inicial):** resumo do dia e da semana em números (para hoje, atrasadas, próximos 7 dias, concluídas na semana, sem data, em aberto), agenda de hoje, gráficos de ritmo (criadas x concluídas), carga dos próximos dias, prioridades, responsáveis e projetos. Inclui **análise automática** (alertas e sugestões por regras, sem custo) e **análise com IA** (Claude), que lê suas tarefas e devolve resumo, pontos de atenção, sugestões e o foco do dia.
  - Para a IA: crie uma chave em console.anthropic.com → API Keys (defina um limite de gasto) e cole em Ajustes → Análise com IA. A chave fica só no aparelho. Cada análise custa poucos centavos de dólar.
- **Aparência:** Ajustes → Aparência: automático (segue o aparelho), claro ou escuro.

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
- **Visões:** Tudo (Atrasadas, Hoje, Amanhã, Próximos 7 dias, Mais adiante, Sem data), Agenda (no formato do Google Agenda: grade de horários por Semana, 3 dias ou Dia, com seus compromissos do Google e as tarefas; toque num horário vazio para criar uma tarefa ali), Pessoas (o que está com cada um) e Feitas.
- **Tablet e celular sincronizados:** com a mesma conta Google conectada nos dois, o que você faz num aparece no outro em segundos (tarefas, projetos, anotações, pessoas, ajustes e o modelo da sua folha).
- **Conexão com o Google:** o Google dá acesso por 1 hora a apps sem servidor; o app renova sozinho no seu próximo toque na tela, até as 18h. Depois das 18h, um toque reconecta.
- **Data de criação automática:** cada tarefa mostra quando foi criada (e como: digitada, por voz, foto ou caderno). Tarefas paradas há 7 dias ou mais ganham o aviso “há N dias”. A data também vai na descrição do evento no Google Agenda.
- **Caderno (tablet com caneta):** aba “Caderno” com folha pautada.
  - *Escrever:* escreva à mão, uma tarefa por linha; o tablet converte sua letra em texto (Scribble no iPad com Apple Pencil; S Pen ou teclado com escrita à mão no Android). O app mostra ao lado como cada linha vai virar tarefa (data, prioridade, responsável) e salva todas de uma vez. O rascunho fica guardado se você sair.
  - *Desenhar:* rascunho livre (setas, esquemas). A folha vira imagem anexada a uma tarefa. Com a caneta, a palma da mão apoiada na tela é ignorada.
  - *Minha folha:* envie uma vez o modelo da sua folha de gestão (imagem ou PDF). Ele fica salvo no aparelho e vira o fundo onde você escreve com a caneta; a borracha apaga só a tinta, nunca o modelo. Ao salvar, a página preenchida vira tarefa com a imagem anexada. Também dá para enviar páginas já preenchidas em outro app (ex.: Samsung Notes exportado em PDF ou imagem): cada página do PDF vira uma imagem na tarefa.
- **Projetos:** aba “Projetos” para agrupar tarefas e anotações de uma mesma frente (ex.: “Lançamento Mentoria Fluir”).
  - Cada projeto mostra progresso, tarefas atrasadas e a próxima data.
  - Dentro do projeto, tudo que você escreve na barra de baixo vira tarefa do projeto. Em qualquer tela, `#nome` coloca a tarefa no projeto (ex.: `gravar vídeo sexta #lancamento`).
  - **Anotações** funcionam como o caderno do projeto: texto, fotos, páginas da sua folha e PDFs. Marque linhas da anotação para virarem tarefas do projeto (data, prioridade e @responsável são lidos da linha).
  - **Cronograma:** visão de cronograma do projeto (estilo Gantt), com escala por dias ou semanas. Tarefa com “Começa em” e prazo vira barra; tarefa só com data vira marco (losango). Mostra hoje, fins de semana, atrasadas em vermelho e as datas de início e entrega do projeto (definidas em “Editar”). Toque numa barra para editar a tarefa.
  - As tarefas de projeto também aparecem nas listas gerais (Tudo, Agenda, Pessoas) com a etiqueta do projeto; o filtro “Todo projeto” mostra só as de um projeto.
  - No Caderno, escolha em “Salvar em” se o que você escreveu ou desenhou vira tarefa solta, tarefa de um projeto ou anotação de um projeto.
- **Tablet e computador:** menu fixo na lateral esquerda (a partir de 768px de largura, inclusive tablet em pé).
- **Caneta, marca-texto e borracha:** 6 cores de caneta e 5 de marca-texto no modo Desenhar e em Minha folha.
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
- `js/projects.js` — projetos, anotações e cronograma
- `js/timeline.js` — cálculo do cronograma
- `css/styles.css` — visual (cores da marca no topo do arquivo)
