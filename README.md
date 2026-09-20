# Hyomes 오목

서버 없이 한 기기에서 두 사람이 바로 즐기는 15×15 오목 PWA입니다.

- 실행 즉시 대국 시작
- 흑·백 번갈아 착수
- 가로·세로·대각선 5목 이상 승리
- 종료 후 `한 판 더` 한 번으로 재대국
- 착수·승리·재대국을 구분하는 짧은 효과음
- 총 대국·흑승·백승 기록을 기기 `localStorage`에 보관
- iPhone, iPad, 노트북 반응형 UI 및 오프라인 실행

## 실행

```bash
npm install
npm run dev
```

## 검증

```bash
npm test
npm run lint
npm run build
```

## 구조

- `src/core`: UI 및 네트워크에 의존하지 않는 순수 게임 엔진과 `Room` 경계
- `src/storage`: 버전이 지정된 로컬 통계 저장소
- `src/App.tsx`: 현재 로컬 2인 대국 UI

AI·온라인 대국·아케이드 모드는 현재 구현하지 않았습니다. 향후 별도 Room 구현을 추가할 수 있도록 UI와 게임 엔진 사이에 `Room` 인터페이스를 두었습니다.

## 배포

- Production: https://omok-arena.vercel.app
- Vercel team: `hyomes`
