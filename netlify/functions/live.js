// Lista as lives que estão NO AR agora no canal.
// Sem chave: confere os vídeos recentes do feed RSS e vê se a página marca "isLiveNow".
// Com YOUTUBE_API_KEY (variável de ambiente no Netlify): usa a API oficial (mais confiável).
const CHANNEL_ID = "UCdz_Kbzu83ZE86LVcGFN0JA";
const UA = { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR,pt;q=0.9" };
const dec = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

exports.handler = async () => {
  try {
    const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!feed.ok) throw new Error("feed " + feed.status);
    const xml = await feed.text();
    const ids = [...xml.matchAll(/<yt:videoId>(.*?)<\/yt:videoId>/g)].map(m => m[1]).slice(0, 15);
    let lives = [];

    const key = process.env.YOUTUBE_API_KEY;
    if (key && ids.length) {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}&key=${key}`);
      if (!r.ok) throw new Error("api " + r.status);
      const j = await r.json();
      lives = (j.items || []).filter(v => v.snippet.liveBroadcastContent === "live")
        .map(v => ({ id: v.id, title: v.snippet.title }));
    } else {
      const checks = await Promise.all(ids.map(async id => {
        try {
          const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: UA });
          const html = await r.text();
          if (!/"isLiveNow":true/.test(html)) return null;
          const t = (html.match(/<meta name="title" content="(.*?)">/) || [])[1] || "Live";
          return { id, title: dec(t) };
        } catch { return null; }
      }));
      lives = checks.filter(Boolean);
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
      body: JSON.stringify(lives)
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err) }) };
  }
};
