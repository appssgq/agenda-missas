import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";

const SUPABASE_URL = required("SUPABASE_URL").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = required("SUPABASE_SERVICE_KEY");
const EVOLUTION_URL = required("EVOLUTION_URL").replace(/\/+$/, "");
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

function formatarDataBR(data) {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

function agoraLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const p = Object.fromEntries(
    parts.map(item => [item.type, item.value])
  );

  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}`
  };
}

function subtrairDias(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);

  const data = new Date(
    Date.UTC(ano, mes - 1, dia)
  );

  data.setUTCDate(
    data.getUTCDate() - Number(dias)
  );

  return data.toISOString().slice(0, 10);
}

function subtrairMinutosLocal(dataISO, hora, minutos) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);

  const [h, m] = String(hora)
    .slice(0, 5)
    .split(":")
    .map(Number);

  const data = new Date(
    Date.UTC(
      ano,
      mes - 1,
      dia,
      h,
      m
    )
  );

  data.setUTCMinutes(
    data.getUTCMinutes() - minutos
  );

  return {
    data: data.toISOString().slice(0, 10),
    hora: data.toISOString().slice(11, 16)
  };
}

async function buscarMissasAtivas() {
  const hoje = agoraLocal().data;

  const url =
    `${SUPABASE_URL}/rest/v1/missas` +
    `?select=*` +
    `&ativo=eq.true` +
    `&data_missa=gte.${hoje}` +
    `&order=data_missa.asc,horario.asc`;

  const resposta = await fetch(url, {
    headers: sbHeaders
  });

  if (!resposta.ok) {
    throw new Error(
      await resposta.text()
    );
  }

  return resposta.json();
}

function chaveAviso(aviso) {
  const quantidade = Number(
    aviso.quantidade
  );

  const unidade =
    aviso.unidade || "dias";

  const horario =
    aviso.horario || "";

  return `${unidade}:${quantidade}:${horario}`;
}

async function lembreteJaEnviado(
  missaId,
  aviso
) {
  const chave = chaveAviso(aviso);

  const url =
    `${SUPABASE_URL}/rest/v1/lembretes_missas` +
    `?select=id` +
    `&missa_id=eq.${encodeURIComponent(missaId)}` +
    `&chave_aviso=eq.${encodeURIComponent(chave)}` +
    `&enviado=eq.true` +
    `&limit=1`;

  const resposta = await fetch(url, {
    headers: sbHeaders
  });

  if (!resposta.ok) {
    throw new Error(
      await resposta.text()
    );
  }

  const dados = await resposta.json();

  return dados.length > 0;
}

async function registrarLembrete(
  missaId,
  aviso
) {
  const agora = agoraLocal();

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

        dias_antes:
          aviso.unidade === "dias"
            ? Number(aviso.quantidade)
            : 0,

        data_envio: agora.data,

        horario_envio:
          `${agora.hora}:00`,

        enviado: true,

        enviado_em:
          new Date().toISOString(),

        chave_aviso:
          chaveAviso(aviso)
      })
    }
  );

  if (!resposta.ok) {
    throw new Error(
      await resposta.text()
    );
  }
}

function descricaoAviso(aviso) {
  const quantidade =
    Number(aviso.quantidade);

  if (aviso.unidade === "dias") {
    return quantidade === 1
      ? "Falta 1 dia"
      : `Faltam ${quantidade} dias`;
  }

  if (aviso.unidade === "horas") {
    return quantidade === 1
      ? "Falta 1 hora"
      : `Faltam ${quantidade} horas`;
  }

  return quantidade === 1
    ? "Falta 1 minuto"
    : `Faltam ${quantidade} minutos`;
}

async function enviarWhatsApp(
  missa,
  aviso
) {
  const horario = String(
    missa.horario || ""
  ).slice(0, 5);

  let texto =
`⛪ Lembrete de Missa

