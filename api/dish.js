// 급식 메뉴 이름을 식약처 식품영양성분DB의 '음식' 데이터와 연결해 1인분 영양성분을 추정하는 서버 함수예요.
// 인증키는 FOODSAFETY_KEY(공공데이터포털 키)를 그대로 써요.

const ENDPOINT = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03";
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(n) ? null : n; };

async function search(key, q) {
  const params = new URLSearchParams({ serviceKey: key, type: "json", pageNo: "1", numOfRows: "100", FOOD_NM_KR: q });
  const r = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(15000) });
  const data = JSON.parse(await r.text());
  const header = data?.header || data?.response?.header || {};
  if (header.resultCode === "03") return [];
  if (header.resultCode && header.resultCode !== "00") throw new Error(`${header.resultMsg} (코드 ${header.resultCode})`);
  const body = data?.body || data?.response?.body || {};
  let items = body.items;
  if (items && !Array.isArray(items)) items = items.item;
  if (items && !Array.isArray(items)) items = [items];
  return items || [];
}

function score(row, full, s) {
  const name = String(row.FOOD_NM_KR || "").replace(/\s/g, "");
  const [base, ...variants] = name.split("_");
  if (!base || !full.includes(base)) return -1;
  let sc = base.length * 10;
  for (const v of variants) sc += full.includes(v) ? v.length * 3 : -2;
  if (name === s || name === full) sc += 5;
  return sc;
}

function shape(row, group) {
  const serving = group === "음식" ? num(row.Z10500) : null;
  return {
    name: row.FOOD_NM_KR, group, category: row.FOOD_CAT1_NM || "",
    servingG: serving && serving > 0 && serving < 2000 ? serving : 100,
    servingKnown: !!(serving && serving > 0 && serving < 2000),
    per100: {
      kcal: num(row.AMT_NUM1), prot: num(row.AMT_NUM3), fat: num(row.AMT_NUM4), carb: num(row.AMT_NUM6),
      sugar: num(row.AMT_NUM7), na: num(row.AMT_NUM13), sat: num(row.AMT_NUM24),
    },
  };
}

module.exports = async (req, res) => {
  const key = process.env.FOODSAFETY_KEY;
  if (!key) return res.status(500).json({ error: "서버에 FOODSAFETY_KEY가 설정되지 않았어요." });
  const full = String(req.query.name || "").replace(/\s/g, "").slice(0, 30);
  if (full.length < 1) return res.status(400).json({ error: "메뉴 이름이 비어 있어요." });

  try {
    let fallback = null;
    for (let i = 0, tries = 0; i <= full.length - 2 && tries < 8; i++, tries++) {
      const s = full.slice(i);
      const rows = await search(key, s);
      if (!rows.length) continue;
      const dishes = rows.filter((r) => r.DB_GRP_NM === "음식")
        .map((r) => ({ r, sc: score(r, full, s) })).filter((x) => x.sc >= 0)
        .sort((a, b) => b.sc - a.sc || String(a.r.FOOD_NM_KR).length - String(b.r.FOOD_NM_KR).length);
      if (dishes.length) {
        res.setHeader("Cache-Control", "s-maxage=2592000");
        return res.status(200).json({ query: full, searched: s, match: shape(dishes[0].r, "음식") });
      }
      if (!fallback) {
        const p = rows.filter((r) => String(r.FOOD_NM_KR || "").replace(/\s/g, "").includes(s))
          .sort((a, b) => String(a.FOOD_NM_KR).length - String(b.FOOD_NM_KR).length)[0];
        if (p) fallback = { s, row: p };
      }
    }
    res.setHeader("Cache-Control", "s-maxage=2592000");
    if (fallback) return res.status(200).json({ query: full, searched: fallback.s, match: shape(fallback.row, fallback.row.DB_GRP_NM || "가공식품") });
    return res.status(200).json({ query: full, match: null });
  } catch (e) {
    return res.status(502).json({ error: e && e.message ? e.message : "식품영양성분 DB에 연결하지 못했어요." });
  }
};
