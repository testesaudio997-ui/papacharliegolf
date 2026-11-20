// METAR do SBRF via API da REDEMET. A chave fica na variável de ambiente REDEMET_API_KEY (Netlify).
const BASE = "https://api-redemet.decea.mil.br/mensagens/metar/SBRF";
const fmt = d => d.toISOString().slice(0, 13).replace(/[-T]/g, ""); // AAAAMMDDHH (UTC)
const send = (code, body, cache = "no-store") => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": cache },
  body: JSON.stringify(body)
});

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("redemet " + r.status);
  const j = await r.json();
  const d = j && j.data && (Array.isArray(j.data) ? j.data : j.data.data);
  return Array.isArray(d) ? d : [];
}

function parse(raw) {
  const txt = raw.replace(/=/g, "").trim();
  const tk = txt.split(/\s+/);
  const out = { raw: txt, wind: { dir: null, spd: 0, gust: null, vrb: false } };
  const w = txt.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (w) out.wind = { dir: w[1] === "VRB" ? null : +w[1], spd: +w[2], gust: w[3] ? +w[3] : null, vrb: w[1] === "VRB" };
  const t = txt.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  const num = v => (v[0] === "M" ? -1 : 1) * parseInt(v.replace("M", ""), 10);
  if (t) { out.temp = num(t[1]); out.dew = num(t[2]); }
  const q = txt.match(/\bQ(\d{4})\b/); if (q) out.qnh = +q[1];

  const wx = tk.find(x => /^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|GR|BR|FG|FU|HZ|DU|SA|SQ|FC|SS|DS)+$/.test(x));
  const cov = ["FEW", "SCT", "BKN", "OVC"].filter(c => new RegExp("\\b" + c + "\\d{3}").test(txt));
  const top = cov[cov.length - 1];
  let clima = { OVC: "Encoberto", BKN: "Nublado", SCT: "Parcialmente nublado", FEW: "Poucas nuvens" }[top] || "Céu claro";
  if (wx) {
    const forca = wx[0] === "+" ? " forte" : wx[0] === "-" ? " fraca" : "";
    if (/TS/.test(wx)) clima = "Trovoada";
    else if (/DZ/.test(wx)) clima = "Garoa";
    else if (/RA/.test(wx)) clima = (/SH/.test(wx) ? "Pancadas de chuva" : "Chuva") + forca;
    else if (/FG/.test(wx)) clima = "Nevoeiro";
    else if (/BR/.test(wx)) clima = "Névoa úmida";
    else if (/HZ/.test(wx)) clima = "Névoa seca";
  }
  out.clima = clima;

  // Pista 18/36: escolhe a cabeceira com mais vento de proa. Vento fraco ou variável = indefinida.
  out.rwy = null;
  if (out.wind.dir != null && out.wind.spd >= 3) {
    const rad = x => (x * Math.PI) / 180, d = out.wind.dir, s = out.wind.spd;
    const h18 = s * Math.cos(rad(d - 180)), h36 = s * Math.cos(rad(d - 360));
    out.rwy = h36 > h18 ? "36" : "18";
    out.head = Math.round(Math.max(h18, h36));
    out.cross = Math.round(Math.abs(s * Math.sin(rad(d - (out.rwy === "18" ? 180 : 360)))));
  }
  return out;
}

exports.handler = async () => {
  const key = process.env.REDEMET_API_KEY;
  if (!key) return send(500, { error: "REDEMET_API_KEY não configurada" });
  try {
    const now = new Date(), ini = new Date(now - 4 * 3600e3);
    let list = await get(`${BASE}?api_key=${key}&data_ini=${fmt(ini)}&data_fim=${fmt(now)}`);
    if (!list.length) list = await get(`${BASE}?api_key=${key}`);
    if (!list.length) return send(404, { error: "sem METAR recente" });
    list.sort((a, b) => String(a.validade_inicial).localeCompare(String(b.validade_inicial)));
    const last = list[list.length - 1];
    const m = parse(last.mens || "");
    m.validade = last.validade_inicial;
    return send(200, m, "public, max-age=120");
  } catch (err) {
    return send(502, { error: String(err) });
  }
};
