# 아쿠아리움 SPEC

**상태**: v1 구현 완료 / v1.1 설계 확정 (Spec-Driven + TDD 적용 대상)
**작성일**: 2026-09-05
**최종 수정일**: 2026-09-05 (v1.1: 폴리곤 디테일 상향 + 설정 패널)
**한 줄 정의**: 웹 브라우저에서 GPU 가속으로 구동되는, 바라보기만 해도 마음이 편안해지는 3D 아쿠아리움

---

## 0. 개발 방법론 (v1.1부터 적용)

이 문서 이후의 모든 기능은 **Spec-Driven Development(SDD) + Test-Driven Development(TDD)** 로 개발한다.

1. **Spec 먼저**: 기능/데이터 모델/수용 기준을 이 문서에 먼저 기술하고 합의한다. 구현 중 스펙과 다른 선택을 하게 되면, 코드보다 먼저 이 문서(§8 결정 로그 포함)를 갱신한다.
2. **테스트 먼저**: 각 기능은 아래 §9(테스트 전략)에 정의된 실패하는 테스트를 먼저 작성한 뒤 구현한다. 순수 로직(지오메트리 생성식, 트라이앵글 수 계산, 설정 상태 리듀서, localStorage 직렬화)은 전부 단위 테스트 대상이다. Three.js 렌더링 자체(실제 화면 픽셀)는 단위 테스트 대상이 아니며, `npm run build && npm run preview`로 육안 확인한다.
3. **수용 기준(Acceptance Criteria)**: 각 요구사항 항목에 체크 가능한 기준을 명시한다(§4, §7 참고). 기준을 만족하는 테스트가 없다면 그 기능은 "완료"로 간주하지 않는다.

---

## 1. 프로젝트 목적

사용자가 별도 조작 없이 물고기들이 산호초 사이를 헤엄치는 장면을 바라보며 **평온함과 힐링**을 얻는 페이지. 실사가 아닌 low-poly 폴리곤 스타일로, 조용하고 평온한 분위기를 유지한다.

핵심 키워드: 브라우저 3D 가속 · low-poly · 수중 분위기 · 힐링 · 경량 · (v1.1) 사용자 조절 가능한 디테일

## 2. 기능 요구사항

| # | 요구사항 | 내용 | 상태 |
|---|---|---|---|
| F1 | 3D 렌더링 | 웹브라우저 전용 3D 가속 사용 (WebGL2 기본, WebGPU 업그레이드 옵션) | v1 완료 |
| F2 | 물고기 | 산호초 주변을 돌아다니는 물고기 군집. 실사가 아닌 간략화된 폴리곤 스타일 | v1 완료 |
| F3 | 어종 확장성 | 초기 3종으로 시작(클라운피시, 파랑참돔, 노란열대어), 이후 종을 계속 추가. 현재 6종 | v1 완료 |
| F4 | 수중 분위기 | 빛의 느낌(광선·코스틱), 물방울/기포, 미세한 물결의 흔들림으로 '바닷속' 표현 | v1 완료 |
| F5 | 힐링 UX | 느린 카메라 드리프트, 최소 UI, 앰비언트 사운드(기본 음소거 + 토글), 로딩 인디케이터 | v1 완료 |
| **F6** | **설정 패널** | **사용자가 실시간으로 씬을 조절할 수 있는 설정 UI (아래 §6.5 상세)** | **v1.1 신규** |
| **F7** | **디테일 상향** | **물고기 폴리곤 수 +150%(2.5배), 배경 폴리곤 수 +125%(2.25배)를 "High" 디테일 기준값으로 삼음 (아래 §6.2 상세)** | **v1.1 신규** |
| F8 | 분위기 프리셋 | 설정 패널 상단에서 조명 세기·물고기 수·기포를 한 번에 바꾸는 프리셋 3개(맑은 산호초/고요한 바다/은은한 저녁). 기기 성능 설정(디테일)은 건드리지 않음 | v1.2 신규 |
| F9 | 감상 모드 | 카메라 "천천히 이동/고정" 선택, 절전 모드(30fps대 목표 + 낮은 DPR), 무입력 시 UI 자동 숨김·재입력 시 즉시 복귀 | v1.2 신규 |
| F10 | 음량 조절 | 앰비언트 사운드의 음량을 슬라이더로 조절(기존 켜기/끄기 토글과 별개 축) | v1.2 신규 |

## 3. 비기능 요구사항

| # | 요구사항 | 기준 |
|---|---|---|
| N1 | 경량성 | 기본(Medium) 디테일: 드로우콜 < 30, 삼각형 < 30만, 물고기 30~60마리. **설정 패널로 도달 가능한 최댓값(High 디테일 × 최대 개체수)에서도 삼각형 < 30만, 드로우콜은 물고기 종 수 + 배경 고정 메시 수를 넘지 않음(§6.5.6 참고)** |
| N2 | 적응형 품질 | DPR 상한 1.5~2, 탭 숨김 시 렌더 중지, fps 하락 시 해상도 → 개체수 순 자동 축소. **자동 축소는 사용자가 설정 패널에서 지정한 값 위에서 동작하는 임시 스케일이며, 설정값 자체를 덮어쓰지 않는다.** **fps가 충분히(§6.7 `recoverFps`) 오래(`recoverWindow`) 유지되면 한 단계씩 자동으로 되돌아간다(진동 방지). 절전 모드(F9)는 별도의 낮은 fps 임계값을 사용해 의도한 낮은 fps를 성능 장애로 오인하지 않는다** |
| N3 | 배포 | Render.com. v1은 정적 사이트(무료, CDN, 콜드스타트 없음) |
| N4 | 유지보수성 | 물고기 종은 데이터 주도 정의 — 레지스트리 항목 추가만으로 확장 |
| **N5** | **설정 영속성** | **설정 패널에서 바꾼 값은 `localStorage`에 저장되어 재방문 시에도 유지된다. 저장된 값이 손상되었거나 스키마 버전이 다르면 기본값으로 안전하게 폴백한다** |
| **N6** | **반영 지연** | **지오메트리 재생성이 필요 없는 설정(개체 표시/숨김, 조명 세기, 물방울 밀도 등)은 변경 즉시(같은 프레임 또는 다음 프레임 내) 반영된다. 지오메트리 재생성이 필요한 설정(디테일 레벨, 배경 물체 수)은 사용자가 슬라이더 조작을 멈춘 뒤 짧은 디바운스(≈150ms) 후 1회 리빌드한다** |

