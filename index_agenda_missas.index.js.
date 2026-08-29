import cron from "node-cron";

const SUPABASE_URL = required("SUPABASE_URL").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = required("SUPABASE_SERVICE_KEY");
const EVOLUTION_URL = required("EVOLUTION_URL").replace(/\/+$/, "");
const EVOLUTION_API_KEY = required("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "agenda-missas";
const GROUP_JID = required("GROUP_JID");
const TIMEZONE = process.env.TIMEZONE || "America/Sao_Paulo";

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

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function daysBetween(today, future) {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = future.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000
  );
}

function brDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function hhmm(value) {
  return String(value || "").slice(0, 5);
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supabaseInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...sbHeaders,
      Prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function reminderAlreadySent(missaId, diasAntes) {
  const rows = await supabaseGet(
    `lembretes_missas?select=id&missa_id=eq.${encodeURIComponent(missaId)}&dias_antes=eq.${diasAntes}&enviado=eq.true&limit=1`
  );
  return rows.length > 0;
}

async function sendWhatsApp(text) {
  const res = await fetch(
    `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
    {
      method: "POST",
      headers: {
        apikey: EVOLUTION_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        number: GROUP_JID,
        text
      })
    }
  );

  if (!res.ok) {
    throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
  }
}

function messageFor(missa, dias) {
  const quando = dias === 1 ? "Falta 1 dia" : `Faltam ${dias} dias`;

  let text =
`⛪ *Lembrete de Missa*

📅 ${quando} para a missa.
🗓️ Data: ${brDate(missa.data_missa)}
⏰ Horário: ${hhmm(missa.horario)}
📍 Local: ${missa.local}`;

  if (missa.observacao) {
    text += `\n📝 ${missa.observacao}`;
  }

  text += `\n🙏 Contamos com a presença de todos!`;
  return text;
}

async function runCheck() {
  const hoje = todayISO();
  console.log(`[${new Date().toISOString()}] Verificando agenda. Data local: ${hoje}`);

  const missas = await supabaseGet(
    `missas?select=id,data_missa,horario,local,observacao,ativo&ativo=eq.true&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`
  );

  const elegiveis = missas
    .map(m => ({ ...m, dias: daysBetween(hoje, m.data_missa) }))
    .filter(m => [5, 3, 1].includes(m.dias));

  if (!elegiveis.length) {
    console.log("Nenhum lembrete de 5, 3 ou 1 dia para enviar hoje.");
    return;
  }

  for (const missa of elegiveis) {
    try {
      if (await reminderAlreadySent(missa.id, missa.dias)) {
        console.log(`Ignorado: missa ${missa.id}, lembrete ${missa.dias} dia(s) já enviado.`);
        continue;
      }

      await sendWhatsApp(messageFor(missa, missa.dias));

      await supabaseInsert("lembretes_missas", {
        missa_id: missa.id,
        dias_antes: missa.dias,
        data_envio: hoje,
        horario_envio: "09:00:00",
        enviado: true,
        enviado_em: new Date().toISOString()
      });

      console.log(`Enviado com sucesso: missa ${missa.id}, ${missa.dias} dia(s) antes.`);
    } catch (err) {
      console.error(`Falha na missa ${missa.id}: ${err.message}`);
    }
  }
}

console.log(`Agenda de Missas ativa. Disparo diário às 09:00 (${TIMEZONE}).`);

cron.schedule(
  "0 9 * * *",
  () => runCheck().catch(err => console.error(`Erro geral: ${err.message}`)),
  { timezone: TIMEZONE }
);
