import { callGeminiJson } from "./gemini.js";

export async function mapFields({ fields, profile, screenshotBase64, config }) {
  if (!config.geminiApiKey) {
    throw new Error("config.json 의 geminiApiKey 가 비어있습니다. AIza... 키를 넣으세요.");
  }

  const profileText = Object.entries(profile)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join("\n");

  const fieldText = fields
    .map((f) => {
      const opts = f.options && f.options.length ? ` / 선택지:[${f.options.join(", ")}]` : "";
      return `afId=${f.afId} | control=${f.control} | label="${f.label}" | placeholder="${f.placeholder}" | pos(x=${f.box.x},y=${f.box.y})${opts}`;
    })
    .join("\n");

  const instruction = `너는 웹 지원서(이력서) 폼을 사용자 프로필로 정확히 채우는 매핑 엔진이다.
첨부 스크린샷과 아래 "필드 목록", "프로필"을 보고, 각 필드에 무엇을 넣을지 결정해라.

각 필드는 control 종류가 있다:
- date: 달력 날짜 위젯. value를 YYYY-MM-DD 로 줘라 (예: 생년월일 → 2001-05-13). 맞는 날짜 정보 없으면 skip.
- text: 일반 입력. value에 넣을 문자열. (날짜칸이면 value를 YYYY-MM-DD 로)
- textarea: 여러 줄 입력. 자기소개서 서술형 문항이면 skip (사용자가 직접 작성).
- select / choice: "선택지"가 제공된다. 반드시 그 중 하나의 정확한 텍스트를 value로 줘라. 맞는 선택지가 없으면 skip.
- combobox: 클릭하면 목록이 열리는 드롭다운. 옵션이 지금 안 보여도(대부분 안 보임) 프로필에 맞는 값이 있으면 그 값을 value로 줘라 — 실행기가 목록을 열어 찾는다. (예: 국적 → "대한민국") 프로필에 관련 정보가 전혀 없을 때만 skip.

규칙:
1. 확실하지 않으면 skip. 틀리게 채우는 것보다 비우는 게 낫다.
2. 라벨/화면 위치를 근거로 판단. 근무처 칸에 이름을 넣는 식의 오배치 금지.
3. 전화번호가 여러 칸으로 쪼개져 있으면 각 칸에 해당 자리만 넣어라.
4. 여러 줄(\\n 포함) 값은 textarea 에만.
5. 자기소개서 서술 문항, 파일 업로드, 본인인증, 우편번호 검색은 skip (note에 이유).
6. 각 필드는 최대 한 번만 매핑.

출력은 JSON 배열만. control별 실제 조작은 실행기가 알아서 하니 너는 afId와 value(또는 skip)만 정하면 된다. 형식:
[{"afId":0,"value":"넣을값","note":"근거"}, {"afId":3,"skip":true,"note":"자소서 서술형"}]

프로필:
${profileText}

필드 목록:
${fieldText}`;

  const parsed = await callGeminiJson(config, instruction, screenshotBase64, console.log);
  if (!Array.isArray(parsed)) throw new Error("Gemini 응답이 배열이 아닙니다.");
  return parsed;
}
