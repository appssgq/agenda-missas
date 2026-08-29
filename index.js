import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";

const SUPABASE_URL = required("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = required("SUPABASE_SERVICE_KEY");
const EVOLUTION_URL = required("EVOLUTION_URL").replace(/\/$/, "");
const EVOLUTION_API_KEY = required("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE = required("EVOLUTION_INSTANCE");
const GROUP_JID = required("GROUP_JID");
const TIMEZONE = process.env.TIMEZONE || "America/Sao_Paulo";
const PORT = process.env.PORT || 3000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

const sbHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json"
};

function diasEntre(hoje, dataMissa) {
  const a = new Date(`${hoje}T00:00:00`);
  const b = new Date(`${dataMissa}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function formatarDataBR(data) {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

async function buscarMissasAtivas() {
  const hoje = new Date().toLocaleDateString("sv-SE", {
    timeZone: TIMEZONE
  });

  const url =
    `${SUPABASE_URL}/rest/v1/missas` +
    `?select=*` +
    `&ativo=eq.true` +
    `&data_missa=gte.${hoje}` +
    `&order=data_missa.asc,horario.asc`;

  const resposta = await fetch(url, { headers: sbHeaders });

  if (!resposta.ok) {
    throw new Error(await resposta.text());
  }

  return resposta.json();
}

async function lembreteJaEnviado(missaId, diasAntes) {
  const url =
    `${SUPABASE_URL}/rest/v1/lembretes_missas` +
    `?select=id` +
    `&missa_id=eq.${missaId}` +
    `&dias_antes=eq.${diasAntes}` +
    `&limit=1`;

  const resposta = await fetch(url, { headers: sbHeaders });

  if (!resposta.ok) {
    throw new Error(await resposta.text());
  }

  const dados = await resposta.json();
  return dados.length > 0;
}

async function registrarLembrete(missaId, diasAntes) {
  const resposta = await fetch(
    `${SUPABASE_URL}/rest/v1/lembretes_missas`,
    {
      method: "POST",
      headers: {
        ...sbHeaders,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        missa_id: missaId,
        dias_antes: diasAntes
      })
    }
  );

  if (!resposta.ok) {
    throw new Error(await resposta.text());
  }
}

async function enviarWhatsApp(missa, diasAntes) {
  const horario = String(missa.horario || "").slice(0, 5);

  const texto =
`⛪ Lembrete de Missa

📅 Faltam ${diasAntes} dias para a missa.
🗓️ Data: ${formatarDataBR(missa.data_missa)}
⏰ Horário: ${horario}
📍 Local: ${missa.local}
🙏 Contamos com a presença de todos!`;

  const resposta = await fetch(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: GROUP_JID,
        text: texto
      })
    }
  );

  if (!resposta.ok) {
    throw new Error(await resposta.text());
  }
}

async function executarLembretes() {
  try {
    const hoje = new Date().toLocaleDateString("sv-SE", {
      timeZone: TIMEZONE
    });

    const missas = await buscarMissasAtivas();

    for (const missa of missas) {
      const diasAntes = diasEntre(hoje, missa.data_missa);

      if (![5, 3, 1].includes(diasAntes)) {
        continue;
      }

      const enviado = await lembreteJaEnviado(
        missa.id,
        diasAntes
      );

      if (enviado) {
        continue;
      }

      await enviarWhatsApp(missa, diasAntes);
      await registrarLembrete(missa.id, diasAntes);

      console.log(
        `Lembrete enviado: missa ${missa.id}, ${diasAntes} dia(s) antes`
      );
    }
  } catch (erro) {
    console.error("Erro no agendador:", erro.message);
  }
}

cron.schedule(
  "0 9 * * *",
  executarLembretes,
  {
    timezone: TIMEZONE
  }
);

const app = express();

app.use(express.json());

app.get("/api/missas", async (req, res) => {
  try {
    const hoje = new Date().toLocaleDateString("sv-SE", {
      timeZone: TIMEZONE
    });

    const resposta = await fetch(
      `${SUPABASE_URL}/rest/v1/missas?select=*&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`,
      {
        headers: sbHeaders
      }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      return res.status(resposta.status).json({
        erro: dados.message || "Erro ao buscar missas."
      });
    }

    res.json(dados);
  } catch (erro) {
    res.status(500).json({
      erro: erro.message
    });
  }
});

app.post("/api/missas", async (req, res) => {
  try {
    const {
      data_missa,
      horario,
      local,
      observacao
    } = req.body || {};

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
          ...sbHeaders,
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

    res.status(201).json(dados);
  } catch (erro) {
    res.status(500).json({
      erro: erro.message
    });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Agenda de Missas ativa. Disparo diário às 09:00 (${TIMEZONE}).`
  );
  console.log(`Tela disponível na porta ${PORT}.`);
});
