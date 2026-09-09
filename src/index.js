import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.js";
import { extractFields } from "./extract.js";
import { mapFields } from "./map.js";
import { executePlan } from "./execute.js";
import { uploadPhoto } from "./widgets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.resolve(root, f), "utf8"));

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a))));
}

async function main() {
  const config = readJson("config.json");
  const profile = readJson("profile.json");
  const url = process.argv[2];
  const outDir = path.resolve(root, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const { context, page } = await launchBrowser(config);
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }

  console.log("\n브라우저가 열렸습니다.");
  console.log("→ 로그인하고, 채우려는 지원서 폼 페이지까지 이동하세요.");
  await ask("→ 준비되면 이 창에서 Enter 를 누르세요... ");

  console.log("\n[1/4] 필드 추출 중...");
  const fields = await extractFields(page);
  fs.writeFileSync(path.join(outDir, "fields.json"), JSON.stringify(fields, null, 2));
  console.log(`  ${fields.length}개 필드 발견`);

  console.log("[2/4] 스크린샷 저장 중...");
  const shotPath = path.join(outDir, "page.png");
  await page.screenshot({ path: shotPath, fullPage: true });
  const screenshotBase64 = fs.readFileSync(shotPath).toString("base64");

  console.log("[3/4] AI 매핑 중...");
  let plan;
  try {
    plan = await mapFields({ fields, profile, screenshotBase64, config });
  } catch (e) {
    console.error("  매핑 실패:", e.message);
    console.error("  fields.json / page.png 는 out 폴더에 저장됨. 브라우저는 열어둡니다.");
    return;
  }
  fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));

  const preview = plan
    .filter((p) => !p.skip && p.value)
    .map((p) => {
      const f = fields.find((x) => x.afId === p.afId);
      return { label: f?.label || `afId ${p.afId}`, control: f?.control || "?", value: String(p.value || "").slice(0, 24) };
    });
  console.log("\n=== 채울 내용 미리보기 ===");
  console.table(preview);

  const yn = await ask("\n이대로 채울까요? (y = 실행 / 그 외 = 취소) ");
  if (yn.trim().toLowerCase() !== "y") {
    console.log("취소했습니다. 브라우저는 열어둡니다.");
    return;
  }

  console.log("\n[4/4] 채우는 중...");
  const results = await executePlan(page, plan, fields);
  console.table(results);
  const ok = results.filter((r) => r.status.startsWith("ok")).length;

  if (profile.photoPath) {
    if (fs.existsSync(profile.photoPath)) {
      try {
        const done = await uploadPhoto(page, profile.photoPath);
        console.log(done ? "사진 업로드: ok" : "사진 업로드: 파일 입력칸을 못 찾음");
      } catch (e) {
        console.log("사진 업로드 실패:", (e.message || "").split("\n")[0]);
      }
    } else {
      console.log(`사진 업로드 건너뜀: 파일 없음 (${profile.photoPath})`);
    }
  }
  console.log(`\n완료: ${ok}개 채움 / 총 ${results.length}개 시도`);
  console.log("브라우저는 열어두었습니다. 확인 후 직접 제출하세요.");
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