## 4. 기술 스택

### Frontend (v1)
- **TypeScript** (필수) — 어종 추가 로드맵 대비한 타입 안전성
- **Vite** — 번들러/개발 서버
- **Three.js** — 생태계 최대, 트리셰이킹으로 gzip 수십~백수십 KB 수준 유지, `WebGPURenderer` + WebGL2 자동 폴백 내장
- 렌더러 전략: **WebGL2 기본 + WebGPU 업그레이드 옵션** — "가볍고 안정적으로"가 우선

### Backend
- **v1: 없음** — 3D 렌더링은 브라우저 GPU가 처리하고, 물고기 AI(군집 시뮬레이션)와 파티클 위치 갱신은 매 프레임 CPU(JavaScript)에서 계산한다. 둘 다 서버가 관여해야 하는 상태를 만들지 않으므로 서버가 할 일이 없음
- **v2 (필요 시): Node.js + TypeScript + Hono** — 수십 KB 수준 초경량 프레임워크
- 백엔드 도입 트리거: 서버 고유 상태가 생길 때 (예: 방문자 유리병 메시지, 방문 통계). **설정값은 클라이언트 `localStorage`로 충분하므로 F6/F7은 백엔드 도입 트리거가 아니다.**

### 언어
- 전 영역 **TypeScript** 통일 → 어종 종 정의 타입을 프런트/백이 공유 가능

## 5. 아키텍처 & 배포 (Static-First)

| 단계 | Render 구성 | 근거 |
|---|---|---|
| v1 | 정적 사이트 1개 (Git 푸시 자동 배포, SPA fallback, 캐시 헤더) | 무료 + 글로벌 CDN + 콜드스타트 없음. 힐링 페이지 성격에 부합 |
| v2 | 정적 사이트 + 웹서비스(Hono, 같은 오리진 `/api`) | 웹서비스 프리티어는 유휴 시 슬립 → 수십 초 콜드스타트. **실제 서버 기능이 확정될 때까지 웹서비스를 만들지 않는다** |

### 레포 구조
```
aquarium/
├── docs/       # SPEC.md(본 문서), DEVELOPMENT_PROPOSAL.md 등
├── web/        # v1: Vite + TypeScript + Three.js 정적 앱
└── api/        # v2: Hono API (서버 기능 확정 시)
```

### `web/src/` 모듈 구조 (v1.1 반영)
```
web/src/
├── config.ts       # FISH_REGISTRY, SCENE, (신규) DETAIL_PROFILES, DEFAULT_SETTINGS
├── fish.ts         # 절차적 지오메트리(디테일 레벨 매개변수화) + Boid 군집
├── environment.ts  # 배경(디테일/물체 수 매개변수화)
├── particles.ts    # 기포
├── settings.ts     # (신규) 설정 상태, localStorage 영속화, 변경 이벤트/구독
├── settingsPanel.ts # (신규) 설정 UI(DOM), settings.ts 구독 → 폼 렌더 / 폼 입력 → settings.ts 갱신
├── ui.ts           # 로딩/타이틀/사운드 + 설정 패널 여닫는 토글 버튼
└── main.ts         # 조립: settings 변경 이벤트 구독 → 즉시반영 or 디바운스 리빌드
```

## 6. 설계 상세

### 6.1 생물 데이터 모델 (레지스트리)

```ts
type CreatureVariant =
  | { geometry: "lowpoly-fish"; shape: FishShape }
  | { geometry: "lowpoly-shark"; shape: SharkShape };

interface CreatureSpecies extends CreatureVariant {
  id: string;
  palette: { body: string; fin: string; accent: string };
  behavior: {
    speed: number;                     // 기본 유영 속도
    locomotion: "swim";               // 현재 상어도 기존 유영 로직 재사용
    schooling: boolean;                // 군집 여부
    activityRadius: number;            // 활동 반경
  };
}
```

- 초기 3종: 클라운피시, 파랑참돔, 노란열대어. 현재 6종의 물고기와 1종의 상어로 확장됨
- **종 추가 = 레지스트리 엔트리 추가가 끝** (F6의 "물고기 종류" 설정은 이 레지스트리를 순회해 만들어지므로, 종 추가 시 설정 패널에도 자동으로 노출되어야 한다 — 하드코딩된 종 목록 UI 금지)

각 body plan은 geometry key에 따라 독립 builder로 디스패치한다. 현재 `lowpoly-fish`와 `lowpoly-shark`를 지원하며, 상어는 비대칭 꼬리엽과 등지느러미를 가진 별도 shape를 사용한다. 상어 builder는 `web/src/creatures/geometry/shark.ts`에 분리되어 있고, 기존 fish builder의 완전한 모듈 분리는 후속 구조 정리에서 진행한다. 거북이·해마 및 해마용 `hover` locomotion은 후속 확장 범위다.

### 6.2 폴리곤 디테일 레벨 (v1.1, F7)

기존 v1 지오메트리(물고기 ~50 삼각형/마리, 바닥 26×26 세그먼트 plane 등)를 **Medium(기본값)** 기준선으로 삼고, 아래 세 단계를 정의한다. 세그먼트/조각 수치는 구현 시 실측 후 목표 배율에 맞춰 조정하되, **Low ≤ Medium ≤ High이고 High/Medium 배율이 아래 목표를 만족**해야 한다.

| 대상 | Low | **Medium (기존 v1 baseline)** | High | High/Medium 목표 배율 |
|---|---|---|---|---|
| 물고기 1마리 삼각형 수 | Medium의 약 60% | ~50 (기존값) | **~125** | **약 2.5배 (+150%)** |
| 배경 전체(바닥+산호+해초+광선) 삼각형 수 | Medium의 약 60% | 기존 v1 실측값 | **기존 대비 약 2.25배** | **약 2.25배 (+125%)** |

