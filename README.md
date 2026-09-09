# 이력 자동 채우기 (Playwright)

지원서 폼을 프로필로 자동으로 채웁니다. 시스템에 설치된 크롬을 사용하며(추가 다운로드 없음), 로그인은 사람이 직접 합니다. 채운 뒤 브라우저는 열린 채 유지되니 확인 후 직접 제출합니다.

## 파이프라인 흐름

```
크롬 실행 → (사람) 로그인·폼 이동 → 폼 감지
   → 추출(extract)     : DOM에서 필드 수집, 각 필드에 afId 부여
   → 탐색(probe)       : 위젯을 실제로 열어보고 선택지·달력포맷 파악 (값은 안 바꿈)
   → 매핑(map)         : 필드 ↔ 프로필 값 배정 (Gemini 또는 claude-map)
   → 채우기(execute)   : 위젯 종류별 핸들러로 입력
   → 진단·학습         : 실패 필드 AI 진단 후 재시도, 성공 전략을 host별 recipe에 저장
   → 리포트 + 브라우저 유지
```

- 로그인 리다이렉트/새 탭에 대비해 **컨텍스트의 모든 탭 중 필드가 가장 많은 탭**을 자동 선택합니다.
- 매핑 실패해도 브라우저는 열어둡니다(로그인 유지).

## 1회 준비
예시 파일을 복사해 본인 값으로 채웁니다 (`config.json`·`profile.json` 은 개인정보/키라 git 에 올라가지 않음):
```
cp config.example.json config.json
cp profile.example.json profile.json
```
1. `config.json`
   - `geminiApiKey` : `AIza...` 키 (https://aistudio.google.com → Get API key)
   - `geminiModels` : 폴백 모델 목록 (예: `["gemini-3.6-flash","gemini-flash-latest"]`). 한 모델이 429/503이면 다음으로 자동 전환.
2. `profile.json` : 본인 이력 값 (전공/우편번호 등 빈칸 채우기).

## 실행

```
node src/agent-run.js <폼 URL> [옵션]
```

**진입 옵션 (택1)**
- `--wait=<초>` : 그 시간 안에 로그인·폼 이동하면, 폼(필드 8개↑) 감지 즉시 실행. (권장)
- `--auto` : 로그인이 이미 돼 있을 때. URL 이동 후 3초 뒤 바로 실행.
- (옵션 없음) : 로그인·이동 후 터미널 Enter.

**매핑 방식**
- 기본 : Gemini API 로 매핑 (스크린샷 첨부 멀티모달, 429/503 시 서버 retryDelay 만큼 대기 후 재시도).
- `--claude-map` : **Gemini 대신 이 저장소를 다루는 Claude(터미널)가 매핑**. API 호출 0회 → 쿼터/과부하 문제 없음.
  1. 폼 감지 후 `out/fields.json`(필드), `out/fields-debug.json`(필드별 주변 HTML), `out/page.png`(전체 스크린샷) 저장하고 `out/plan.json` 을 폴링 대기
  2. Claude 가 fields + 스크린샷을 보고 `out/plan.json` 작성 → 형식 `[{"afId":0,"value":"값"},{"afId":3,"skip":true,"note":"이유"}]`
  3. 자동으로 감지해 채우기 실행

예)
```
node src/agent-run.js "https://.../apply" --wait=180 --claude-map
```

## 지원 위젯 (execute.js / widgets.js)
- text / email / textarea 정확 채우기, 쪼개진 전화번호 분할
- 네이티브 select, checkbox
- **라디오** : name 있는 그룹 + **name 없는 개별 옵션(클릭형, 옵션 텍스트로 매핑)**
- **커스텀 드롭다운** : `ant-dropdown-trigger` / `[role=combobox]` / `[aria-haspopup]` 등 라이브러리·ARIA 신호로 감지 → 열어서 옵션 클릭
- **커스텀 select** : 구조(옵션 클러스터 + 히든 input/플레이스홀더)로 감지 (특정 사이트 클래스 비의존)
- **달력 date-picker** : Ant Design(`.ant-picker`) 일/월 자동 판별(probe) → 헤더 이동 후 날짜 셀 클릭 (+ title/aria 범용 폴백, 재시도)
- 주소 검색 모달, 증명사진 파일 업로드

## 산출물 (out/)
- `fields.json` : 추출·탐색된 필드 (control/widget/label/options/dateGranularity)
- `fields-debug.json` : 필드별 주변 HTML (라벨/옵션 누락 원인 파악용)
- `page.png` : 전체 스크린샷 (누락 시각 검증)
- `plan.json` : 매핑 계획 (claude-map 에서 입력)
- `report.json` : 채움 결과

## 설계 원칙
- **사이트별 하드코딩 금지** — 위젯은 UI 라이브러리/ARIA/구조 신호로 감지해 새 폼에도 일반화.
- **진입 시 위젯을 열어 확인(probe)** 하고 **스크린샷으로 누락 대조** → 최대한 누락 없이.
- 정보가 없거나 서술형(자기소개 등)·파일 업로드·본인인증은 skip.

## 참고
- `.userdata` 프로필의 로그인 세션은 실행 간 유지되지 않을 수 있어, 매 실행 시 열린 크롬에서 로그인이 필요할 수 있습니다.
- Gemini 무료 티어는 분당/일일 요청 한도가 낮습니다. 반복 실행이 잦으면 `--claude-map` 을 쓰면 API 자체를 안 씁니다.
