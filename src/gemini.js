// Gemini 공용 호출 (JSON 응답).
// - 429/503 시 서버가 알려주는 retryDelay 만큼 기다렸다 재시도.
// - 여러 모델을 순서대로 시도(한 모델이 쿼터/과부하로 계속 막히면 다음 모델로 폴백).
const modelList = (config) => (Array.isArray(config.geminiModels) && config.geminiModels.length ? config.geminiModels : [config.geminiModel]);

async function callOneModel(config, model, body, log) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const maxAttempts = 5;
  let res;
  let bodyText = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true, res };
    bodyText = await res.text().catch(() => "");
    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
      const hint = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) || bodyText.match(/retry in (\d+(?:\.\d+)?)s/i);
      let wait = hint ? Math.ceil(parseFloat(hint[1]) * 1000) + 1000 : 4000 * (attempt + 1);
      wait = Math.min(wait, 40000);
      log(`  [${model}] ${res.status} — ${Math.round(wait / 1000)}초 후 재시도 (${attempt + 1}/${maxAttempts - 1})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    break;
  }
  return { ok: false, status: res ? res.status : 0, bodyText };
}

export async function callGeminiJson(config, promptText, imageBase64, log = () => {}) {
  const parts = [{ text: promptText }];
  if (imageBase64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
  const body = { contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } };

  const models = modelList(config);
  let last = { status: 0, bodyText: "" };
  for (let m = 0; m < models.length; m++) {
    const r = await callOneModel(config, models[m], body, log);
    if (r.ok) {
      const data = await r.res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      if (!text) throw new Error("Gemini 빈 응답");
      return JSON.parse(text);
    }
    last = r;
    if (m < models.length - 1) log(`  [${models[m]}] ${r.status} 지속 → ${models[m + 1]} 로 폴백`);
  }
  throw new Error(`Gemini ${last.status}: ${(last.bodyText || "").slice(0, 200)}`);
}