- 물고기 디테일은 `buildFishGeometry(shape, palette, detail)`처럼 **횡단면 분할 수(RING_DIRS 개수)와 길이 방향 세그먼트 수(BODY_SEGMENTS)** 를 `detail` 매개변수로 받아 계산한다. 지느러미 폴리곤도 디테일에 비례해 세분화한다(예: 단일 삼각형 지느러미 → 2~3분할).
- 배경 디테일은 (a) 바닥 `PlaneGeometry` 세그먼트 수, (b) 산호 프리미티브(`ConeGeometry`/`IcosahedronGeometry`/`TorusGeometry`/`CylinderGeometry`)의 radial/height 세그먼트 수, (c) 해초 blade의 세로 세그먼트 수를 함께 스케일한다. **클러스터·블레이드 개수(= "배경 물체 수", §6.5.4) 는 디테일 레벨과 독립적인 별도 설정이다** — 디테일은 "물체 하나의 매끈함", 물체 수는 "물체가 몇 개인가"를 의미하며 혼동하지 않는다.
- 색상/실루엣(치수, stripes 등)은 디테일 레벨과 무관하게 동일하게 유지한다 — 디테일은 오직 폴리곤 세분화만 바꾼다.

#### 6.2.1 High 디테일의 불규칙 페이싯 (`resources/images` 레퍼런스 아트 반영)

세그먼트 수만 올리면 몸통이 여전히 완벽하게 매끈한 회전체로 보여, `resources/images`의 손으로 리토폴로지한 low-poly 아트(면 크기가 들쭉날쭉하고 비대칭으로 잘린 스타일)와는 느낌이 다르다. 이를 좁히기 위해 `FishDetailProfile`에 `facetJitter`(0~1) 필드를 추가한다.

- `facetJitter`는 몸통 링(단면)의 각 정점에 대해, **링 인덱스·정점 인덱스·(종별로 달라지는) 형태 기반 시드**로부터 결정되는 각도 오프셋과 반지름 배율을 적용한다(순수 함수, 외부 RNG 스트림과 무관 — 같은 입력이면 항상 같은 결과, 즉 재빌드/핫리로드에도 실루엣이 흔들리지 않는다).
- `facetJitter = 0`이면 각도 오프셋 0·반지름 배율 1로 항등(identity) — 즉 `low`/`medium`은 기존 v1과 완전히 동일한 매끈한 회전체를 유지한다(AC-1 회귀 없음).
- `high`만 `facetJitter > 0`을 가져, 몸통 면이 불규칙하게 크고 작게 쪼개지는 느낌을 낸다. 지느러미는 이번 범위에서는 지터 대상에서 제외한다(단순 평면 지느러미가 오히려 레퍼런스 아트의 큰 단색 지느러미 느낌과 더 가깝다).
- 왜곡 폭은 `facetJitter` 값에 비례해 상한이 걸려 있어, 실루엣이 과도하게 뾰족해지거나 몸통을 벗어나지 않는다(§9 `computeFacetJitter` 단위 테스트로 고정).
- 참고 이미지(Dreamstime/Pixta 스톡 미리보기)는 라이선스가 없는 워터마크 이미지이므로, 실루엣·색감·재질 분위기만 참고하고 벡터/픽셀을 그대로 임포트하거나 트레이싱하지 않는다 — 기존 나비치/보라탱/자주열대어와 동일한 절차적 구현 원칙을 따른다.

### 6.3 수중 표현 (비용이 싼 셰이더 우선)

| 효과 | 구현 | 비용 |
|---|---|---|
| 깊이감 | 청색 지수 fog | 매우 낮음 |
| 코스틱 | 산호 위 흔들리는 텍스처/셰이더 | 낮음 |
| 기포/물방울 | 상승 파티클 | 낮음 |
| 유영감 | 물고기/해초 vertex 흔들림 | 낮음 |
| 빛기둥 | additive 반투명 평면 수 장 | 낮음 |
| 전체 미세 왜곡 | 저비용 포스트프로세싱 | 선택 적용 |

### 6.4 힐링 UX

- 느린 카메라 드리프트 (사용자 조작 최소화)
- UI 최소화 — 설정 패널은 기본적으로 접혀 있으며, 톱니바퀴 아이콘 클릭으로만 펼쳐진다(§6.5.1). 힐링 경험을 방해하지 않는다.
- 앰비언트 사운드: 브라우저 autoplay 정책상 **기본 음소거, 토글로 활성화**
- 로딩 인디케이터 (첫 진입 경험 보호)

### 6.5 설정 패널 (v1.1, F6)

#### 6.5.1 UI 배치
- 화면 우상단(모바일에서는 상단 고정)에 톱니바퀴 아이콘 버튼. 클릭 시 반투명 패널이 슬라이드 인/아웃.
- 패널은 `ui.ts`가 소유한 오버레이 DOM 위에 얹되, 로직은 `settingsPanel.ts`로 분리한다(관심사 분리 — SPEC §5 모듈 구조 참고).
- 패널이 열려 있어도 렌더 루프/카메라 드리프트는 계속 동작한다(설정 중에도 힐링 경험 유지).

#### 6.5.2 설정 상태 데이터 모델

```ts
type DetailLevel = "low" | "medium" | "high";

interface AquariumSettings {
  schemaVersion: 1;
  fish: {
    /** 종 id -> 표시 여부. 레지스트리에 없는 id는 무시(하위호환). */
    enabledSpecies: Record<string, boolean>;
    detail: DetailLevel;
    /** 종별 count에 곱해지는 전역 배율. 0.25~1.5 범위로 클램프. */
    countScale: number;
  };
  background: {
    detail: DetailLevel;
    /** 산호 클러스터/해초 인스턴스 수에 곱해지는 전역 배율. 0.5~2.0 범위로 클램프. */
    objectCountScale: number;
  };
  lighting: {
    /** HemisphereLight/DirectionalLight 세기 배율. 0.4~1.6 범위로 클램프. */
    intensityScale: number;
    /** 코스틱 셰이더 on/off. */
    caustics: boolean;
  };
  bubbles: {
    enabled: boolean;
    /** SCENE.bubbles.count에 곱해지는 배율. 0~2.0 범위로 클램프. */
    densityScale: number;
  };
  camera: {
    /** "drift" = 기존 카메라 드리프트, "fixed" = 고정(§6.7). */
    mode: "drift" | "fixed";
  };
  performance: {
    /** 절전 모드: 낮은 DPR 상한 + 낮은 fps 임계값을 함께 적용(§6.7). */
    powerSave: boolean;
  };
  audio: {
    /** 앰비언트 사운드 목표 음량, 0~1. 켜기/끄기 토글과 별개로 유지된다. */
    volume: number;
  };
}
```

