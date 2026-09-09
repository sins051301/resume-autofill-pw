import { callGeminiJson } from "./gemini.js";

const STRATEGY_GUIDE = `가능한 strategy:
- "combobox": 클릭 시 목록이 뜨는 드롭다운(검색형 포함) → 열어서 옵션 클릭
- "customselect": 트리거 클릭 후 나타나는 옵션 버튼/항목을 텍스트로 클릭하는 커스텀 드롭다운
- "choice": 버튼/라디오 그룹에서 항목 클릭
- "date": 달력 위젯 → 팝업 입력칸에 날짜 타이핑
- "text": 단순 텍스트 입력
- "address": 우편번호/주소 검색 모달
- "human": 자동 불가(파일 업로드, 본인인증, 캡차, 서버검증 버튼 등)`;

const surroundingHtml = (page, afId) =>
  page
    .locator(`[data-af-id="${afId}"]`)
    .evaluate((el) => {
      const wrap = el.closest("div, section, li, td, fieldset") || el;
      return wrap.outerHTML.replace(/\s+/g, " ").slice(0, 1200);
    })
    .catch(() => "");

// 실패 필드들을 한 번의 호출로 일괄 진단 (요청 수 절감 → 분당 쿼터 회피)
export async function diagnoseFieldsBatch(page, items, config) {
  if (!items.length) return [];
  const blocks = [];
  for (const { f, value } of items) {
    const html = await surroundingHtml(page, f.afId);
    blocks.push(`afId=${f.afId}\n라벨: ${f.label}\n넣으려는 값: ${value}\n실패한 control: ${f.control}\n주변 HTML: ${html}`);
  }
  const prompt = `너는 웹 지원서 폼 자동입력 디버거다. 아래 여러 필드를 채우려다 실패했다. 각 필드를 어떤 전략으로 조작해야 채워지는지 판정해라.

${STRATEGY_GUIDE}

필드들:
${blocks.join("\n---\n")}

각 afId 마다 하나씩, JSON 배열로만 출력:
[{"afId":0,"strategy":"...","reason":"간단한 근거"}]`;

  try {
    const r = await callGeminiJson(config, prompt);
    const arr = Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : [];
    const byId = new Map(arr.map((x) => [x.afId, x]));
    return items.map(({ f }) => ({ afId: f.afId, strategy: byId.get(f.afId)?.strategy || null, reason: byId.get(f.afId)?.reason || "" }));
  } catch (e) {
    const reason = "진단실패:" + (e.message || "").slice(0, 40);
    return items.map(({ f }) => ({ afId: f.afId, strategy: null, reason }));
  }
}

// 실패한 필드의 주변 HTML을 보고 AI가 올바른 조작 전략을 판정
export async function diagnoseField(page, f, value, config) {
  const html = await page
    .locator(`[data-af-id="${f.afId}"]`)
    .evaluate((el) => {
      const wrap = el.closest("div, section, li, td, fieldset") || el;
      return wrap.outerHTML.replace(/\s+/g, " ").slice(0, 1500);
    })
    .catch(() => "");

  const prompt = `너는 웹 지원서 폼 자동입력 디버거다. 아래 필드를 채우려다 실패했다. 어떤 전략으로 조작해야 채워지는지 판정해라.

필드 라벨: ${f.label}
넣으려는 값: ${value}
현재 판정된 control: ${f.control} (이 방식으로 실패함)
주변 HTML:
${html}

가능한 strategy:
- "combobox": 클릭 시 목록이 뜨는 드롭다운(검색형 포함) → 열어서 옵션 클릭
- "choice": 버튼/라디오 그룹에서 항목 클릭
- "date": 달력 위젯 → 팝업 입력칸에 날짜 타이핑
- "text": 단순 텍스트 입력
- "address": 우편번호/주소 검색 모달
- "human": 자동 불가(파일 업로드, 본인인증, 캡차, 서버검증 버튼 등)

JSON 하나만 출력: {"strategy":"...","reason":"간단한 근거"}`;

  try {
    const r = await callGeminiJson(config, prompt);
    return { strategy: r.strategy, reason: r.reason || "" };
  } catch (e) {
    return { strategy: null, reason: "진단실패:" + (e.message || "").slice(0, 40) };
  }
}
