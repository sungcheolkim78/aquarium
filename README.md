# 🐠 고요한 아쿠아리움 (Aquarium)

웹 브라우저에서 GPU 가속으로 구동되는, 바라보기만 해도 마음이 편안해지는 low-poly 3D 아쿠아리움 웹 애플리케이션입니다.

실사 그래픽 대신 간결하고 따뜻한 폴리곤 스타일과 수중 분위기(빛 줄기, 코스틱, 기포, 미세한 해초 및 물고기 유영 흔들림)를 통해 조용하고 평온한 힐링 경험을 제공합니다.

Render Link: https://aquarium-tddp.onrender.com/

---

## ✨ 주요 기능 및 특징

- **브라우저 3D 가속 & 경량화**: Three.js와 WebGL2를 기반으로 동작하며, 불필요한 에셋 다운로드 없이 절차적(procedural) 지오메트리와 셰이더를 사용하여 경량화(드로우콜 < 30, 30만 폴리곤 이하)를 실현했습니다.
- **데이터 주도 물고기 시스템 (Data-driven Registry)**: 별도의 렌더링 코드 수정 없이 레지스트리(`FISH_REGISTRY`)에 설정 추가만으로 새로운 어종을 확장할 수 있습니다.
  - 기본 어종 3종 (SPEC F3): **클라운피시**, **파랑참돔**, **노란열대어**
  - 확장 어종 3종 (`resources/images` 레퍼런스 아트 기반): **나비치**, **보라탱**, **자주열대어**
- **Instanced 렌더링 & 군집(Boid) AI**: 종별 1회의 드로우콜(`InstancedMesh`)로 수십 마리의 물고기 군집 이동 및 유영을 부드럽게 시뮬레이션합니다.
- **풍부한 수중 연출**:
  - **수중 코스틱(Caustics)**: 바닥과 산호에 일렁이는 햇살 굴절 표현 (Shader)
  - **지수 포그(Fog)** & **빛기둥(God Rays)**: 바닷속 깊이감 및 신비로운 분위기 조성
  - **기포 파티클(Bubbles)**: CPU 기반 상승 파티클 시스템
  - **해초 및 물고기 흔들림(Sway Shader)**: 조류에 맞춰 자연스럽게 반응하는 버텍스 셰이더
- **적응형 품질 관리 (Adaptive Quality)**:
  - 브라우저 탭 비활성화 시 렌더 루프 자동 정지 (`document.hidden`)
  - 저사양 환경에서 프레임레이트(FPS) 저하 감지 시 해상도 스케일 다운 및 개체수 자동 조정
  - 디바이스 픽셀 비율(DPR) 상한선(1.5~2.0) 제어로 발열 및 배터리 소모 방지
- **힐링 UX & 앰비언트 사운드**:
  - 조작 없이 천천히 수중을 순회하는 느린 카메라 드리프트
  - 외부 오디오 파일 없이 Web Audio API로 실시간 합성되는 잔잔한 바다 파도 소리 (브라우저 정책 준수: 기본 음소거, 사용자 토글)

---

## 🛠 기술 스택

- **언어**: TypeScript (타입 안전성 및 어종 정의 공유)
- **3D 렌더링 엔진**: Three.js
- **번들러 & 개발 도구**: Vite
- **테스트**: Vitest
- **배포 (v1)**: Static-First 정적 사이트 배포 (Render.com)

---

## 📁 프로젝트 구조

```text
aquarium/
├── SPEC.md             # 프로젝트 사양 및 설계 상세 문서
├── README.md           # 프로젝트 안내 문서 (본 문서)
├── LICENSE             # Apache 2.0 라이선스
└── web/                # [v1] Three.js + TypeScript + Vite 기반 프론트엔드
    ├── index.html      # 진입 HTML
    ├── package.json    # 의존성 및 스크립트 정의
    ├── tsconfig.json   # TypeScript 설정
    ├── vite.config.ts  # Vite 설정
    └── src/
        ├── main.ts         # 렌더 루프, 카메라 드리프트, 적응형 품질 제어
        ├── config.ts       # 어종 레지스트리(FISH_REGISTRY) 및 씬 설정
        ├── fish.ts         # 절차적 물고기 지오메트리 & Boid 군집 시뮬레이션
        ├── environment.ts  # 해저 지형, 산호군락, 해초, 광선 및 조명 생성
        ├── particles.ts    # 상승 기포 파티클 시스템
        ├── ui.ts           # 로딩 화면, 타이틀, 앰비언트 사운드(Web Audio API)
        ├── style.css       # 미니멀 UI 스타일
        └── fish.test.ts    # 물고기 지오메트리 및 시뮬레이션 단위 테스트
```

---