- 기본값 `DEFAULT_SETTINGS`는 `config.ts`에 정의하며, 현재 v1 동작(모든 종 표시, `detail: "medium"`, 모든 배율 `1`, 코스틱/기포 `true`)과 **완전히 동일**해야 한다 — 즉 설정 패널을 한 번도 열지 않은 사용자는 v1과 동일한 화면을 본다(회귀 없음 보장).
- 저장 키: `localStorage["aquarium:settings"]`. 값은 위 인터페이스를 JSON 직렬화한 문자열. `schemaVersion`이 다르거나 파싱/검증 실패 시 `DEFAULT_SETTINGS`로 폴백하고 손상된 값을 덮어쓴다.
- 최초 방문(저장된 설정 없음) 시 `camera.mode`의 실effective값은 시스템의 `prefers-reduced-motion` 요청이 있으면 `"fixed"`로 시작하지만, `DEFAULT_SETTINGS.camera.mode` 자체는 `"drift"`로 유지된다 — 사용자가 명시적으로 `"drift"`를 저장한 뒤에는 시스템 설정이 이를 덮어쓰지 않는다(§6.7.1).
- `audio.volume`의 기본값 `0.16`은 v1의 하드코딩된 게인 목표값과 동일하다(회귀 없음).

#### 6.5.3 설정 항목 ↔ 반영 방식 매핑

| 설정 항목 | UI 컨트롤 | 반영 방식(N6) | 구현 지점 |
|---|---|---|---|
| 물고기 종류 (종별 on/off) | 종별 체크박스(레지스트리 순회 생성) | 즉시 — 해당 `FishSchool`의 `InstancedMesh.visible`을 토글 (인스턴스 재계산 불필요) | `fish.ts`: `FishSchool.setVisible(boolean)` |
| 물고기 디테일 | Low/Medium/High 라디오 | 디바운스 리빌드 — 대상 종의 지오메트리를 재생성해 교체 | `fish.ts`: `FishSchool.rebuildGeometry(detail)` |
| 물고기 수 (전역 배율) | 슬라이더 0.25×~1.5× | 디바운스 리빌드 — 인스턴스 수 변경은 `InstancedMesh` 용량 재할당이 필요 (기존 `setPopulationScale`은 "보이는 비율"만 줄이던 적응형 품질용 임시 스케일과 구분되는, 사용자 의도의 영구 배율) | `fish.ts`: `FishSchool.rebuildInstances(countScale)` |
| 배경 설정(디테일) | Low/Medium/High 라디오 | 디바운스 리빌드 — 바닥/산호/해초 지오메트리 재생성 | `environment.ts`: `Environment.rebuild(detail, objectCountScale)` |
| 배경 물체 수 | 슬라이더 0.5×~2.0× | 디바운스 리빌드 — 산호 클러스터 수·해초 인스턴스 수 재계산 | `environment.ts`: 위와 동일 함수, 두 값을 함께 받음 |
| 조명 | 슬라이더(세기) + 코스틱 on/off 토글 | 즉시 — `HemisphereLight`/`DirectionalLight.intensity` 직접 대입, 코스틱은 머티리얼 `onBeforeCompile` 활성/비활성 스위치(§6.5.6 참고) | `environment.ts`: `Environment.setLighting(...)` |
| 물방울 | on/off 토글 + 밀도 슬라이더 | 즉시 — 기존 `BubbleField.setDensityScale`과 `points.visible` 재사용 | `particles.ts` (변경 없음, 이미 존재) |
| 카메라 모드 | "천천히 이동"/"고정" 라디오 | 즉시 — 다음 프레임부터 드리프트 계산을 건너뛰고 고정 위치로 스냅 | `main.ts`: `cameraMode` 지역 변수(§6.7.1) |
| 절전 모드 | 체크박스 | 즉시 — 해상도 상한과 fps 임계값을 재계산 | `config.ts`: `computeQualityScales`/`effectiveMinFps` · `main.ts`: `applyQualityStep`(§6.7.2) |
| 음량 | 슬라이더 0~1 | 즉시 — 재생 중이면 게인을 목표치로 부드럽게 램프(0.2초), 다음 재생부터도 이 값을 목표로 사용 | `ui.ts`: `AmbientAudio.setVolume(volume)`(§6.7.3) |

- "디바운스 리빌드" 항목은 슬라이더 `input` 이벤트마다 재생성하지 않고, 조작이 멈춘 뒤 ≈150ms 후 1회만 재생성한다(N6). 재생성 중에는 이전 지오메트리를 그대로 보여주다가 완료 시 교체해 화면 끊김(빈 프레임)을 피한다.
- 리빌드가 필요한 함수들은 새 `BufferGeometry`/`InstancedMesh`를 먼저 만들어 씬에 교체 투입한 뒤, 이전 것을 `dispose()`한다(교체 후 dispose) — 순서를 반대로 하면 교체가 끝나기 전 한 프레임 동안 빈 지오메트리가 보인다. 교체가 끝난 뒤에는 이전 리소스를 반드시 `dispose()`해 메모리 누수를 막는다(기존 `pagehide` cleanup 패턴과 동일한 원칙).

#### 6.5.4 "배경 물체 수"의 정확한 의미
- 산호: `SCENE.coral.clusters * objectCountScale` (반올림, 최소 1).
- 해초: 현재 고정 `count = 64`(코드 내 상수) → `Math.round(64 * objectCountScale)`로 매개변수화.
- 물고기 수(F6의 별도 항목)는 배경 물체 수와 분리되어 있으며 서로 영향을 주지 않는다.

#### 6.5.5 조명 항목 범위
- v1은 이미 광원 3개를 가진다: `HemisphereLight`(하늘광, intensity 1.15) + `DirectionalLight` 2개(주광 "sun" 1.05, 역광 "rim" 0.35). 설정 패널의 "조명" 슬라이더는 이 세 광원의 `intensity`에 동일 배율을 곱해 적용한다(상대 밝기 비율은 유지). 색상 변경은 v1.1 범위 밖(향후 v1.2 후보).

