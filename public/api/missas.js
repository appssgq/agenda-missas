export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ erro: "Supabase não configurado." });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    if (req.method === "GET") {
      const hoje = new Date().toISOString().slice(0, 10);

      const resposta = await fetch(
        `${SUPABASE_URL}/rest/v1/missas?select=*&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`,
        { headers }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        return res.status(resposta.status).json({
          erro: dados.message || "Erro ao buscar missas."
        });
      }

      return res.status(200).json(dados);
    }

    if (req.method === "POST") {
      const { data_missa, horario, local, observacao } = req.body || {};

      if (!data_missa || !horario || !local) {
        return res.status(400).json({
          erro: "Data, horário e local são obrigatórios."
        });
      }

      const resposta = await fetch(
        `${SUPABASE_URL}/rest/v1/missas`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            data_missa,
            horario,
            local,
            observacao: observacao || null,
            ativo: true
          })
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        return res.status(resposta.status).json({
          erro: dados.message || "Erro ao cadastrar missa."
        });
      }

      return res.status(201).json(dados);
    }

    return res.status(405).json({
      erro: "Método não permitido."
    });

  } catch (erro) {
    return res.status(500).json({
      erro: erro.message || "Erro interno."
    });
  }
            }
