import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";

const getEnv=n=>{const v=process.env[n];if(!v)throw new Error(`Variável ausente: ${n}`);return v};

const SUPABASE_URL=getEnv("SUPABASE_URL").replace(/\/+$/,"");
const SUPABASE_SERVICE_KEY=getEnv("SUPABASE_SERVICE_KEY");
const EVOLUTION_URL=getEnv("EVOLUTION_URL").replace(/\/+$/,"");
const EVOLUTION_API_KEY=getEnv("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE=getEnv("EVOLUTION_INSTANCE");
const GROUP_JID=getEnv("GROUP_JID");
const TIMEZONE=process.env.TIMEZONE||"America/Sao_Paulo";
const PORT=process.env.PORT||3000;

const headers={
  apikey:SUPABASE_SERVICE_KEY,
  Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type":"application/json"
};

function agora(){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
    timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return {data:`${p.year}-${p.month}-${p.day}`,hora:`${p.hour}:${p.minute}`};
}

function menosDias(data,q){
  const [y,m,d]=data.split("-").map(Number);
  const x=new Date(Date.UTC(y,m-1,d));
  x.setUTCDate(x.getUTCDate()-q);
  return x.toISOString().slice(0,10);
}

function menosMin(data,hora,min){
  const [y,m,d]=data.split("-").map(Number);
  const [h,mm]=String(hora).slice(0,5).split(":").map(Number);
  const x=new Date(Date.UTC(y,m-1,d,h,mm));
  x.setUTCMinutes(x.getUTCMinutes()-min);
  return {data:x.toISOString().slice(0,10),hora:x.toISOString().slice(11,16)};
}

async function sb(url,opt={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${url}`,{
    ...opt,
    headers:{...headers,...(opt.headers||{})}
  });
  if(!r.ok)throw new Error(await r.text());
  const t=await r.text();
  return t?JSON.parse(t):null;
}

function chave(a){
  return `${a.unidade}:${Number(a.quantidade)}:${a.horario||""}`;
}

function momento(missa,a){
  const q=Number(a.quantidade);
  if(!q)return null;

  if(a.unidade==="dias"){
    if(!a.horario)return null;
    return {data:menosDias(missa.data_missa,q),hora:a.horario.slice(0,5)};
  }

  return menosMin(
    missa.data_missa,
    missa.horario,
    a.unidade==="horas"?q*60:q
  );
}

function descricao(a){
  const q=Number(a.quantidade);
  if(a.unidade==="dias")return q===1?"Falta 1 dia":`Faltam ${q} dias`;
  if(a.unidade==="horas")return q===1?"Falta 1 hora":`Faltam ${q} horas`;
  return q===1?"Falta 1 minuto":`Faltam ${q} minutos`;
}

async function jaEnviado(id,a){
  const x=await sb(
    `lembretes_missas?select=id&missa_id=eq.${encodeURIComponent(id)}`+
    `&chave_aviso=eq.${encodeURIComponent(chave(a))}&enviado=eq.true&limit=1`
  );
  return x.length>0;
}

async function registrar(id,a){
  const n=agora();
  await sb("lembretes_missas",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({
      missa_id:id,
      dias_antes:a.unidade==="dias"?Number(a.quantidade):0,
      data_envio:n.data,
      horario_envio:`${n.hora}:00`,
      enviado:true,
      enviado_em:new Date().toISOString(),
      chave_aviso:chave(a)
    })
  });
}

async function enviar(missa,a){
  const [y,m,d]=missa.data_missa.split("-");

  let text=
`⛪ Lembrete de Missa

📅 ${descricao(a)} para a missa.
🗓️ Data: ${d}/${m}
⏰ Horário: ${String(missa.horario).slice(0,5)}
📍 Local: ${missa.local}`;

  if(missa.observacao)text+=`\n📝 ${missa.observacao}`;

  text+=`\n\nConfirme sua presença aqui se estará conosco 👇🏽`;

  const r=await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      apikey:EVOLUTION_API_KEY
    },
    body:JSON.stringify({number:GROUP_JID,text})
  });

  if(!r.ok)throw new Error(await r.text());
}

async function executar(){
  try{
    const n=agora();

    const missas=await sb(
      `missas?select=*&ativo=eq.true&data_missa=gte.${n.data}&order=data_missa.asc,horario.asc`
    );

    for(const missa of missas){
      for(const aviso of Array.isArray(missa.avisos)?missa.avisos:[]){
        const m=momento(missa,aviso);
        if(!m||m.data!==n.data||m.hora!==n.hora)continue;
        if(await jaEnviado(missa.id,aviso))continue;

        await enviar(missa,aviso);
        await registrar(missa.id,aviso);
        console.log(`Enviado: ${missa.id} - ${chave(aviso)}`);
      }
    }
  }catch(e){
    console.error("Erro:",e.message);
  }
}

cron.schedule("* * * * *",executar,{timezone:TIMEZONE});

const app=express();
app.use(express.json());

app.get("/api/missas",async(req,res)=>{
  try{
    const n=agora();
    const dados=await sb(
      `missas?select=*&data_missa=gte.${n.data}&order=data_missa.asc,horario.asc`
    );
    res.json(dados);
  }catch(e){
    res.status(500).json({erro:e.message});
  }
});

app.post("/api/missas",async(req,res)=>{
  try{
    const {data_missa,horario,local,observacao,avisos}=req.body||{};

    if(!data_missa||!horario||!local)
      return res.status(400).json({erro:"Data, horário e local são obrigatórios."});

    const dados=await sb("missas",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({
        data_missa,
        horario,
        local,
        observacao:observacao||null,
        avisos:Array.isArray(avisos)?avisos:[],
        ativo:true
      })
    });

    res.status(201).json(dados);
  }catch(e){
    res.status(500).json({erro:e.message});
  }
});

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

app.use(express.static(path.join(__dirname,"public")));

app.listen(PORT,"0.0.0.0",()=>{
  console.log(`Agenda de Missas ativa na porta ${PORT}.`);
});
