export async function extractFields(page) {
  return await page.evaluate(() => {
    const isVisible = (el) => {
      const rects = el.getClientRects();
      if (!rects.length) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const labelText = (el) => {
      const out = [];
      if (el.labels) for (const l of el.labels) out.push(l.textContent);
      const aria = el.getAttribute("aria-label");
      if (aria) out.push(aria);
      const lb = el.getAttribute("aria-labelledby");
      if (lb)
        for (const id of lb.split(/\s+/)) {
          const ref = document.getElementById(id);
          if (ref) out.push(ref.textContent);
        }
      if (!out.length) {
        let n = el.closest("div, td, th, li, dd, section");
        for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
          const lab = n.querySelector("label");
          if (lab && lab.textContent.trim()) {
            out.push(lab.textContent);
            break;
          }
          const prev = n.previousElementSibling;
          if (prev && !prev.querySelector("input,select,textarea,button")) {
            const t = (prev.textContent || "").trim();
            if (t && t.length < 40) {
              out.push(t);
              break;
            }
          }
        }
      }
      return out
        .map((t) => (t || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 120);
    };

    const out = [];
    let i = 0;
    const claimed = new Set();
    const push = (el, entry) => {
      el.setAttribute("data-af-id", String(i));
      const r = el.getBoundingClientRect();
      out.push({ afId: i, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, ...entry });
      i++;
    };

    // 1) 선택 그룹 (라디오 그룹 / MUI 토글버튼 그룹)
    // 섹션 래퍼(내부에 입력요소·중첩그룹 있음)는 제외하고 순수 토글 그룹만
    const groups = document.querySelectorAll('[role="radiogroup"], [role="group"]');
    for (const g of groups) {
      if (!isVisible(g)) continue;
      if (g.querySelector('input, select, textarea, [role="combobox"], [role="group"], [role="radiogroup"]')) continue;
      const btns = Array.from(g.querySelectorAll('button, [role="radio"], [role="button"]')).filter((b) => (b.textContent || "").trim());
      if (btns.length < 2 || btns.length > 8) continue;
      if (btns.some((b) => (b.textContent || "").trim().length > 12)) continue;
      const options = btns.map((b) => (b.textContent || "").trim().slice(0, 20));
      btns.forEach((b) => claimed.add(b));
      push(g, { tag: "group", control: "choice", label: labelText(g), placeholder: "", options });
    }

    // 1.5) 커스텀 드롭다운 (범용 휴리스틱 — 특정 사이트 클래스에 의존하지 않음)
    // 옵션 클러스터를 감싸되 "진짜 입력요소가 없는" 최소 컨테이너로 한정하고,
    // 그 안에 '선택하세요' 플레이스홀더 또는 값저장용 히든 input 이 있을 때만 커스텀 셀렉트로 인정.
    // (조상 어딘가의 히든 input 만으로 잡으면 네비 메뉴 등을 오탐하므로, 실입력요소를 만나면 상향 확장 중단.)
    try {
      const optionSel = "button, li, a, [role='option'], [role='menuitem']";
      const realInputSel = "input:not([type='hidden']):not([type='button']), select, textarea";
      const isPlaceholderText = (t) => /^\s*(선택|선택하세요|choose|select)[\s.·:]*$/i.test(t);
      const optionClusters = new Set();
      for (const o of document.querySelectorAll(optionSel)) {
        if (o.parentElement) optionClusters.add(o.parentElement);
      }
      for (const cluster of optionClusters) {
        const optTexts = Array.from(cluster.children)
          .filter((c) => c.matches(optionSel))
          .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
          .filter((t) => t && t.length <= 30 && !isPlaceholderText(t));
        if (optTexts.length < 2 || optTexts.length > 40) continue;

        // 실입력요소를 포함하지 않는 최상위 조상(최대 2단계 위)까지만 래퍼로 확장
        let wrap = cluster;
        for (let up = 0; up < 2; up++) {
          const p = wrap.parentElement;
          if (!p || p.querySelector(realInputSel)) break;
          wrap = p;
        }
        if (claimed.has(wrap) || !isVisible(wrap)) continue;

        const hasHidden = !!wrap.querySelector("input[type='hidden']");
        const hasPlaceholder = Array.from(wrap.querySelectorAll("button, [role='button'], input[type='button'], span, div, a")).some(
          (e) =>
            isPlaceholderText((e.textContent || "").trim()) ||
            /combobox|listbox/i.test(e.getAttribute("role") || "") ||
            e.hasAttribute("aria-haspopup")
        );
        if (!hasHidden && !hasPlaceholder) continue; // 메뉴/탭 등 오탐 방지

        const trigger = wrap.querySelector("[title], button, [role='button'], input[type='button']");
        const label = (trigger && trigger.getAttribute("title")) || labelText(wrap);
        wrap.querySelectorAll("input, button, a, [role='option']").forEach((e) => claimed.add(e));
        claimed.add(wrap);
        push(wrap, { tag: "custom-select", control: "choice", widget: "customselect", label: (label || "").replace(/\s+/g, " ").slice(0, 120), placeholder: "", options: optTexts.slice(0, 40) });
      }
    } catch (e) {
      /* 커스텀 셀렉트 감지 실패는 나머지 추출을 막지 않는다 */
    }

    // 1.6) 커스텀 드롭다운 트리거 (닫힌 상태 — 옵션은 클릭해야 포탈로 로드됨)
    // input/select 가 아닌 클릭형 위젯. Ant dropdown trigger / aria-haspopup / role=combobox(div).
    try {
      const triggerSel = ".ant-dropdown-trigger, [class*='dropdown-trigger' i], [aria-haspopup='listbox'], [aria-haspopup='menu'], [role='combobox']";
      for (const el of document.querySelectorAll(triggerSel)) {
        if (claimed.has(el) || !isVisible(el)) continue;
        if (el.matches("input, select, textarea")) continue; // 실제 입력요소는 pass 3
        if (el.querySelector("input:not([type='hidden']), select, textarea")) continue; // 내부 실입력요소가 진짜
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!text || text.length > 30) continue;
        claimed.add(el);
        push(el, { tag: "custom-dropdown", control: "choice", widget: "customdropdown", label: text, placeholder: text, options: [] });
      }
    } catch (e) {
      /* 무시 */
    }

    // 2) 라디오 옵션
    // 옵션 텍스트: label > aria-label > 부모 컨테이너 텍스트(형제 span/contenteditable 대응) > value
    const radioTextOf = (el) => {
      const lab = el.closest("label");
      if (lab && lab.textContent.trim()) return lab.textContent.replace(/\s+/g, " ").trim();
      const al = el.getAttribute("aria-label");
      if (al && al.trim()) return al.trim();
      const box = el.parentElement;
      const t = box ? (box.textContent || "").replace(/\s+/g, " ").trim() : "";
      return t || el.value || "";
    };
    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter((el) => isVisible(el) && !claimed.has(el));
    const named = {};
    const unnamed = [];
    for (const el of radios) {
      if (el.name) (named[el.name] = named[el.name] || []).push(el);
      else unnamed.push(el);
    }
    // name 있는 정상 그룹 → 옵션 배열을 가진 choice
    for (const key in named) {
      const grp = named[key];
      const options = grp.map((el) => radioTextOf(el).slice(0, 20)).filter(Boolean);
      grp.forEach((el) => claimed.add(el));
      const anchor = grp[0].closest("label, div, td, li") || grp[0];
      push(anchor, { tag: "radio-group", control: "choice", label: labelText(grp[0]), placeholder: "", options, name: key });
    }
    // name 없는 라디오(React 등) → 개별 선택 옵션(클릭형). 매퍼가 원하는 옵션만 plan 에 넣어 선택.
    for (const el of unnamed) {
      const text = radioTextOf(el).slice(0, 40);
      const anchor = el.closest("label, div, td, li") || el;
      if (claimed.has(anchor)) continue;
      claimed.add(el);
      claimed.add(anchor);
      push(anchor, { tag: "radio-option", control: "choice", widget: "radiooption", label: text, placeholder: "", options: text ? [text] : [] });
    }

    // 3) 개별 입력요소
    const els = Array.from(
      document.querySelectorAll('input, select, textarea, [role="combobox"], [contenteditable="true"]')
    );
    const skipTypes = ["hidden", "submit", "button", "reset", "image", "radio", "checkbox", "file"];
    for (const el of els) {
      if (claimed.has(el)) continue;
      if (el.disabled) continue;
      if (!isVisible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || "";
      let control, type;
      if (role === "combobox") {
        control = "combobox";
        type = "combobox";
      } else if (tag === "select") {
        control = "select";
        type = "select";
      } else if (tag === "textarea") {
        control = "textarea";
        type = "textarea";
      } else if (tag === "input") {
        type = (el.getAttribute("type") || "text").toLowerCase();
        if (skipTypes.includes(type)) continue;
        control = "text";
      } else {
        continue;
      }

      const entry = {
        tag,
        type,
        control,
        readonly: !!el.readOnly,
        label: labelText(el),
        placeholder: el.getAttribute("placeholder") || "",
        name: (el.getAttribute("name") || "").slice(0, 30),
        value: (el.value || "").slice(0, 40)
      };
      if (tag === "select") {
        entry.options = Array.from(el.options)
          .map((o) => (o.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 40);
      }
      // 클릭형 달력 위젯 감지 (readonly 텍스트 + 날짜성 placeholder 또는 picker/calendar 컨테이너)
      if (control === "text") {
        const dateish = /날짜|date|yyyy|년\s*월|생년월일|입사|퇴사|일자/i.test(entry.placeholder + " " + entry.label);
        const inPicker = !!el.closest("[class*='picker' i], [class*='calendar' i], [class*='datepicker' i]");
        if (el.readOnly && (dateish || inPicker)) entry.widget = "datepicker";
        else if (inPicker && dateish) entry.widget = "datepicker";
      }
      push(el, entry);
    }

    // 4) 날짜 선택 트리거 (버튼형 달력 — 클릭하면 팝업에 날짜 입력칸이 뜸)
    const dateBtns = document.querySelectorAll("button");
    for (const b of dateBtns) {
      if (claimed.has(b)) continue;
      const t = (b.textContent || "").replace(/\s+/g, "").trim();
      if (t !== "날짜선택") continue;
      if (!isVisible(b)) continue;
      push(b, { tag: "button", type: "date", control: "date", readonly: false, label: labelText(b), placeholder: "날짜 선택", name: "", value: "" });
    }

    return out;
  });
}