#### 6.5.6 성능/예산 검증 (N1과의 연결)
- 설정 조합의 최댓값(모든 종 표시 × 물고기수 1.5× × 디테일 High × 배경물체수 2.0× × 디테일 High)에서 예상 삼각형 수를 계산하는 순수 함수 `estimateTriangleBudget(settings)`를 `settings.ts`(또는 별도 `budget.ts`)에 만들고, 이 값이 300,000 미만인지 단위 테스트로 고정한다(§9). 드로우콜 예산은 "모든 종을 표시한" 상태를 기준으로 검증한다 — 종 수 + 배경 고정 메시 수로 고정되며 설정 조작으로는 늘지 않는다. 반대로 종 체크박스를 꺼서 `InstancedMesh.visible = false`가 되면 Three.js가 해당 메시를 렌더 목록에서 완전히 제외하므로, 그 종의 draw call과 triangle이 모두 줄어든다(실측: `window.__aq`) — 즉 숨김은 예산을 늘리지 않고 오히려 줄인다.

### 6.6 분위기 프리셋 (v1.2, F8)

설정 패널 최상단에 프리셋 3개 버튼을 둔다. 각 프리셋은 **기존에 이미 존재하는 설정 항목**(조명 세기, 물고기 수 배율, 기포 on/off·밀도)만 한 번에 바꾼다 — 물고기/배경 디테일과 종 선택은 건드리지 않는다(기기 성능 설정과 분위기 설정의 분리, §4.1).

| 프리셋 id | 라벨 | lighting.intensityScale | fish.countScale | bubbles.enabled | bubbles.densityScale |
|---|---|---|---|---|---|
| `clear-reef` | 맑은 산호초 | 1.3 | 1.2 | true | 1.2 |
| `calm-sea` | 고요한 바다 | 1.0 | 1.0 | true | 1.0 |
| `soft-evening` | 은은한 저녁 | 0.6 | 0.7 | true | 0.5 |

- `calm-sea`는 `DEFAULT_SETTINGS`의 값과 정확히 같다 — 최초 방문자가 아무것도 조작하지 않아도 화면은 이미 "고요한 바다"와 동일하게 시작한다(§4.1 "최초 진입은 지금의 기본 장면으로 바로 시작").
- 프리셋 적용은 새로운 저장 필드를 만들지 않는다. "지금 어떤 프리셋이 선택되어 있는가"는 현재 설정값을 세 프리셋과 정확히 비교(`matchingPresetId`)해 **파생**한다 — 정확히 일치하지 않으면(수동 조절 시) 어떤 프리셋도 활성 표시되지 않고 "사용자 설정"으로 보인다. 이 방식은 프리셋 전용 저장 로직이나 스키마 마이그레이션 없이 재방문 시 유지(§8 결정 로그)와 "빠른 연속 선택은 최종 상태로 수렴"을 공짜로 만족시킨다.
- 프리셋 변경은 사운드를 자동으로 켜지 않는다(§4.1).
- 색온도·포그 색·전용 사운드 레이어를 포함하는 2차 확장(§4.1의 "2차")은 이번 범위 밖이며, 스키마에 아직 존재하지 않는 필드를 프리셋이 만들어내지 않는다.

### 6.7 감상 모드와 절전 (v1.2, F9)

#### 6.7.1 카메라 모드
- `camera.mode: "drift" | "fixed"`. `"drift"`는 기존 카메라 드리프트/바빙과 동일. `"fixed"`는 매 프레임 위치 갱신을 건너뛰고 드리프트의 `elapsed = 0` 정지 자세(즉 `angle = 0`인 위치)에 고정한다.
- 최초 방문(저장된 설정 없음)이고 시스템이 `prefers-reduced-motion: reduce`를 요청하면, `main.ts`는 부팅 시점에만 `cameraMode`를 `"fixed"`로 시작한다. 사용자가 설정 패널에서 명시적으로 값을 바꾸면 그 값이 저장되고 이후에는 시스템 설정보다 우선한다.
- 라디오 그룹으로 제공하며(기존 `detailRadioGroup`과 동일한 키보드 접근성 패턴 재사용), 설정 패널을 열고 키보드만으로 모드를 바꾸고 패널을 닫을 수 있어야 한다(AC-12 참고 대신 육안 확인 — 네이티브 `<input type=radio>`/`<button>` 시맨틱만으로 충분하므로 별도 키보드 핸들러는 추가하지 않는다).

#### 6.7.2 절전 모드와 화질 복구
- `performance.powerSave: boolean`. 켜져 있으면 해상도 상한을 `SCENE.quality.powerSave.resolutionScale`(기존 자동 축소 단계의 해상도 스케일보다 더 낮음)로 즉시 클램프하고, 적응형 품질 저하 판정에 쓰는 fps 임계값을 `SCENE.quality.powerSave.minFps`(예: 24, 기존 `minFps` 40보다 낮음)로 낮춘다 — 절전 모드가 의도적으로 만든 낮은 fps를 "성능 장애"로 오인해 추가로 개체수를 줄이지 않기 위함(기존 40fps 임계값과 절전 모드가 충돌하는 문제의 해결).
- 두 계산은 순수 함수로 뽑아 단위 테스트로 고정한다: `computeQualityScales(downgradeStep, powerSave)`가 `{ resolutionScale, populationScale }`을, `effectiveMinFps(powerSave)`가 적용할 fps 임계값을 반환한다(둘 다 `config.ts`).
- 기존 다운그레이드는 한 방향(0→1→2)만 가능했다. 이제 `downgradeStep`은 0~2 사이를 양방향으로 움직인다: `fps < effectiveMinFps(powerSave)`가 `sampleWindow`초 지속되면 한 단계 내려가고(`downgradeStep += 1`, 상한 2), `fps >= SCENE.quality.recoverFps`(기존 임계값보다 확실히 높은 값, 예: 52)가 `recoverWindow`초(다운그레이드보다 긴 지속 시간, 예: 8초) 지속되면 한 단계 올라간다(`downgradeStep -= 1`, 하한 0). 두 방향 모두 한 번에 한 단계만 움직여 화질이 반복해서 오르내리지 않는다.
- 사용자가 설정한 물고기 수(countScale)와 이 자동 스케일은 기존과 마찬가지로 별개 축으로 곱해진다(§8 기존 결정 유지).

#### 6.7.3 음량
- `audio.volume: number`(0~1). 슬라이더로 조절하며, 재생 중이면 `AmbientAudio.setVolume(volume)`이 현재 게인을 새 목표치로 0.2초에 걸쳐 램프한다(끊김 방지). 정지 상태에서 바꾸면 다음 재생 시작 때 이 값을 목표로 사용한다. 음소거 페이드(정지)는 이 목표 음량과 무관하게 항상 0으로 향한다.

### 6.8 UI 자동 숨김 (v1.2, §6.4 확장)

