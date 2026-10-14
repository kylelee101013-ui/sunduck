// 나이스(NEIS) 교육정보 개방 포털의 학교 정보와 급식식단정보를 대신 호출해 주는 서버 함수예요.
// 인증키는 Vercel 환경변수(NEIS_KEY)에만 있고, 브라우저로는 절대 보내지 않아요.

const BASE = "https://open.neis.go.kr/hub/";

async function neis(service, params) {
  const qs = new URLSearchParams({ Type: "json", pIndex: "1", pSize: "1000", ...params });
  const r = await fetch(`${BASE}${service}?${qs}`, { signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`나이스 서버가 JSON이 아닌 응답을 보냈어요 (상태 ${r.status}).`); }

  if (data.RESULT) {
    if (data.RESULT.CODE === "INFO-200") return [];
    throw new Error(`${data.RESULT.MESSAGE || "요청 오류"} (코드 ${data.RESULT.CODE})`);
  }
  const block = data[service] || [];
  const head = (block[0] && block[0].head) || [];
  const result = head.find((h) => h.RESULT);
  if (result && result.RESULT.CODE !== "INFO-000") throw new Error(`${result.RESULT.MESSAGE} (코드 ${result.RESULT.CODE})`);
  return (block[1] && block[1].row) || [];
}

module.exports = async (req, res) => {
  const key = process.env.NEIS_KEY;
  if (!key) {
    return res.status(500).json({ error: "서버에 급식용 인증키가 설정되지 않았어요. Vercel의 Environment Variables에 NEIS_KEY(나이스 인증키)를 넣고 다시 배포해 주세요." });
  }
  const op = String(req.query.op || "meals");

  try {
    if (op === "school") {
      const name = String(req.query.name || "").trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: "학교 이름을 입력해 주세요." });
      const rows = await neis("schoolInfo", { KEY: key, SCHUL_NM: name, pSize: "30" });
      res.setHeader("Cache-Control", "s-maxage=604800");
      return res.status(200).json({
        rows: rows.map((r) => ({
          office: r.ATPT_OFCDC_SC_CODE, officeName: r.ATPT_OFCDC_SC_NM,
          code: r.SD_SCHUL_CODE, name: r.SCHUL_NM, kind: r.SCHUL_KND_SC_NM, addr: r.ORG_RDNMA,
        })),
      });
    }

    const office = String(req.query.office || "B10");
    const school = String(req.query.school || "7010189");
    const from = String(req.query.from || "");
    const to = String(req.query.to || from);
    if (!/^[A-Z]\d{2}$/.test(office) || !/^\d{7}$/.test(school)) return res.status(400).json({ error: "학교 코드가 올바르지 않아요." });
    if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return res.status(400).json({ error: "날짜는 20261001 같은 형식이어야 해요." });

    const rows = await neis("mealServiceDietInfo", {
      KEY: key, ATPT_OFCDC_SC_CODE: office, SD_SCHUL_CODE: school, MLSV_FROM_YMD: from, MLSV_TO_YMD: to,
    });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      rows: rows.map((r) => ({
        date: r.MLSV_YMD, type: r.MMEAL_SC_NM, typeCode: r.MMEAL_SC_CODE, school: r.SCHUL_NM,
        dishes: r.DDISH_NM || "", cal: r.CAL_INFO || "", ntr: r.NTR_INFO || "", origin: r.ORPLC_INFO || "", count: r.MLSV_FGR || "",
      })),
    });
  } catch (e) {
    return res.status(502).json({ error: e && e.message ? e.message : "나이스 서버에 연결하지 못했어요." });
  }
};
