// Resumo do canal: inscritos, visualizações totais e quantidade de vídeos.
// Com YOUTUBE_API_KEY (variável de ambiente no Netlify): usa a API oficial (recomendado).
// Sem chave: tenta ler os números da página "Sobre" do canal (pode falhar se o YouTube mudar o layout).
const CHANNEL_ID = "UCdz_Kbzu83ZE86LVcGFN0JA";
const UA = { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR,pt;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI" };
const nf = n => Number(n).toLocaleString("pt-BR");
const send = (code, body, cache = "no-store") => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": cache },
  body: JSON.stringify(body)
});

async function viaApi(key) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${key}`);
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  const s = j.items && j.items[0] && j.items[0].statistics;
  if (!s) throw new Error("canal não encontrado");
  return {
    inscritos: s.hiddenSubscriberCount ? null : nf(s.subscriberCount),
    visualizacoes: nf(s.viewCount),
    videos: nf(s.videoCount)
  };
}

async function viaPagina() {
  const r = await fetch(`https://www.youtube.com/channel/${CHANNEL_ID}/about`, { headers: UA });
  if (!r.ok) throw new Error("pagina " + r.status);
  const html = await r.text();
  const pick = re => { const m = html.match(re); return m ? m[1] : null; };
  const num = t => (t ? t.replace(/\s*(inscritos?|visualizações|visualização|vídeos?|views|subscribers?|videos?)\s*$/i, "").trim() : null);
  const out = {
    inscritos: num(pick(/"subscriberCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/)),
    visualizacoes: num(pick(/"viewCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/)),
    videos: num(pick(/"videoCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/))
  };
  if (!out.inscritos && !out.visualizacoes && !out.videos) throw new Error("não foi possível ler a página");
  return out;
}

exports.handler = async () => {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    const dados = key ? await viaApi(key) : await viaPagina();
    return send(200, dados, "public, max-age=600");
  } catch (err) {
    return send(502, { error: String(err) });
  }
};