- 포인터/터치/키보드 입력이 일정 시간(기본 6초) 없으면 제목과 컨트롤(사운드·설정 토글)이 서서히 사라진다. 캔버스 자체와 진행 중인 애니메이션은 영향받지 않는다 — 오직 오버레이 UI 표시 여부만 바뀐다.
- 어떤 포인터/터치/키보드 입력이든 즉시 다시 나타나며 숨김 타이머가 재시작된다.
- 설정 패널이 열려 있는 동안에는 자동으로 숨기지 않는다(타이머가 계속 재확인만 하다가, 패널이 닫히면 새로 카운트를 시작한다).
- 새로운 저장 필드는 만들지 않는다 — 항상 켜져 있는 동작이며(§6.4의 "UI 최소화" 철학 연장), 설정 패널에 온오프 토글을 추가하지 않는다.

## 7. 수용 기준 (Acceptance Criteria) — v1.1

- [x] **AC-1**: `DEFAULT_SETTINGS`로 렌더링한 화면은 v1(현재 프로덕션)과 시각적으로 동일하다 — 즉 Medium 디테일 수치가 기존 지오메트리 생성식과 동일한 출력을 낸다 (회귀 테스트: 기존 `buildFishGeometry` 관련 테스트가 `detail: "medium"` 하드코딩 시 그대로 통과).
- [x] **AC-2**: `buildFishGeometry(shape, palette, "high")`가 생성하는 삼각형 수는 `buildFishGeometry(shape, palette, "medium")` 대비 2.3~2.7배(2.5배 ±10%) 범위에 든다.
- [x] **AC-3**: 배경 전체(바닥+산호+해초, 광선 제외 — 광선은 삼각형 수가 미미해 디테일 스케일 대상에서 제외 가능)의 "high" 삼각형 수는 "medium" 대비 2.0~2.5배(2.25배 ±10%) 범위에 든다.
- [x] **AC-4**: 설정 패널에서 종 체크박스를 끄면 다음 프레임 내에 해당 종이 화면에서 사라진다. `InstancedMesh.visible = false`는 Three.js 렌더 목록에서 해당 메시를 완전히 제외하므로, `window.__aq`의 draw call 수와 triangle 수가 모두 그 종만큼 감소한다(실측 확인, 2026-09-05).
- [x] **AC-5**: 슬라이더를 빠르게 여러 번 움직여도 리빌드는 조작이 멈춘 뒤 1회만 발생한다(디바운스 검증 — fake timer 기반 단위 테스트).
- [x] **AC-6**: 저장된 `localStorage` 값이 JSON 파싱 불가능하거나 `schemaVersion`이 다르면 `DEFAULT_SETTINGS`가 반환된다.
- [x] **AC-7**: `estimateTriangleBudget`이 반환하는 최댓값 시나리오 삼각형 수는 300,000 미만이다.
- [ ] **AC-8**: 새 어종을 `FISH_REGISTRY`에 추가하면, 설정 패널의 "물고기 종류" 목록에 코드 수정 없이 자동으로 나타난다(하드코딩 목록 금지 — 회귀 테스트로 레지스트리 길이와 렌더된 체크박스 수가 일치하는지 확인). **미검증**: `settingsPanel.ts`는 자동 테스트에서 제외되어 있어(육안 검증 대상, §9) 이 AC를 고정하는 테스트가 없다. 검증하려면 DOM 렌더링 로직 중 "레지스트리 → 체크박스 개수"만 순수 함수로 분리해 jsdom 없이 테스트하거나, 최소한 `npm run preview`에서 레지스트리 길이와 렌더된 체크박스 수를 육안 대조한다.
- [x] **AC-9**: `facetJitter: 0`(low/medium)은 각도 오프셋 0·반지름 배율 1을 반환해 v1과 정점 단위로 완전히 동일한 지오메트리를 만든다. `facetJitter > 0`(high)은 같은 입력에 대해 항상 같은 오프셋/배율을 반환하며(결정론), 반지름 배율은 `[1 - facetJitter, 1 + facetJitter]` 범위를 벗어나지 않는다.
- [ ] **AC-10**: 프리셋 버튼을 누르면 `lighting.intensityScale`/`fish.countScale`/`bubbles.enabled`/`bubbles.densityScale`만 프리셋 값으로 바뀌고, `fish.detail`/`background.detail`/`fish.enabledSpecies`는 그대로 유지된다. **미검증(회귀 버그 발견, 2026-09-05)**: `localStorage`/`window.__aq` 실측으로 필드 스코핑 자체는 정확함을 확인했다(다른 필드는 건드리지 않음). 그러나 `맑은 산호초`(`fishCountScale: 1.2`) 프리셋을 적용하면 물고기가 전부 화면에서 사라지고 콘솔에 `GL_INVALID_OPERATION: glDrawArraysInstanced: Vertex buffer is not big enough for the draw call`가 매 프레임 반복 출력된다. 원인은 `fish.ts`의 `FishSchool.rebuildInstances()`(설정 패널의 "물고기 수" 슬라이더가 쓰는 것과 동일한 경로, Stage B 이전부터 존재)가 `this.capacity`를 갱신하고 새 `InstancedMesh`를 더 큰 `nextCapacity`로 만들면서도 `writePhaseAttribute()`를 다시 호출하지 않아, 공유 지오메트리의 `aPhase` `InstancedBufferAttribute`가 이전(더 작은) 용량 그대로 남기 때문이다 — `countScale > 1`(용량 증가)일 때만 발생하며 `countScale <= 1`(은은한 저녁 0.7x, 고요한 바다 1.0x)에서는 재현되지 않는다. 재현: `npm run preview` → 설정 열기 → `맑은 산호초` 클릭(또는 "물고기 수" 슬라이더를 1.0x 초과로 이동) → 콘솔 확인. Stage B 코드(`settings.ts`/`settingsPanel.ts`/`main.ts`)가 아니라 기존 F6 리빌드 파이프라인의 버그이지만, 프리셋 기능이 이를 직접 유발하므로 AC-10을 통과로 표시하지 않는다.
- [x] **AC-11**: 세 프리셋 중 어느 것과도 정확히 일치하지 않는 조합(수동 조절 후)에서는 `matchingPresetId`가 `null`을 반환한다("사용자 설정" 표시). 실측(2026-09-05): 조명 밝기 슬라이더를 0.85로 수동 조절한 뒤 새로고침하면 세 프리셋 버튼 모두 `aria-pressed="false"`. 단, Task 7 구현이 `matchingPresetId`를 패널 최초 렌더 시점에만 계산하므로 같은 세션에서 패널을 닫았다가 다시 여는 것만으로는(DOM이 재생성되지 않아) 갱신되지 않는다 — 새로고침 후에는 정확히 반영됨을 확인했다(알려진, 허용된 제약).
- [x] **AC-12**: 카메라 모드를 "고정"으로 선택하면 이후 60초 동안 `camera.position`이 변하지 않는다. 실측(2026-09-05): "고정" 선택 후 8초 간격으로 캡처한 두 스크린샷에서 산호/바닥 등 정적 배경 요소의 화면 좌표가 픽셀 단위로 동일했다(물고기만 이동). 대조군으로 "천천히 이동"으로 전환 후 동일 간격 캡처 시 배경 프레이밍이 뚜렷이 이동함을 확인해 검출 방법 자체의 민감도도 검증했다. 정확히 60초까지는 아니고 8초 구간만 확인했으나 코드상 `cameraMode === "fixed"`일 때 매 프레임의 카메라 갱신 자체를 건너뛰므로(시간 종속 요소 없음) 60초 이상도 동일하게 유지될 것으로 판단한다.
- [ ] **AC-13**: `performance.powerSave`가 켜진 동안 측정 fps가 `SCENE.quality.powerSave.minFps`(예: 24) 이상 `SCENE.quality.minFps`(40) 미만 범위여도 추가 다운그레이드가 발동하지 않는다. **부분 검증**: 절전 모드 체크박스를 켜면 즉시 캔버스 내부 해상도가 `basePixelRatio * 1.0`에서 `* 0.6`로 클램프됨을 실측했다(`canvas.width` 변화, `SCENE.quality.powerSave.resolutionScale` 일치). 그러나 이 AC의 핵심 주장(24~40fps 대역이 `sampleWindow`(3초) 이상 지속돼도 추가 다운그레이드가 발동하지 않음)은 이 샌드박스 headless 브라우저에서 실제 GPU fps를 24~40 대역으로 지속시킬 방법이 없어 재현하지 못했다 — 순수 함수 `computeQualityScales`/`effectiveMinFps`의 단위 테스트(Task 3/4)와 `main.ts` 코드 리뷰로만 뒷받침된다.
- [ ] **AC-14**: 다운그레이드가 한 단계 이상 발동한 뒤 `SCENE.quality.recoverFps` 이상인 fps가 `recoverWindow`초 이상 지속되면 화질이 정확히 한 단계만 복구된다(연속 복구/진동 없음). **미검증**: AC-13과 같은 이유로 지속적인 52fps 이상 구간을 이 headless 환경에서 인위적으로 만들 수 없었다. `downgradeStep`의 양방향 상태 전이는 단위 테스트(Task 4)로 고정되어 있으나, 실제 fps 변동에 따른 종단 간(end-to-end) 동작은 실기기에서 추가 확인이 필요하다("실제 기기 확보 후 추가 예정", `docs/perf-baseline.md` 패턴과 동일).
- [x] **AC-15**: 사운드 재생 중 음량 슬라이더를 움직이면 다음 프레임 내에 실제 게인이 변화하기 시작한다(페이드 전체가 끝나길 기다리지 않음). 실측(2026-09-05): `AudioContext.prototype.createGain`을 가로채 실제 `GainNode`를 확보한 뒤, 사운드 재생 중(게인이 0.16에서 안정화된 상태) 슬라이더를 0.9로 이동시키고 15ms 간격으로 샘플링한 결과 최초 샘플(약 17ms 후)에 이미 게인이 0.16→0.219로 변화를 시작했고 약 0.2초 만에 0.9에 도달해 그대로 유지됨을 확인했다(전체 페이드인 주기인 2.5초를 기다리지 않음).
- [x] **AC-16**: 무입력 상태로 숨김 지연 시간이 지나면 제목/컨트롤이 사라지고, 이후 포인터·터치·키보드 입력이 오면 즉시 다시 나타난다. 설정 패널이 열려 있는 동안에는 숨김이 발동하지 않는다. 실측(2026-09-05): 무입력 6초 경과 후 `#overlay`에 `is-idle` 클래스가 추가됨(제목/컨트롤 `opacity: 0`), `keydown` 이벤트 한 번으로 즉시 제거됨을 확인. 설정 패널을 연 상태로 8초 이상 대기해도 `is-idle`이 붙지 않았고, 패널을 닫자 다시 6초 후 정상적으로 `is-idle`이 붙어 카메라 모드 변경 등 패널 조작과 숨김 타이머 간 상호작용에 문제가 없음을 확인했다.