## 🚀 실행 방법

### 1. 사전 요구사항
- Node.js (v18 이상 권장, Vite 7은 v20.19 이상 권장)
- npm

### 2. 개발 서버 실행 (Hot Reload)

```bash
# web 디렉토리로 이동
cd web

# 의존성 패키지 설치
npm install

# 로컬 개발 서버 시작
npm run dev
```

실행하면 터미널에 아래처럼 주소가 표시됩니다. 브라우저에서 해당 주소를 여세요.

```text
  VITE v7.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

> 소스 코드(`web/src/`)를 수정하면 브라우저가 자동으로 갱신(HMR)됩니다.

### 3. 테스트 실행

```bash
cd web
npm run test
```

### 4. 프로덕션 빌드 & 로컬 미리보기

```bash
cd web
npm run build     # dist/ 폴더에 정적 파일 생성 (tsc 타입 체크 포함)
npm run preview   # 빌드 결과물을 http://localhost:4173 에서 미리보기
```

배포 전에 `npm run build && npm run preview`로 실제 동작을 한 번 확인해 보는 것을 권장합니다.

---

## 🌊 Render.com 배포 (v1: 정적 사이트)

이 프로젝트는 백엔드 없는 Static-First 구조이므로, Render의 **Static Site** 하나만으로 무료 배포가 가능합니다. Git에 푸시하면 자동으로 빌드·배포되고 글로벌 CDN과 무중단(콜드스타트 없음) 서빙을 제공합니다.

### 사전 준비

1. 이 레포지토리를 GitHub(또는 GitLab)에 푸시합니다.
2. [render.com](https://render.com)에 가입하고 GitHub 계정을 연동합니다.

### 배포 방법 (웹 대시보드)

1. Render 대시보드에서 **New + → Static Site**를 선택합니다.
2. GitHub 저장소 연결 후 대상 레포지토리(`aquarium`)를 선택합니다.
3. 빌드 설정을 아래와 같이 입력합니다.

   | 항목 | 값 |
   |---|---|
   | **Root Directory** | `web` |
   | **Build Command** | `npm install && npm run build` |
   | **Publish Directory** | `dist` |
4. **Create Static Site**를 클릭하면 첫 배포가 시작됩니다.
5. 배포가 완료되면 `https://<프로젝트명>.onrender.com` 주소로 접속할 수 있습니다.

> 이후에는 `main` 브랜치에 푸시할 때마다 자동으로 재배포됩니다.

### SPA / 캐시 설정 (선택)

- 현재 v1은 단일 페이지이므로 SPA fallback이 필수는 아니지만, Render Static Site 설정의 **Rewrite Rule**로 `/* → /index.html (Rewrite)`을 추가해 두면 하위 경로 진입 시에도 안전합니다.
- 빌드 산물은 해시 파일명(`assets/index-*.js`)이라 캐시 무효화 문제가 없습니다.

### render.yaml 블루프린트 (선택)

IaC 방식을 선호한다면 레포 최상단에 `render.yaml`을 추가하고 Render 대시보드에서 **New + → Blueprint**로 등록할 수도 있습니다.

```yaml
services:
  - type: web
    name: aquarium-web
    runtime: static
    rootDir: web
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    pullRequestPreviewsEnabled: false
    headers:
      - path: /assets/*
        name: Cache-Control
        value: public, max-age=31536000, immutable
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

---

## 🐠 어종 추가 가이드

새로운 물고기 종을 추가하려면 `web/src/config.ts`의 `FISH_REGISTRY` 배열에 항목을 정의하기만 하면 됩니다.

```typescript
// web/src/config.ts 예시
{
  id: "green-damselfish",
  label: "초록자리돔",
  geometry: "lowpoly-fish",
  palette: {
    body: "#2ecc71",
    fin: "#27ae60",
    accent: "#a8fbc6"
  },
  behavior: {
    speed: 1.0,
    schooling: true,
    activityRadius: 8.0
  },
  shape: {
    length: 0.55,
    height: 0.38,
    width: 0.15,
    tailSpan: 0.32,
    stripes: 2
  },
  count: 15
}
```

---

## 🗺 로드맵

- **v1 (현재)**: `web/` 스캐폴딩, 물고기 3종 + 산호/해초 + 포그/버블/광선/코스틱 씬, Render 정적 배포
- **v2**: 어종 레지스트리 확장, WebGPU 렌더러 전환 옵션, 유리병 메시지 등 서버 기능 필요 시 Hono 경량 백엔드 API 추가
- **v3**: 인터랙티브 요소 및 방문자 상호작용 확장

---

## 📄 라이선스

본 프로젝트는 [Apache-2.0 License](LICENSE)를 따릅니다.
