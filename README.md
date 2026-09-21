# Hyomes 오목

한 기기에서 둘이 두거나 Groq과 겨루는 15×15 오목 PWA입니다.

- 실행 즉시 로컬 2인 대국 시작
- `Groq과 대국`에서 사용자가 흑, Groq이 백으로 착수
- 가로·세로·대각선 5목 이상 승리
- Groq 오류·무료 할당량 소진 시 재요청하거나 사람이 백돌 대신 착수
- 종료 후 `한 판 더` 한 번으로 재대국
- 착수·승리·재대국을 구분하는 짧은 효과음
- 총 대국·흑승·백승 기록을 기기 `localStorage`에 보관
- iPhone, iPad, 노트북 반응형 UI 및 오프라인 실행

## 실행

```bash
npm install
npm run dev
```

로컬 Vite 서버에서는 2인 대국과 UI를 사용할 수 있습니다. Groq API까지 로컬에서 실행하려면 Vercel CLI로 프로젝트 환경변수를 불러온 뒤 `vercel dev`를 사용합니다.

## 환경변수

Vercel Production 환경에 다음 값을 설정합니다.

- `GROQ_API_KEY`: GroqCloud 콘솔(https://console.groq.com/keys)에서 발급한 API 키
- `GROQ_MODEL` (선택): 기본값 `openai/gpt-oss-20b` — 무료 티어에서 가장 가볍고 빠르며 strict JSON Schema 출력을 지원하는 모델

API 키는 브라우저 번들에 포함되지 않고 `/api/ai-move` 서버리스 함수에서만 사용됩니다. 별도 기기별 제한은 없으며 모든 사용자가 해당 Groq 조직의 무료 할당량(요청/토큰 한도)을 공유합니다. AI 착수 1회가 API 요청 1회입니다.

## 검증

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

GitHub Actions에서도 단위·통합 테스트, 타입 검사와 프로덕션 빌드, Chromium 데스크톱·모바일 E2E를 실행합니다.

## 구조

- `src/core`: UI 및 네트워크에 의존하지 않는 순수 게임 엔진과 `Room` 경계
- `src/server`: Groq 요청 검증, 프롬프트, strict JSON Schema 응답 검증
- `src/storage`: 버전이 지정된 로컬 통계 저장소
- `api/ai-move.ts`: Vercel Edge Function 진입점
- `src/App.tsx`: 로컬 2인 및 Groq 대국 UI
- `e2e`: 데스크톱·모바일 실제 브라우저 시나리오

## 배포

- Production: https://omok-arena.vercel.app
- Vercel team: `hyomes`
- Source: https://github.com/hyonaldo/omok-arena

`main` 브랜치에 push하면 Vercel이 자동으로 빌드·배포합니다.
Pull Request를 열면 미리보기 배포 URL이 생성됩니다.
