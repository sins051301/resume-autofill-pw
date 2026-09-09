const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();

export async function fillText(page, loc, value) {
  await loc.fill(String(value), { timeout: 4000 });
  return true;
}

export async function fillDate(page, loc, value, placeholder) {
  const iso = String(value); // YYYY-MM-DD or YYYY-MM
  let sep = "-";
  if (placeholder && placeholder.includes("/")) sep = "/";
  else if (placeholder && placeholder.includes(".")) sep = ".";
  const formatted = iso.replace(/-/g, sep);
  try {
    await loc.evaluate((el) => (el.readOnly = false));
  } catch {}
  await loc.click({ timeout: 3000 }).catch(() => {});
  await loc.fill("", { timeout: 2000 }).catch(() => {});
  await loc.type(formatted, { delay: 10, timeout: 3000 });
  await page.keyboard.press("Escape").catch(() => {});
  const now = await loc.inputValue().catch(() => "");
  return now.replace(/\D/g, "").length >= 6;
}

export async function selectNative(loc, value) {
  try {
    await loc.selectOption({ label: String(value) }, { timeout: 2000 });
    return true;
  } catch {}
  try {
    await loc.selectOption(String(value), { timeout: 2000 });
    return true;
  } catch {}
  const target = norm(value);
  const options = await loc.locator("option").allTextContents();
  for (const opt of options) {
    if (norm(opt) && (norm(opt).includes(target) || target.includes(norm(opt)))) {
      try {
        await loc.selectOption({ label: opt.trim() }, { timeout: 2000 });
        return true;
      } catch {}
    }
  }
  return false;
}

export async function selectCombobox(page, loc, value) {
  await loc.click({ timeout: 3000 });
  await page.waitForTimeout(150);
  const editable = await loc.evaluate((el) => !el.readOnly && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")).catch(() => false);
  if (editable) {
    await loc.fill(String(value)).catch(() => {});
  }
  // 서버 검색형 자동완성: 옵션이 뜰 때까지 대기
  await page.getByRole("option").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  const options = page.getByRole("option");
  const count = await options.count().catch(() => 0);
  const target = norm(value);
  let fuzzy = -1;
  for (let k = 0; k < count; k++) {
    const t = norm(await options.nth(k).textContent().catch(() => ""));
    if (!t) continue;
    if (t === target) {
      await options.nth(k).click({ timeout: 2000 });
      return true;
    }
    if (fuzzy < 0 && (t.includes(target) || target.includes(t))) fuzzy = k;
  }
  if (fuzzy >= 0) {
    await options.nth(fuzzy).click({ timeout: 2000 });
    return true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

// 커스텀 드롭다운 트리거(닫힘) 클릭 → 포탈로 뜬 메뉴에서 텍스트 맞는 항목 클릭.
// probe 와 동일한 셀렉터로 페이지 안에서 찾아 클릭 → probe 가 읽은 옵션은 fill 도 반드시 찾음.
export async function fillCustomDropdown(page, loc, value) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(350);
  const clicked = await page
    .evaluate((val) => {
      const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
      const target = norm(val);
      const containers = [
        ...document.querySelectorAll(
          ".ant-select-dropdown, .ant-dropdown, [role='listbox'], [role='menu'], [class*='dropdown' i], [class*='menu' i], [class*='options' i], .select-option"
        )
      ].filter((c) => c.offsetParent !== null);
      let items = [];
      for (const c of containers)
        items.push(
          ...c.querySelectorAll("[role='option'], [role='menuitem'], li, button, .ant-select-item, [class*='item' i], [class*='option' i]")
        );
      items = items.filter((e) => e.offsetParent !== null && (e.textContent || "").trim());
      const exact = items.find((e) => norm(e.textContent) === target);
      const fuzzy = items.find((e) => {
        const t = norm(e.textContent);
        return t && (t.includes(target) || target.includes(t));
      });
      const hit = exact || fuzzy;
      if (!hit) return false;
      hit.click();
      return true;
    }, value)
    .catch(() => false);
  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await page.waitForTimeout(150);
  return true;
}

// 개별 라디오 옵션 클릭(선택). loc = 옵션 컨테이너. plan 에 있으면 = 이 옵션 선택.
export async function fillRadioOption(page, loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 2000 }).catch(() => {});
  const radio = loc.locator("input[type='radio']").first();
  let checked = await radio.isChecked().catch(() => null);
  if (checked === false) {
    await loc.evaluate((el) => {
      const target = el.querySelector("[contenteditable], span, label") || el;
      target.click && target.click();
    }).catch(() => {});
    checked = await radio.isChecked().catch(() => null);
  }
  return checked !== false; // true 또는 확인불가(null) → 성공 간주
}

