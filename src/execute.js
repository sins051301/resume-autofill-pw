import { fillText, fillDate, fillDatePopup, fillDatePicker, selectNative, selectCombobox, selectChoice, fillCustomSelect, fillCustomDropdown, fillRadioOption } from "./widgets.js";

const isDateValue = (v) => /^\d{4}-\d{2}(-\d{2})?$/.test(String(v));
const looksDateField = (f) =>
  /YYYY|년|월|일|date/i.test(f.placeholder || "") || /생년월일|일자|날짜|년월|date/i.test(f.label || "");

// 단일 필드 채우기 — control 종류(또는 override)에 따라 알맞은 핸들러 호출.
// 초기 실행과 실패 재시도(진단 후 control 교체)에서 공용으로 사용.
export async function fillOne(page, f, value, controlOverride) {
  const control = controlOverride || f.control;
  const loc = page.locator(`[data-af-id="${f.afId}"]`);
  if (control === "customselect" || (f.widget === "customselect" && !controlOverride)) {
    return (await fillCustomSelect(page, loc, value)) ? "ok(customselect)" : "옵션없음";
  }
  if (control === "customdropdown" || (f.widget === "customdropdown" && !controlOverride)) {
    return (await fillCustomDropdown(page, loc, value)) ? "ok(dropdown)" : "옵션없음";
  }
  if (control === "datepicker" || (f.widget === "datepicker" && !controlOverride)) {
    return (await fillDatePicker(page, loc, value, f.dateGranularity)) ? "ok(datepicker)" : "달력실패";
  }
  if (control === "radiooption" || (f.widget === "radiooption" && !controlOverride)) {
    return (await fillRadioOption(page, loc)) ? "ok(radio)" : "선택실패";
  }
  if (control === "date") {
    return (await fillDatePopup(page, loc, value)) ? "ok(date)" : "달력실패";
  }
  if (control === "text" && isDateValue(value) && looksDateField(f)) {
    return (await fillDate(page, loc, value, f.placeholder)) ? "ok(date)" : "날짜실패";
  }
  if (control === "text" || control === "textarea") {
    await fillText(page, loc, value);
    return "ok";
  }
  if (control === "select") {
    return (await selectNative(loc, value)) ? "ok" : "옵션없음";
  }
  if (control === "combobox") {
    return (await selectCombobox(page, loc, value)) ? "ok" : "옵션없음";
  }
  if (control === "choice") {
    return (await selectChoice(page, loc, value)) ? "ok" : "항목없음";
  }
  return "미지원control:" + control;
}

export async function executePlan(page, plan, fields) {
  const byId = new Map(fields.map((f) => [f.afId, f]));
  const results = [];

  for (const step of plan) {
    const f = byId.get(step.afId);
    const r = { afId: step.afId, label: f ? f.label.slice(0, 24) : "", control: f ? f.control : "?", value: String(step.value || "").slice(0, 24), status: "" };
    if (!f) {
      r.status = "필드없음";
      results.push(r);
      continue;
    }
    if (step.skip || step.action === "skip" || !step.value) {
      r.status = "skip" + (step.note ? `(${step.note})` : "");
      results.push(r);
      continue;
    }
    try {
      r.status = await fillOne(page, f, String(step.value));
    } catch (e) {
      r.status = "실패: " + (e.message || "").split("\n")[0].slice(0, 50);
    }
    results.push(r);
  }
  return results;
}
