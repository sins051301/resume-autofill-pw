import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.js";
import { runAgent, runPlan } from "./agent.js";
import { extractFields } from "./extract.js";
import { probeFields } from "./probe.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.resolve(root, f), "utf8"));

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a))));
}

async function main() {
  const config = readJson("config.json");
  const profile = readJson("profile.json");
  const args = process.argv.slice(2);
  const auto = args.includes("--auto");
  const claudeMap = args.includes("--claude-map");
  const waitArg = args.find((a) => a.startsWith("--wait="));
  const waitSec = waitArg ? Number(waitArg.split("=")[1]) : null;
  const url = args.find((a) => a.startsWith("http"));

  const { context, page } = await launchBrowser(config);
  if (url) await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});

  // 로그인 리다이렉트/새 탭 대비: 컨텍스트의 모든 탭 중 필드가 가장 많은 탭을 고른다.
  const pickBestPage = async () => {
    let best = { page, count: -1 };
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const count = await extractFields(p).then((f) => f.length).catch(() => -1);
      if (count > best.count) best = { page: p, count };
    }
    return best;
  };

  let activePage = page;
  if (waitSec) {
    console.log(`\n로그인하고 지원서 폼까지 이동하세요. 폼이 감지되면 즉시 실행됩니다. (최대 ${waitSec}초 대기)`);
    const formThreshold = 8;
    const deadline = Date.now() + waitSec * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      const best = await pickBestPage();
      console.log(`  폼 필드 ${best.count}개 감지... (탭 ${context.pages().length}개)`);
      if (best.count >= formThreshold) {
        activePage = best.page;
        break;
      }
    }
  } else if (!auto) {
    console.log("\n로그인하고 지원서 폼까지 이동한 뒤 Enter를 누르세요.");
    await ask("→ 준비되면 Enter... ");
    activePage = (await pickBestPage()).page;
  } else {
    await page.waitForTimeout(3000);
    activePage = (await pickBestPage()).page;
  }

  await activePage.bringToFront().catch(() => {});

  // --claude-map: Gemini 대신 이 터미널의 Claude 가 매핑. 필드를 파일로 내보내고 plan.json 을 기다렸다 실행.
  if (claudeMap) {
    const fields = await extractFields(activePage);
    console.log("[claude-map] 위젯 탐색(probe)...");
    await probeFields(activePage, fields, console.log);
    const view = fields.map((f) => ({ afId: f.afId, control: f.control, widget: f.widget || null, label: f.label, placeholder: f.placeholder, options: f.options || undefined, dateGranularity: f.dateGranularity || undefined }));
    fs.mkdirSync(path.join(root, "out"), { recursive: true });
    fs.writeFileSync(path.join(root, "out", "fields.json"), JSON.stringify(view, null, 2));
    // 디버그용: 각 필드 주변 HTML (라벨/옵션이 비어 매핑 못한 필드 원인 파악용)
    const debug = await activePage.evaluate(() => {
      const out = [];
      document.querySelectorAll("[data-af-id]").forEach((el) => {
        let box = el.closest("section, li, fieldset, [class*='Question' i], [class*='Item' i], [class*='Field' i]") || el.parentElement || el;
        for (let i = 0; i < 2 && box.parentElement && (box.textContent || "").trim().length < 4; i++) box = box.parentElement;
        out.push({ afId: Number(el.getAttribute("data-af-id")), text: (box.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120), html: box.outerHTML.replace(/\s+/g, " ").slice(0, 700) });
      });
      return out;
    }).catch(() => []);
    fs.writeFileSync(path.join(root, "out", "fields-debug.json"), JSON.stringify(debug, null, 2));
    // 누락 시각 검증용 전체 스크린샷 (Claude 가 대조)
    await activePage.screenshot({ path: path.join(root, "out", "page.png"), fullPage: true }).catch(() => {});
    const planPath = path.join(root, "out", "plan.json");
    try { fs.unlinkSync(planPath); } catch {}
    console.log(`\n[claude-map] 필드 ${fields.length}개 → out/fields.json 저장. out/plan.json 을 기다립니다...`);

    const deadline = Date.now() + 20 * 60 * 1000;
    let plan = null;
    while (Date.now() < deadline) {
      await activePage.waitForTimeout(3000);
      if (fs.existsSync(planPath)) {
        try {
          plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
          if (Array.isArray(plan)) break;
          plan = null;
        } catch { /* 아직 쓰는 중일 수 있음 — 다시 시도 */ }
      }
    }
    if (!plan) {
      console.log("[claude-map] plan.json 대기 시간 초과. 브라우저는 열어둡니다.");
      await activePage.waitForTimeout(600000);
      return;
    }
    console.log(`[claude-map] plan ${plan.length}개 적용...`);
    const report = await runPlan(activePage, profile, fields, plan);
    console.log("\n================ 리포트 ================");
    console.log(`사이트: ${report.host}`);
    console.log(`필드 ${report.total}개 · 채움 ${report.okc}개 · 사진 ${report.photoStatus} · 주소 ${report.addrStatus}`);
    for (const r of report.results.filter((x) => x.status && !String(x.status).startsWith("ok") && !String(x.status).startsWith("skip"))) {
      console.log(`  ✗ ${r.label} → ${r.status}`);
    }
    console.log("\n브라우저는 열어둡니다. 확인 후 직접 제출하세요.");
    console.log("=======================================");
    fs.writeFileSync(path.join(root, "out", "report.json"), JSON.stringify(report, null, 2));
    await activePage.waitForTimeout(600000);
    return;
  }

  console.log("\n[에이전트 실행]");
  let report;
  try {
    report = await runAgent(activePage, profile, config);
  } catch (e) {
    console.error("에이전트 오류:", e.message || e);
    console.log("\n브라우저는 열어둡니다(로그인 유지). 잠시 후 재실행하면 이 세션에서 이어집니다.");
    await activePage.waitForTimeout(600000);
    return;
  }

  console.log("\n================ 리포트 ================");
  console.log(`사이트: ${report.host}`);
  console.log(`필드 ${report.total}개 · 채움 ${report.okc}개 · 사진 ${report.photoStatus} · 주소 ${report.addrStatus}`);

  if (report.fixes.length) {
    console.log("\n[자동 복구 시도]");
    for (const fx of report.fixes) {
      const mark = fx.outcome === "fixed" ? "✓ 복구" : fx.outcome === "human" ? "✋ 사람필요" : "✗ 실패";
      console.log(`  ${mark} · ${fx.label} ${fx.strat ? "(" + fx.strat + ")" : ""} ${fx.reason || fx.status || ""}`);
    }
  }

  if (report.missing.length) {
    console.log("\n[부족 정보 — 알려주면 다음부터 자동]");
    for (const m of report.missing) console.log(`  ? ${m.label}`);
  }

  console.log("\n브라우저는 열어둡니다. 확인 후 직접 제출하세요.");
  console.log("=======================================");

  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  fs.writeFileSync(path.join(root, "out", "report.json"), JSON.stringify(report, null, 2));
  await activePage.waitForTimeout(600000);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
