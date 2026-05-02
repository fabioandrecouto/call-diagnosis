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

    // Envio de e-mail via Resend
    try {
      const scoreGeral = parsed.score_geral || '—';
      const classif = parsed.classificacao_call || '—';
      const erros = (parsed.erros_criticos || []).map((e, i) => {
        const titulo = typeof e === 'object' ? e.titulo : e;
        const impacto = typeof e === 'object' ? e.impacto : 'Alto';
        return `<li><strong>#${i+1} ${titulo}</strong> [${impacto}]</li>`;
      }).join('');
      const bantStatus = Object.entries(parsed.bant_score || {}).map(([k, v]) => 
        `<li><strong>${k.toUpperCase()}:</strong> ${v.coberto ? '✓ Coberto' : '✗ Ausente'} — ${v.analise||''}</li>`
      ).join('');

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'noreply@scaleco.ai',
          to: 'fabio@scaleco.ai',
          subject: `📞 Call Diagnosis™ — ${empresaLead || empresa || 'Lead'} · Score ${scoreGeral}/10`,
          html: `
            <h2>Novo diagnóstico — Call Diagnosis™</h2>
            <h3>Lead</h3>
            <ul>
              <li><strong>Nome:</strong> ${nome}</li>
              <li><strong>E-mail:</strong> ${email}</li>
              <li><strong>Empresa:</strong> ${empresaLead}</li>
              <li><strong>Cargo:</strong> ${cargo||'—'}</li>
            </ul>
            <h3>Call analisada</h3>
            <ul>
              <li><strong>Empresa:</strong> ${empresa||'—'}</li>
              <li><strong>Segmento:</strong> ${segmento||'—'}</li>
              <li><strong>Ticket:</strong> ${ticket||'—'}</li>
              <li><strong>Tipo:</strong> ${tipo||'—'}</li>
            </ul>
            <h3>Resultado</h3>
            <ul>
              <li><strong>Score geral:</strong> ${scoreGeral}/10</li>
              <li><strong>Classificação:</strong> ${classif}</li>
              <li><strong>Insight:</strong> ${parsed.insight_final||'—'}</li>
            </ul>
            <h3>Erros críticos</h3>
            <ul>${erros||'<li>Nenhum</li>'}</ul>
            <h3>BANT</h3>
            <ul>${bantStatus}</ul>
            <h3>Próxima ação</h3>
            <p>${parsed.proxima_melhor_acao||'—'}</p>
            <h3>Diagnóstico estrutural</h3>
            <p>${parsed.diagnostico_estrutural||'—'}</p>
            <hr>
            <p style="color:#888;font-size:12px">Call Diagnosis™ · ScaleCo · ${new Date().toLocaleString('pt-BR')}</p>
          `
        })
      });
    } catch (emailErr) {
      console.error('Resend error:', emailErr.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro na análise: ' + e.message }) };
  }
};
