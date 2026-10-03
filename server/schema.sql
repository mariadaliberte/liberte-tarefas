-- Banco do servidor do Liberte (Cloudflare D1). Rodar uma vez: npm run db:init
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL,              -- 'owner' (dona da conta) ou 'member' (equipe)
  refresh_token TEXT,              -- só da dona: mantém o Google conectado sem pedir login
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  last_used TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);

-- Caixa de entrada: mensagens (WhatsApp via Make etc.) esperando virar tarefa no app.
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  text TEXT,
  sender TEXT,
  file_name TEXT,
  file_type TEXT,
  file BLOB,
  created_at TEXT NOT NULL
);

-- Equipe: quem pode entrar e as tarefas atribuídas a cada pessoa (enviadas pelo app da dona).
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_tasks (
  id TEXT PRIMARY KEY,
  assignee_email TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS team_tasks_assignee ON team_tasks(assignee_email);

-- O que a equipe fez (concluir, reabrir, comentar), esperando o app da dona aplicar.
CREATE TABLE IF NOT EXISTS team_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  member_email TEXT NOT NULL,
  member_name TEXT,
  kind TEXT NOT NULL,              -- 'status' ou 'comment'
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