📅 ${descricaoAviso(aviso)} para a missa.
🗓️ Data: ${formatarDataBR(missa.data_missa)}
⏰ Horário: ${horario}
📍 Local: ${missa.local}`;

  if (missa.observacao) {
    texto +=
      `\n📝 ${missa.observacao}`;
  }

  texto +=
    `\n🙏 Contamos com a presença de todos!`;

  const resposta = await fetch(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        apikey:
          EVOLUTION_API_KEY
      },

      body: JSON.stringify({
        number: GROUP_JID,
        text: texto
      })
    }
  );

  if (!resposta.ok) {
    throw new Error(
      await resposta.text()
    );
  }
}

function momentoDoAviso(
  missa,
  aviso
) {
  const quantidade =
    Number(aviso.quantidade);

  if (!quantidade || quantidade < 1) {
    return null;
  }

  if (aviso.unidade === "dias") {

    if (!aviso.horario) {
      return null;
    }

    return {
      data: subtrairDias(
        missa.data_missa,
        quantidade
      ),

      hora:
        aviso.horario.slice(0, 5)
    };
  }

  const minutos =
    aviso.unidade === "horas"
      ? quantidade * 60
      : quantidade;

  return subtrairMinutosLocal(
    missa.data_missa,
    missa.horario,
    minutos
  );
}

async function executarLembretes() {

  try {

    const agora =
      agoraLocal();

    console.log(
      `Verificando avisos: ${agora.data} ${agora.hora}`
    );

    const missas =
      await buscarMissasAtivas();

    for (const missa of missas) {

      const avisos =
        Array.isArray(missa.avisos)
          ? missa.avisos
          : [];

      for (const aviso of avisos) {

        const momento =
          momentoDoAviso(
            missa,
            aviso
          );

        if (!momento) {
          continue;
        }

        /*
          Só envia exatamente no
          minuto programado.

          Assim um aviso antigo
          não será enviado atrasado.
        */

        if (
          momento.data !== agora.data ||
          momento.hora !== agora.hora
        ) {
          continue;
        }

        const enviado =
          await lembreteJaEnviado(
            missa.id,
            aviso
          );

        if (enviado) {
          continue;
        }

        await enviarWhatsApp(
          missa,
          aviso
        );

        await registrarLembrete(
          missa.id,
          aviso
        );

        console.log(
          `Lembrete enviado: missa ${missa.id} - ${chaveAviso(aviso)}`
        );
      }
    }

  } catch (erro) {

    console.error(
      "Erro no agendador:",
      erro.message
    );
  }
}

/*
  Verifica os avisos
  a cada minuto.
*/

cron.schedule(
  "* * * * *",
  executarLembretes,
  {
    timezone: TIMEZONE
  }
);

/* =========================
   SERVIDOR DO APP
========================= */

const app = express();

app.use(express.json());

app.get(
  "/api/missas",
  async (req, res) => {

    try {

      const hoje =
        agoraLocal().data;

      const resposta =
        await fetch(
          `${SUPABASE_URL}/rest/v1/missas?select=*&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`,
          {
            headers: sbHeaders
          }
        );

      const dados =
        await resposta.json();

      if (!resposta.ok) {

        return res
          .status(resposta.status)
          .json({
            erro:
              dados.message ||
              "Erro ao buscar missas."
          });
      }

      res.json(dados);

    } catch (erro) {

      res.status(500).json({
        erro: erro.message
      });
    }
  }
);

app.post(
  "/api/missas",
  async (req, res) => {

    try {

      const {
        data_missa,
        horario,
        local,
        observacao,
        avisos
      } = req.body || {};

      if (
        !data_missa ||
        !horario ||
        !local
      ) {

        return res
          .status(400)
          .json({
            erro:
              "Data, horário e local são obrigatórios."
          });
      }

      const resposta =
        await fetch(
          `${SUPABASE_URL}/rest/v1/missas`,
          {
            method: "POST",

            headers: {
              ...sbHeaders,
              Prefer:
                "return=representation"
            },

            body: JSON.stringify({
              data_missa,
              horario,
              local,

              observacao:
                observacao || null,

              avisos:
                Array.isArray(avisos)
                  ? avisos
                  : [],

              ativo: true
            })
          }
        );

      const dados =
        await resposta.json();

      if (!resposta.ok) {

        return res
          .status(resposta.status)
          .json({
            erro:
              dados.message ||
              "Erro ao cadastrar missa."
          });
      }

      res.status(201).json(dados);

    } catch (erro) {

      res.status(500).json({
        erro: erro.message
      });
    }
  }
);

/* =========================
   HTML
========================= */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Agenda de Missas ativa. Verificação de avisos a cada minuto (${TIMEZONE}).`
    );

    console.log(
      `Tela disponível na porta ${PORT}.`
    );
  }
);
