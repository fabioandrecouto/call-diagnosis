exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { empresa, segmento, ticket, tipo, transcricao, nome, email, empresaLead, cargo } = body;

  if (!transcricao || transcricao.length < 80)
    return { statusCode: 400, body: JSON.stringify({ error: 'Transcrição muito curta.' }) };

  const systemPrompt = `Você é o Call Diagnosis™ — engine de diagnóstico comercial da ScaleCo.
Analise transcrições de calls comerciais B2B com base no framework SCALE (Strategic, Commercial, Analytics, Leadership, Execution, Governance) e qualificação BANT.
Diagnostique gaps estruturais que impactam conversão e escala.

REGRAS ABSOLUTAS:
- Seja direto, específico, use evidências da conversa.
- Nunca seja genérico. Priorize falhas que impactam conversão.
- Se sem evidência clara: NÃO COBERTO.
- Não invente dados. Seja honesto mesmo sendo duro.
- Responda SOMENTE com JSON válido. Zero texto fora do JSON. Zero markdown. Zero backticks.

ESTRUTURA JSON OBRIGATÓRIA:
{
  "score_geral": <inteiro 0-10>,
  "scale_score": {
    "strategic":  {"nota": <0-10>, "analise": "<string>"},
    "commercial": {"nota": <0-10>, "analise": "<string>"},
    "analytics":  {"nota": <0-10>, "analise": "<string>"},
    "leadership": {"nota": <0-10>, "analise": "<string>"},
    "execution":  {"nota": <0-10>, "analise": "<string>"},
    "governance": {"nota": <0-10>, "analise": "<string>"}
  },
  "bant_score": {
    "budget":    {"coberto": <true|false>, "analise": "<string>", "impacto": "<string se ausente>"},
    "authority": {"coberto": <true|false>, "analise": "<string>", "impacto": "<string se ausente>"},
    "need":      {"coberto": <true|false>, "analise": "<string>", "impacto": "<string se ausente>"},
    "timing":    {"coberto": <true|false>, "analise": "<string>", "impacto": "<string se ausente>"}
  },
  "classificacao_call": "<PIOROU|NEUTRA|AVANCOU>",
  "pontos_fortes": ["<string>","<string>","<string>"],
  "erros_criticos": [
    {"titulo": "<string>", "impacto": "<Alto|Médio|Baixo>", "detalhe": "<string>", "consequencia": "<string>"},
    {"titulo": "<string>", "impacto": "<Alto|Médio|Baixo>", "detalhe": "<string>", "consequencia": "<string>"},
    {"titulo": "<string>", "impacto": "<Alto|Médio|Baixo>", "detalhe": "<string>", "consequencia": "<string>"}
  ],
  "o_que_evitar": ["<string>","<string>","<string>"],
  "perguntas_que_faltaram": ["<string>","<string>","<string>","<string>","<string>"],
  "proxima_melhor_acao": "<string>",
  "diagnostico_estrutural": "<string>",
  "insight_final": "<frase direta e provocativa — máximo 2 linhas curtas>"
}`;

  const userPrompt = `Empresa: ${empresa||'(não informado)'}
Segmento: ${segmento||'(não informado)'}
Ticket médio: ${ticket||'(não informado)'}
Tipo de call: ${tipo||'discovery'}

TRANSCRIÇÃO:
${transcricao}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const raw = (data.content || []).map(b => b.text || '').join('').trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    console.log('LEAD:', { nome, email, empresaLead, cargo, empresa, segmento, ticket, tipo, ts: new Date().toISOString() });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro na análise: ' + e.message }) };
  }
};
