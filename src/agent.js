import { extractFields } from "./extract.js";
import { mapFields } from "./map.js";
import { fillOne } from "./execute.js";
import { fillAddress, uploadPhoto } from "./widgets.js";
import { loadRecipe, saveRecipe, fieldSig } from "./recipe.js";
import { diagnoseFieldsBatch } from "./diagnose.js";
import { probeFields } from "./probe.js";

const isOk = (s) => String(s).startsWith("ok");

export async function runAgent(page, profile, config, log = console.log) {
  const host = new URL(page.url()).hostname;
  const fields = await extractFields(page);
  const recipe = loadRecipe(host);
  log(`  필드 ${fields.length}개 · 레시피 ${Object.keys(recipe).length}개`);

  log("  위젯 탐색(probe)...");
  await probeFields(page, fields, log);

  log("  화면 캡처 + AI 매핑...");
  const screenshotBase64 = await page
    .screenshot({ fullPage: true, type: "jpeg", quality: 50 })
    .then((b) => b.toString("base64"))
    .catch(() => null);
  const plan = await mapFields({ fields, profile, screenshotBase64, config });
  const planById = new Map(plan.map((p) => [p.afId, p]));

  // 레시피 control override 적용
  for (const f of fields) {
    const rec = recipe[fieldSig(f)];
    if (rec && rec.control) f._override = rec.control;
  }

  log("  1차 채우기...");
  const results = [];
  for (const p of plan) {
    const f = fields.find((x) => x.afId === p.afId);
    if (!f) {
      results.push({ afId: p.afId, status: "필드없음" });
      continue;
    }
    if (p.skip || !p.value) {
      results.push({ afId: p.afId, label: f.label, status: "skip", note: p.note });
      continue;
    }
    try {
      results.push({ afId: p.afId, label: f.label, control: f.control, value: String(p.value), status: await fillOne(page, f, String(p.value), f._override) });
    } catch (e) {
      results.push({ afId: p.afId, label: f.label, control: f.control, value: String(p.value), status: "실패:" + (e.message || "").slice(0, 40) });
    }
  }

  // 주소 모달
  let addrStatus = "-";
  if (profile.address && fields.some((f) => /우편번호/.test(f.placeholder || "") || /현주소|주소/.test(f.label || ""))) {
    log("  주소 모달...");
    try {
      addrStatus = await fillAddress(page, profile);
    } catch (e) {
      addrStatus = "실패:" + (e.message || "").slice(0, 40);
    }
  }

  // 사진
  let photoStatus = "-";
  if (profile.photoPath) {
    try {
      photoStatus = (await uploadPhoto(page, profile.photoPath)) ? "ok" : "입력칸못찾음";
    } catch (e) {
      photoStatus = "실패";
    }
  }

  // 실패 진단 + 복구
  const failures = results.filter((r) => r.status && !isOk(r.status) && !String(r.status).startsWith("skip") && r.status !== "필드없음");
  const fixes = [];
  if (failures.length) log(`  실패 ${failures.length}개 진단/복구...`);

  // 전략 결정: 레시피가 있으면 재사용(무료), 없는 것만 모아 한 번에 AI 배치 진단.
  const stratById = new Map();
  const needDiag = [];
  for (const fail of failures) {
    const f = fields.find((x) => x.afId === fail.afId);
    const value = planById.get(fail.afId)?.value;
    if (!f || !value) continue;
    const recStrat = recipe[fieldSig(f)]?.control;
    if (recStrat) stratById.set(fail.afId, { strategy: recStrat, reason: "recipe" });
    else needDiag.push({ f, value });
  }
  if (needDiag.length) {
    const diags = await diagnoseFieldsBatch(page, needDiag, config);
    for (const d of diags) stratById.set(d.afId, { strategy: d.strategy, reason: d.reason });
  }

  for (const fail of failures) {
    const f = fields.find((x) => x.afId === fail.afId);
    const value = planById.get(fail.afId)?.value;
    if (!f || !value) continue;
    const { strategy: strat, reason } = stratById.get(fail.afId) || {};
    if (!strat || strat === "human") {
      fixes.push({ label: f.label, outcome: "human", reason });
      continue;
    }
    let st = "";
    try {
      st = strat === "address" ? await fillAddress(page, profile) : await fillOne(page, f, String(value), strat);
    } catch (e) {
      st = "실패:" + (e.message || "").slice(0, 40);
    }
    if (isOk(st)) {
      recipe[fieldSig(f)] = { control: strat };
      fixes.push({ label: f.label, outcome: "fixed", strat });
      fail.status = "ok(fixed)";
    } else {
      fixes.push({ label: f.label, outcome: "stillfail", strat, status: st, reason });
    }
  }
  saveRecipe(host, recipe);

  // 부족 정보: 필수(*)인데 프로필 값 없어 스킵된 것
  const missing = plan
    .filter((p) => {
      const f = fields.find((x) => x.afId === p.afId);
      return p.skip && f && /\*/.test(f.label || "") && /없|미제공|모름|정보/.test(p.note || "");
    })
    .map((p) => {
      const f = fields.find((x) => x.afId === p.afId);
      return { label: (f.label || "").replace(/\*/g, "").trim().slice(0, 30), note: p.note };
    });

  const okc = results.filter((r) => isOk(r.status)).length;
  return { host, total: fields.length, results, okc, fixes, addrStatus, photoStatus, missing };
}

// Gemini 매핑 없이, 외부에서 준 plan(afId→value/skip)으로만 채우는 실행기.
// (--claude-map 모드: 매핑 지능을 이 터미널의 Claude 가 담당하고, plan.json 으로 전달)
export async function runPlan(page, profile, fields, plan, log = console.log) {
  const host = new URL(page.url()).hostname;
  const results = [];
  for (const p of plan) {
    const f = fields.find((x) => x.afId === p.afId);
    if (!f) {
      results.push({ afId: p.afId, status: "필드없음" });
      continue;
    }
    if (p.skip || !p.value) {
      results.push({ afId: p.afId, label: f.label, status: "skip", note: p.note });
      continue;
    }
    try {
      results.push({ afId: p.afId, label: f.label, control: f.control, value: String(p.value), status: await fillOne(page, f, String(p.value), p.control) });
    } catch (e) {
      results.push({ afId: p.afId, label: f.label, control: f.control, value: String(p.value), status: "실패:" + (e.message || "").slice(0, 40) });
    }
  }

  let addrStatus = "-";
  if (profile.address && fields.some((f) => /우편번호/.test(f.placeholder || "") || /현주소|주소/.test(f.label || ""))) {
    log("  주소 모달...");
    try {
      addrStatus = await fillAddress(page, profile);
    } catch (e) {
      addrStatus = "실패:" + (e.message || "").slice(0, 40);
    }
  }

  let photoStatus = "-";
  if (profile.photoPath) {
    try {
      photoStatus = (await uploadPhoto(page, profile.photoPath)) ? "ok" : "입력칸못찾음";
    } catch (e) {
      photoStatus = "실패";
    }
  }

  const okc = results.filter((r) => isOk(r.status)).length;
  return { host, total: fields.length, results, okc, fixes: [], addrStatus, photoStatus, missing: [] };
}