## 8. 결정 로그

| 날짜 | 결정 | 근거 |
|---|---|---|
| 2026-09-05 | 백엔드 없이 static-first로 시작 | 서버가 할 일이 없음. 무료 CDN + 콜드스타트 없음 |
| 2026-09-05 | TS + Vite + Three.js 채택 | 어종 확장성, 트리셰이킹, WebGPU/WebGL2 폴백 내장 |
| 2026-09-05 | WebGL2 기본, WebGPU는 옵션 | "가볍고 안정적으로" 우선 |
| 2026-09-05 | 초기 어종 3종, 데이터 주도 레지스트리 | 코드 수정 없이 종 확장 |
| 2026-09-05 | Render 웹서비스는 실제 필요 시점에만 추가 | 프리티어 슬립/콜드스타트 회피 |
| 2026-09-05 (v1.1) | 폴리곤 증가율을 "기존 대비 +150%/+125%"(2.5배/2.25배)로 해석 | 사용자 확인. 현재 실측 삼각형 수가 예산(30만) 대비 매우 여유로워(수천~1만 단위) 배율을 키워도 N1 위반 위험이 낮음 |
| 2026-09-05 (v1.1) | 설정 항목은 가능한 한 즉시 반영, 지오메트리 재생성이 필요한 항목만 디바운스 리빌드 | 사용자 확인. 슬라이더 조작감(즉시성)과 지오메트리 재생성 비용(빈번한 rebuild 방지) 사이의 절충 |
| 2026-09-05 (v1.1) | 설정값은 `localStorage`에 영속화 | 사용자 확인. 재방문 시 매번 재조정하지 않도록 |
| 2026-09-05 (v1.1) | 디테일 레벨은 실루엣(치수)이 아닌 폴리곤 세분화만 변경 | 종별 시각 정체성(팔레트/치수)을 유지하면서 성능만 조절하기 위함 |
| 2026-09-05 (v1.1) | "물고기 수" 전역 배율과 적응형 품질(N2)의 `populationScale`을 별개 축으로 분리 | 사용자가 설정한 의도적 개체수와, fps 저하 시 임시로 줄어드는 개체수가 서로를 덮어쓰면 안 됨 — 둘은 곱해서 최종 인스턴스 활성 수를 결정 |
| 2026-09-05 (v1.1) | `resources/images` 레퍼런스 아트는 실루엣/색감만 참고하고, High 디테일의 불규칙 페이싯은 시드 기반 결정론적 함수(`computeFacetJitter`)로 절차적 구현 | 참고 이미지가 워터마크 붙은 라이선스 없는 스톡 미리보기라 벡터/픽셀을 그대로 임포트할 수 없음. 기존 나비치/보라탱/자주열대어와 동일한 "참고만, 절차적 구현" 원칙 유지 + 프로젝트의 에셋-프리 아키텍처(N4) 준수 |
| 2026-09-05 (v1.2) | 분위기 프리셋은 전용 저장 필드 없이 기존 필드 값의 정확한 일치로 "현재 활성 프리셋"을 파생한다 | 새 스키마 필드·마이그레이션 없이 재방문 유지·빠른 연속 선택 수렴을 만족시키기 위함. `calm-sea` 프리셋을 `DEFAULT_SETTINGS`와 동일하게 정의해 첫 방문 화면이 이미 프리셋 하나와 일치하도록 함 |
| 2026-09-05 (v1.2) | 절전 모드는 기존 다운그레이드 임계값(`minFps: 40`)과 별도의 낮은 임계값(`powerSave.minFps`)을 사용 | 절전 모드가 의도적으로 낮춘 fps를 기존 자동 축소 로직이 "성능 장애"로 오인해 추가로 개체수를 줄이는 충돌을 막기 위함 |
| 2026-09-05 (v1.2) | 적응형 품질 다운그레이드를 한 단계씩 되돌리는 복구 경로를 추가(기존엔 한 방향으로만 축소) | 일시적으로 fps가 떨어졌다가 회복된 뒤에도 화질이 영구히 낮은 채로 남는 문제를 해결. 다운그레이드보다 긴 지속 시간(`recoverWindow` > `sampleWindow`)을 요구해 진동 방지 |

