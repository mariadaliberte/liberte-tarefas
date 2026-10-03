// Chamadas à IA (Claude) direto do aparelho, com a chave guardada só nele.
// Usado pelo Painel (análise) e pelo Caderno / anexos (ler letra de mão).

export function aiKey() {
  try { return localStorage.getItem('lt.ai.key') || ''; } catch { return ''; }
}

export async function askClaude({ system, content, effort = 'medium' }) {
  const key = aiKey();
  if (!key) throw Object.assign(new Error('Cadastre a chave da IA em Ajustes → Análise com IA.'), { noKey: true });
  const { default: Anthropic } = await import('./vendor/anthropic-sdk.js');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('Chave da API inválida. Confira em Ajustes → Análise com IA.');
    if (error instanceof Anthropic.PermissionDeniedError) throw new Error('Sua chave não tem permissão para este modelo. Confira no console da Anthropic.');
    if (error instanceof Anthropic.RateLimitError) throw new Error('Limite de uso atingido. Tente de novo em alguns minutos.');
    if (error instanceof Anthropic.APIConnectionError) throw new Error('Sem conexão com a Anthropic. Verifique a internet.');
    if (error instanceof Anthropic.APIError) throw new Error(`A IA não respondeu (erro ${error.status}). Tente de novo.`);
    throw error;
  }
  if (response.stop_reason === 'refusal') throw new Error('A IA não conseguiu processar este pedido. Tente de novo mais tarde.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('A IA não retornou texto. Tente de novo.');
  return text;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const READ_SYSTEM = `Você lê páginas escritas à mão (caderno, folha de gestão, post-it, quadro) de uma empresária brasileira e transforma o que está escrito em tarefas.

Responda só com as tarefas, uma por linha, sem marcadores, sem numeração e sem comentários. Escreva cada linha em português, no formato que o app entende:
- Comece pelo que precisa ser feito (verbo + objeto), curto e claro.
- Datas como foram escritas ou como "amanhã", "sexta", "dia 20", "20/10"; horário como "às 15h".
- Prazo como "até sexta". Repetição como "todo dia 20" ou "toda segunda".
- Pessoa responsável com @Nome (ex.: @Ana). Projeto com #nome, se estiver escrito.
- Urgência só se estiver marcada na folha (escreva "urgente" ou "alta prioridade").
- Itens riscados ou marcados como feitos: ignore.
- Se um trecho estiver ilegível, transcreva o que der e termine a linha com "(?)".
Se a página não tiver nenhuma tarefa, responda apenas: NADA`;

// Lê a imagem de uma página e devolve as linhas de tarefa (prontas para o interpretador).
export async function readTasksFromImage(blob, { today = new Date() } = {}) {
  const data = await toBase64(blob);
  const media = /^image\/(png|jpeg|gif|webp)$/.test(blob.type) ? blob.type : 'image/jpeg';
  const date = today.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const text = await askClaude({
    system: READ_SYSTEM,
    content: [
      { type: 'image', source: { type: 'base64', media_type: media, data } },
      { type: 'text', text: `Hoje é ${date}. Transcreva as tarefas desta página.` },
    ],
  });
  return parseLines(text);
}

export function parseLines(text) {
  if (/^\s*NADA\s*$/i.test(text)) return [];
  return text.split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*☐□]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && !/^NADA$/i.test(l));
}
