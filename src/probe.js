// 처음 진입 시 위젯을 실제로 열어보고 선택지/포맷을 파악해 필드 정보를 보강한다.
// 원칙: "열어서 읽기"만 하고 값은 바꾸지 않는다(Esc 로 닫음). 제출/선택 버튼은 절대 누르지 않는다.

async function openTrigger(page, loc) {
  const inner = loc.locator("input, button, [role='button'], [role='combobox']").first();
  const t = (await inner.count().catch(() => 0)) ? inner : loc;
  await t.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function close(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(80);
}

// 달력 위젯: 열어서 일/월/연 패널인지 판별
async function probeDateGranularity(page, loc) {
  await openTrigger(page, loc);
  const g = await page
    .evaluate(() => {
      const vis = (s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null);
      if (vis(".ant-picker-month-panel")) return "month";
      if (vis(".ant-picker-year-panel")) return "year";
      if (vis(".ant-picker-date-panel") || vis(".ant-picker-body")) return "day";
      return "";
    })
    .catch(() => "");
  await close(page);
  return g;
}

// 드롭다운/콤보박스: 열어서 실제 옵션 텍스트 수집 (새로 뜬 컨테이너로 한정해 노이즈 방지)
async function probeOptions(page, loc) {
  await openTrigger(page, loc);
  const opts = await page
    .evaluate(() => {
      const containers = [
        ...document.querySelectorAll(
          ".ant-select-dropdown, [role='listbox'], [class*='dropdown' i], [class*='menu' i], [class*='options' i], .select-option"
        )
      ].filter((c) => c.offsetParent !== null);
      const seen = new Set();
      const out = [];
      const push = (t) => {
        t = (t || "").replace(/\s+/g, " ").trim();
        if (t && t.length <= 40 && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      };
      for (const c of containers)
        c.querySelectorAll("[role='option'], li, button, .ant-select-item, [class*='item' i]").forEach((e) => {
          if (e.offsetParent !== null) push(e.textContent);
        });
      return out.slice(0, 40);
    })
    .catch(() => []);
  await close(page);
  return opts;
}

export async function probeFields(page, fields, log = () => {}) {
  let n = 0;
  for (const f of fields) {
    const loc = page.locator(`[data-af-id="${f.afId}"]`);
    try {
      if (f.widget === "datepicker") {
        const g = await probeDateGranularity(page, loc);
        if (g) {
          f.dateGranularity = g;
          n++;
        }
      } else if (
        (f.widget === "customselect" || f.widget === "customdropdown" || f.control === "combobox") &&
        (!f.options || f.options.filter(Boolean).length < 2)
      ) {
        const opts = await probeOptions(page, loc);
        if (opts.length) {
          f.options = opts;
          n++;
        }
      }
    } catch {
      /* 개별 probe 실패는 전체를 막지 않음 */
    }
  }
  log(`  탐색(probe): ${n}개 위젯 보강`);
  return fields;
}