## 9. 테스트 전략 (TDD)

새 코드는 아래 순서로 작성한다: **(1) 실패하는 테스트 작성 → (2) 통과하는 최소 구현 → (3) 리팩터**. 파일은 대상 모듈과 같은 디렉터리에 `*.test.ts`로 둔다(기존 `fish.test.ts` 관례 유지).

| 대상 | 테스트 파일(신규/확장) | 검증 내용 |
|---|---|---|
| `buildFishGeometry`의 `detail` 매개변수 | `fish.test.ts` 확장 | AC-1, AC-2. `medium`이 기존 무매개변수 호출과 동일한 정점/삼각형 수를 내는지, `high`가 목표 배율(2.5× ±10%) 범위인지, `low ≤ medium` 순서가 지켜지는지 |
| 배경 지오메트리 디테일 | `environment.test.ts` (신규) | AC-3. 바닥/산호/해초 각각과 합산 삼각형 수가 `medium` 대비 `high`에서 목표 배율 범위인지 |
| 설정 상태 리듀서/영속화 | `settings.test.ts` (신규) | AC-6. `loadSettings()`가 잘못된 JSON/구버전 스키마에서 `DEFAULT_SETTINGS`를 반환하는지, `saveSettings()` 후 `loadSettings()`가 왕복(round-trip)하는지, 각 필드의 clamp 범위(§6.5.2)가 지켜지는지 |
| 디바운스 리빌드 스케줄러 | `settings.test.ts` 또는 `settingsPanel.test.ts` | AC-5. vitest fake timers로 연속 입력 시 리빌드 콜백이 1회만 호출되는지 |
| 삼각형 예산 추정 | `settings.test.ts` (또는 `budget.test.ts`) | AC-7. `estimateTriangleBudget(MAX_SETTINGS)` < 300,000 |
| 설정 패널 ↔ 레지스트리 동기화 | `settingsPanel.test.ts` (신규, DOM 없이 순수 함수로 분리 가능하면 그렇게) | AC-8. 레지스트리 종 수만큼 체크박스 항목이 생성되는지(가능하면 DOM 렌더링 함수를 순수 함수로 분리해 jsdom 없이 테스트) |
| High 디테일의 불규칙 페이싯(`computeFacetJitter`) | `fish.test.ts` 확장 | AC-9. `facetJitter: 0` → 항등(각도 오프셋 0, 반지름 배율 1); `facetJitter > 0` → 결정론(같은 입력 → 같은 출력)이면서 반지름 배율이 `[1-facetJitter, 1+facetJitter]`를 벗어나지 않는지; `medium` 지오메트리가 v1과 정점 단위로 완전히 동일한지(회귀) |

- 기존 `fish.test.ts`(steering/centroid/containment)는 변경 없이 그대로 유지 — 회귀 방지.
- 렌더 루프(`main.ts`)와 실제 셰이더 픽셀 결과는 자동 테스트 대상에서 제외하고, 구현 완료 후 `npm run build && npm run preview`로 육안 확인 + `window.__aq`로 draw call/triangle 수 수동 확인한다.

## 10. 로드맵

| 버전 | 범위 |
|---|---|
| v1 | `web/` 스캐폴딩(Vite+TS+Three.js), 물고기 3종 + 산호 + fog/버블/광선 씬, Render 정적 배포 |
| **v1.1 (본 문서)** | **물고기/배경 폴리곤 디테일 상향(Low/Medium/High) + 설정 패널(종/디테일/개체수/배경/조명/물방울) + localStorage 영속화** |
| v1.2 | 분위기 프리셋 3개, 카메라 고정/절전 모드 + 화질 복구, 음량 슬라이더, UI 자동 숨김 (F8~F10) |
| v2 | 어종 레지스트리 추가 확장, WebGPU 렌더러 전환 옵션, (필요 시) Hono API |
| v3 | 서버 상태 기능 (유리병 메시지 등) — 사용자 요청 기반 |