export async function uploadPhoto(page, photoPath) {
  const found = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const ctx = (el) => {
      let n = el.closest("div, td, li, section, form");
      let t = "";
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) t += " " + (n.textContent || "");
      return t.replace(/\s+/g, " ").slice(0, 120);
    };
    let best = null;
    for (const el of inputs) {
      const text = ctx(el);
      if (/자격증|증명서|첨부파일|서류|포트폴리오/.test(text)) continue;
      if (/사진|증명\s*사진|프로필|photo|이미지/i.test(text)) {
        best = el;
        break;
      }
      if (!best) best = el;
    }
    if (!best) return false;
    best.setAttribute("data-photo-input", "1");
    return true;
  });
  if (!found) return false;
  await page.locator('[data-photo-input]').setInputFiles(photoPath, { timeout: 5000 });
  return true;
}

// 클릭형 달력 date-picker. 우선 Ant Design(ant-picker) 지원 + 범용 title/aria 폴백.
// 날짜 셀에 title="YYYY-MM-DD" 가 있는 라이브러리(Ant 등)에 두루 동작.
export async function fillDatePicker(page, loc, value, granularity) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await pickDate(page, loc, value, granularity)) return true;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }
  return false;
}

async function pickDate(page, loc, value, granularity) {
  const iso = String(value).slice(0, 10); // YYYY-MM-DD
  const [y, m] = iso.split("-").map(Number);
  const ym = `${y}-${String(m).padStart(2, "0")}`; // 월 피커용 YYYY-MM
  const hasInner = await loc.locator("input").count().catch(() => 0);
  const input = hasInner ? loc.locator("input").first() : loc; // loc 자체가 input 인 경우 대비
  await input.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);

  // 열린(보이는) 드롭다운으로만 범위 한정 — 숨은 picker 헤더를 읽어 무한루프 되는 것 방지
  const dd = page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)").last();
  // 월(month) 피커인지 일(day) 피커인지: 탐색(probe) 결과 우선, 없으면 현재 패널로 판별
  const isMonth = granularity ? granularity === "month" : (await dd.locator(".ant-picker-month-panel").count().catch(() => 0)) > 0;
  const header = dd.locator(".ant-picker-header-view");
  if (await header.count().catch(() => 0)) {
    let prev = "";
    let stuck = 0;
    for (let i = 0; i < 360; i++) {
      const txt = await header.innerText().catch(() => "");
      const mt = txt.match(/(\d{4})(?:\D*?(\d{1,2}))?/);
      if (!mt) break;
      const cy = Number(mt[1]);
      const cm = mt[2] ? Number(mt[2]) : null;
      if (isMonth ? cy === y : cy === y && cm === m) break;
      if (txt === prev) {
        if (++stuck >= 3) break; // 헤더가 안 바뀌면(클릭 무효) 중단
      } else stuck = 0;
      prev = txt;
      let btn;
      if (isMonth) {
        btn = cy > y ? ".ant-picker-header-super-prev-btn" : ".ant-picker-header-super-next-btn"; // 월 패널: ≪/≫ = 연도
      } else if (cy > y) btn = ".ant-picker-header-super-prev-btn";
      else if (cy < y) btn = ".ant-picker-header-super-next-btn";
      else if (cm > m) btn = ".ant-picker-header-prev-btn";
      else btn = ".ant-picker-header-next-btn";
      await dd.locator(btn).first().click({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(70);
    }
  }

  // 셀 클릭: 월 피커면 td[title="YYYY-MM"] 또는 "N월" 텍스트, 일 피커면 td[title="YYYY-MM-DD"]
  let target = null;
  if (isMonth) {
    const byTitle = dd.locator(`td[title="${ym}"], [title="${ym}"]`).first();
    if (await byTitle.count().catch(() => 0)) target = byTitle;
    else {
      const byText = dd.locator(".ant-picker-cell-inner").filter({ hasText: new RegExp(`^${m}월$`) }).first();
      if (await byText.count().catch(() => 0)) target = byText;
    }
  } else {
    const byTitle = dd.locator(`td[title="${iso}"], [title="${iso}"], [aria-label="${iso}"]`).first();
    if (await byTitle.count().catch(() => 0)) target = byTitle;
  }
  if (!target) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await target.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(150);
  const val = await input.inputValue().catch(() => "");
  return val.replace(/\D/g, "").length >= 4;
}

export async function fillDatePopup(page, loc, value) {
  const f = String(value).replace(/-/g, "."); // 2001-05-13 -> 2001.05.13
  await loc.click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const dateInput = page.getByPlaceholder(/\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}/);
  if (!(await dateInput.count().catch(() => 0))) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await dateInput.first().fill(f);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape").catch(() => {});
  return true;
}

