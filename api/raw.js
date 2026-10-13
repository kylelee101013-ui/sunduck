// 식품안전나라 '식품(첨가물)품목제조보고(원재료)' (C002)를 대신 호출해 주는 서버 함수예요.
// 인증키는 Vercel 환경변수(RAW_MATERIAL_KEY)에만 있고, 브라우저로는 절대 보내지 않아요.

const FILTERS = ["PRDLST_REPORT_NO", "PRDLST_NM", "PRDLST_DCNM", "BSSH_NM"];

module.exports = async (req, res) => {
  const key = process.env.RAW_MATERIAL_KEY;
  if (!key) {
    return res.status(500).json({ error: "서버에 원재료용 인증키가 설정되지 않았어요. Vercel의 Environment Variables에 RAW_MATERIAL_KEY(식품안전나라 키)를 넣고 다시 배포해 주세요." });
  }

  const start = Math.max(1, parseInt(req.query.start || "1", 10) || 1);
  const end = Math.min(start + 999, Math.max(start, parseInt(req.query.end || "50", 10) || 50));
  const cond = FILTERS
    .filter((f) => req.query[f])
    .map((f) => `${f}=${encodeURIComponent(String(req.query[f]).trim().slice(0, 100))}`)
    .join("&");
  const path = `/api/${key}/C002/json/${start}/${end}` + (cond ? `/${cond}` : "");
  const hide = (t) => String(t).split(key).join("<인증키>");

  let text = "", status = 0, lastErr = "";
  for (const base of ["http://openapi.foodsafetykorea.go.kr", "https://openapi.foodsafetykorea.go.kr"]) {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(25000) });
      status = r.status;
      text = await r.text();
      break;
    } catch (e) {
      lastErr = e && e.name ? e.name : "연결 실패";
    }
  }
  if (!text) return res.status(502).json({ error: `식품안전나라 서버에 연결하지 못했어요. (${lastErr})` });

  let data;
  try { data = JSON.parse(text); }
  catch {
    return res.status(502).json({
      error: `식품안전나라가 JSON이 아닌 응답을 보냈어요 (상태 ${status}).`,
      preview: hide(text.replace(/\s+/g, " ").slice(0, 300)),
    });
  }

  const body = data.C002 || data;
  const code = body?.RESULT?.CODE || "";
  const msg = body?.RESULT?.MSG || "";
  if (code === "INFO-200") return res.status(200).json({ total: 0, rows: [] }); // 결과 없음
  if (code && code !== "INFO-000") return res.status(502).json({ error: `${msg} (코드 ${code})` });

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
  return res.status(200).json({ total: parseInt(body.total_count || "0", 10), rows: body.row || [] });
};
