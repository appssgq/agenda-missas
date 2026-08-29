import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";

const req=n=>{const v=process.env[n];if(!v)throw new Error(`Variável ausente: ${n}`);return v};
const SUPABASE_URL=req("SUPABASE_URL").replace(/\/+$/,"");
const SUPABASE_SERVICE_KEY=req("SUPABASE_SERVICE_KEY");
const EVOLUTION_URL=req("EVOLUTION_URL").replace(/\/+$/,"");
const EVOLUTION_API_KEY=req("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE=req("EVOLUTION_INSTANCE");
const GROUP_JID=req("GROUP_JID");
const TIMEZONE=process.env.TIMEZONE||"America/Sao_Paulo";
const PORT=process.env.PORT||3000;

const sbHeaders={
  apikey:SUPABASE_SERVICE_KEY,
  Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type":"application/json"
};

function agora(){
  const p=Object.fromEntries(
    new Intl.DateTimeFormat("en-CA",{
      timeZone:TIMEZONE,
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23"
    }).formatToParts(new Date()).map(x=>[x.type,x.value])
  );
  return {data:`${p.year}-${p.month}-${p.day}`,hora:`${p.hour}:${p.minute}`};
}

function dataBR(d){
  const [a,m,dia]=d.split("-");
  return `${dia}/${m}`;
}

function menosDias(data,dias){
  const [a,m,d]=data.split("-").map(Number);
  const x=new Date(Date.UTC(a,m-1,d));
  x.setUTCDate(x.getUTCDate()-Number(dias));
  return x.toISOString().slice(0,10);
}

function menosMinutos(data,hora,minutos){
  const [a,m,d]=data.split("-").map(Number);
  const [h,min]=String(hora).slice(0,5).split(":").map(Number);
  const x=new Date(Date.UTC(a,m-1,d,h,min));
  x.setUTCMinutes(x.getUTCMinutes()-minutos);
  return {data:x.toISOString().slice(0,10),hora:x.toISOString().slice(11,16)};
}

async function missasAtivas(){
  const hoje=agora().data;
  const url=`${SUPABASE_URL}/rest/v1/missas?select=*&ativo=eq.true&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`;
  const r=await fetch(url,{headers:sbHeaders});
  if(!r.ok)throw new Error(await r.text());
  return r.json();
}

function chave(a){
  return `${a.unidade||"dias"}:${Number(a.quantidade)}:${a.horario||""}`;
}

async function jaEnviado(missaId,aviso){
  const url=
    `${SUPABASE_URL}/rest/v1/lembretes_missas`+
    `?select=id&missa_id=eq.${encodeURIComponent(missaId)}`+
    `&chave_aviso=eq.${encodeURIComponent(chave(aviso))}`+
    `&enviado=eq.true&limit=1`;

  const r=await fetch(url,{headers:sbHeaders});
  if(!r.ok)throw new Error(await r.text());
  return (await r.json()).length>0;
}

async function registrar(missaId,aviso){
  const a=agora();

  const r=await fetch(`${SUPABASE_URL}/rest/v1/lembretes_missas`,{
    method:"POST",
    headers:{...sbHeaders,Prefer:"return=minimal"},
    body:JSON.stringify({
      missa_id:missaId,
      dias_antes:aviso.unidade==="dias"?Number(aviso.quantidade):0,
      data_envio:a.data,
      horario_envio:`${a.hora}:00`,
      enviado:true,
      enviado_em:new Date().toISOString(),
      chave_aviso:chave(aviso)
    })
  });

  if(!r.ok)throw new Error(await r.text());
}

function descricao(a){
  const q=Number(a.quantidade);

  if(a.unidade==="dias")
    return q===1?"Falta 1 dia":`Faltam ${q} dias`;

  if(a.unidade==="horas")
    return q===1?"Falta 1 hora":`Faltam ${q} horas`;

  return q===1?"Falta 1 minuto":`Faltam ${q} minutos`;
}

async function enviar(missa,aviso){
  let texto=
`⛪ Lembrete de Missa

📅 ${descricao(aviso)} para a missa.
🗓️ Data: ${dataBR(missa.data_missa)}
⏰ Horário: ${String(missa.horario).slice(0,5)}
📍 Local: ${missa.local}`;

  if(missa.observacao)texto+=`\n📝 ${missa.observacao}`;

  texto+=`\n🙏 Contamos com a presença de todos!`;

  const r=await fetch(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        apikey:EVOLUTION_API_KEY
      },
      body:JSON.stringify({
        number:GROUP_JID,
        text:texto
      })
    }
  );

  if(!r.ok)throw new Error(await r.text());
}

function momento(missa,aviso){
  const q=Number(aviso.quantidade);
  if(!q||q<1)return null;

  if(aviso.unidade==="dias"){
    if(!aviso.horario)return null;

    return {
      data:menosDias(missa.data_missa,q),
      hora:String(aviso.horario).slice(0,5)
    };
  }

  const min=aviso.unidade==="horas"?q*60:q;
  return menosMinutos(missa.data_missa,missa.horario,min);
}

async function executar(){
  try{
    const a=agora();
    console.log(`Verificando avisos ${a.data} ${a.hora}`);

    const missas=await missasAtivas();

    for(const missa of missas){
      const avisos=Array.isArray(missa.avisos)?missa.avisos:[];

      for(const aviso of avisos){
        const m=momento(missa,aviso);

        if(!m)continue;
        if(m.data!==a.data||m.hora!==a.hora)continue;
        if(await jaEnviado(missa.id,aviso))continue;

        await enviar(missa,aviso);
        await registrar(missa.id,aviso);

        console.log(`Enviado: ${missa.id} ${chave(aviso)}`);
      }
    }
  }catch(e){
    console.error("Erro no agendador:",e.message);
  }
}

cron.schedule("* * * * *",executar,{timezone:TIMEZONE});

const app=express();
app.use(express.json());

app.get("/api/missas",async(req,res)=>{
  try{
    const hoje=agora().data;
    const r=await fetch(
      `${SUPABASE_URL}/rest/v1/missas?select=*&data_missa=gte.${hoje}&order=data_missa.asc,horario.asc`,
      {headers:sbHeaders}
    );

    const dados=await r.json();

    if(!r.ok)
      return res.status(r.status).json({erro:dados.message||"Erro ao buscar missas."});

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

    const r=await fetch(`${SUPABASE_URL}/rest/v1/missas`,{
      method:"POST",
      headers:{...sbHeaders,Prefer:"return=representation"},
      body:JSON.stringify({
        data_missa,
        horario,
        local,
        observacao:observacao||null,
        avisos:Array.isArray(avisos)?avisos:[],
        ativo:true
      })
    });

    const dados=await r.json();

    if(!r.ok)
      return res.status(r.status).json({erro:dados.message||"Erro ao cadastrar missa."});

    res.status(201).json(dados);
  }catch(e){
    res.status(500).json({erro:e.message});
  }
});

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

app.use(express.static(path.join(__dirname,"public")));

app.listen(PORT,"0.0.0.0",()=>{
  console.log(`Agenda de Missas ativa. Avisos verificados a cada minuto (${TIMEZONE}).`);
  console.log(`Tela disponível na porta ${PORT}.`);
});