export async function fillAddress(page, profile) {
  const btn = page.getByRole("button", { name: /주소.?찾기|주소.?검색|우편번호.?찾기|우편번호.?검색/ });
  if (!(await btn.count().catch(() => 0))) return "주소버튼없음";
  await btn.first().click({ timeout: 3000 });
  await page.waitForTimeout(700);
  const input = page.getByPlaceholder(/도로명|지번|건물명/);
  if (!(await input.count().catch(() => 0))) {
    await page.keyboard.press("Escape").catch(() => {});
    return "검색칸없음";
  }
  const query = (profile.address || "").replace(/\(.*?\)/g, "").trim();
  await input.first().fill(query);
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const clicked = await page.evaluate(() => {
    const modal = document.querySelector('[class*="modal" i], [role="dialog"]') || document.body;
    const cands = [...modal.querySelectorAll('li, button, [role="option"], [class*="item" i], div')];
    for (const e of cands) {
      const t = e.textContent || "";
      if (/로|길/.test(t) && /서울|구|군|시|도/.test(t) && e.querySelectorAll("*").length < 8 && t.trim().length > 6) {
        e.click();
        return t.replace(/\s+/g, " ").slice(0, 40);
      }
    }
    return null;
  }).catch(() => null);
  await page.waitForTimeout(800);
  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => {});
    return "결과없음";
  }
  const detail = profile.addressDetail || "";
  if (detail) {
    const dloc = page.getByPlaceholder(/상세주소/);
    if (await dloc.count().catch(() => 0)) await dloc.first().fill(detail).catch(() => {});
  }
  return "ok(주소)";
}

// 범용 커스텀 드롭다운: 트리거 클릭으로 목록 열고, 텍스트가 맞는 옵션 클릭.
// 사이트별 클래스에 의존하지 않고 역할/태그/텍스트로만 조작.
export async function fillCustomSelect(page, loc, value) {
  const clickEl = async (h) => {
    try {
      await h.click({ timeout: 1500 });
      return true;
    } catch {}
    try {
      await h.evaluate((e) => e.click());
      return true;
    } catch {}
    return false;
  };
  const isPlaceholder = (t) => /^(선택|선택하세요|choose|select)$/.test(t);

  const trigger = loc.locator("button, [role='button'], input[type='button'], [title]").first();
  if (await trigger.count().catch(() => 0)) await clickEl(trigger);
  await page.waitForTimeout(200);

  const opts = loc.locator("button, li, a, [role='option'], [role='menuitem']");
  const count = await opts.count().catch(() => 0);
  const target = norm(value);
  let fuzzy = -1;
  for (let k = 0; k < count; k++) {
    const t = norm(await opts.nth(k).textContent().catch(() => ""));
    if (!t || isPlaceholder(t)) continue;
    if (t === target) return await clickEl(opts.nth(k));
    if (fuzzy < 0 && (t.includes(target) || target.includes(t))) fuzzy = k;
  }
  if (fuzzy >= 0) return await clickEl(opts.nth(fuzzy));
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

export async function selectChoice(page, loc, value) {
  const target = norm(value);
  const candidates = loc.locator('button, [role="radio"], [role="button"], label');
  const count = await candidates.count().catch(() => 0);
  let fuzzy = -1;
  for (let k = 0; k < count; k++) {
    const t = norm(await candidates.nth(k).textContent().catch(() => ""));
    if (!t) continue;
    if (t === target) {
      await candidates.nth(k).click({ timeout: 2000 });
      return true;
    }
    if (fuzzy < 0 && (t.includes(target) || target.includes(t))) fuzzy = k;
  }
  if (fuzzy >= 0) {
    await candidates.nth(fuzzy).click({ timeout: 2000 });
    return true;
  }
  return false;
}
