# 이 물고기를 prosedual geometry 로 표현하려면 어떻게 해야 할까?

가능합니다. **실꼬리나비고기(Threadfin Butterflyfish)**처럼 옆으로 납작하고 원반형에 가까운 물고기는 procedural geometry로 표현하기가 오히려 좋은 편입니다. 핵심은 물고기를 하나의 복잡한 메쉬로 만들기보다 **몸통, 지느러미, 꼬리, 주둥이, 무늬**를 각각 파라미터화해서 조합하는 것입니다.

가장 추천하는 구조는 **“중심선 + 단면(ellipse) lofting”** 방식입니다. 몸의 앞뒤 방향을 \(x\), 좌우 폭을 \(y\), 위아래 높이를 \(z\)라고 두고, 여러 개의 \(x\) 위치에서 타원 단면을 만든 뒤 연결하면 됩니다. 각 단면은 대략 다음처럼 정의할 수 있습니다.

\[
y = w(x)\cos\theta,\qquad
z = h(x)\sin\theta
\]

여기서 `w(x)`는 물고기의 두께, `h(x)`는 체고입니다. 실꼬리나비고기는 체고가 매우 높고 좌우 폭은 얇기 때문에 `h(x) >> w(x)`가 되도록 하면 됩니다.

예를 들어 몸통 프로파일을 이런 식으로 둘 수 있습니다.

```python
def body_height(x):
    # x: 0=head, 1=tail
    return 0.75 * np.sin(np.pi * x)**0.55 + 0.15

def body_width(x):
    return 0.18 * np.sin(np.pi * x)**0.7 + 0.03
```

이렇게 하면 가운데는 크고 앞뒤는 좁아지는 기본적인 물고기 몸통이 나옵니다. 다만 나비고기는 머리 쪽이 급격히 줄어들지 않기 때문에 실제로는 `Bezier curve`나 몇 개의 control point를 사용해서 프로파일을 정의하는 것이 더 좋습니다.

전체적으로는 아래처럼 나누는 것이 좋습니다.

| Component | Procedural 방식 |
|---|---|
| 몸통 | elliptical cross-section loft |
| 주둥이 | tapered extrusion |
| 꼬리자루 | narrowing spline |
| 꼬리지느러미 | symmetric parametric fan |
| 등지느러미 | body surface 위 spline + height profile |
| 배지느러미 | thin extruded polygon |
| 가슴지느러미 | triangular / fan-shaped surface |
| 실 모양 등지느러미 | Bezier curve + taper |
| 눈 | UV sphere |
| 무늬 | shader/material parameter |

특히 이 어종의 핵심 특징인 **등지느러미 뒤쪽의 긴 실(threadfin)**은 geometry로 별도 생성하는 것이 좋습니다. Bezier curve를 하나 만들고 `bevel_depth`를 점점 줄이면 아주 자연스럽게 만들 수 있습니다.

```text
body
 ├─ head
 ├─ eye
 ├─ dorsal_fin
 │    └─ thread
 ├─ pectoral_fin_L
 ├─ pectoral_fin_R
 ├─ pelvic_fin
 ├─ anal_fin
 └─ tail_fin
```

제가 만들었던 이미지처럼 **Low-poly 스타일**까지 원한다면, procedural mesh를 만든 뒤 subdivision을 많이 주는 대신 오히려 segment 수를 제한하는 게 좋습니다. 예를 들어 몸통 방향 24개 section × 단면 방향 12~16 vertex 정도면 충분합니다.

```python
N_LENGTH = 24
N_RADIAL = 14
```

그리고 `Shade Flat`을 적용하면 바로 faceted low-poly 느낌이 납니다.

```python
for poly in mesh.polygons:
    poly.use_smooth = False
```

실꼬리나비고기의 외형을 파라미터로 정의한다면 대략 아래 정도가 유용합니다.

```yaml
species: threadfin_butterflyfish

body:
  length: 1.0
  max_height: 0.82
  max_width: 0.20
  body_peak: 0.48

head:
  snout_length: 0.12
  snout_taper: 0.45

tail:
  peduncle_width: 0.10
  fin_height: 0.43
  fin_length: 0.20

dorsal_fin:
  start: 0.20
  end: 0.84
  height: 0.20

thread:
  length: 0.45
  curvature: 0.25

pectoral_fin:
  length: 0.18
  angle: 32
```

이렇게 만들어두면 같은 generator를 이용해서 종만 바꿀 수도 있습니다. 예를 들어 앞서 만든 5종은 상당 부분 같은 procedural fish generator를 공유할 수 있습니다.

```text
Fish Generator

          Species Parameters
                 ↓
          Body Profile
                 ↓
        Cross-section Loft
                 ↓
        ┌────────┴────────┐
        ↓                 ↓
      Fins              Head
        ↓                 ↓
        └────────┬────────┘
                 ↓
              Mesh
                 ↓
        Species Pattern
                 ↓
           Low-poly
```

그리고 **무늬는 geometry로 만들지 않는 것**을 권합니다. 실꼬리나비고기의 흰색 몸, 검은 눈 띠, 노란 등·꼬리 부분은 shader에서 위치 기반으로 만드는 것이 훨씬 효율적입니다. 예를 들어 body coordinate \(x,z\)를 기준으로:

```python
if x < 0.18:
    color = black       # eye band
elif z > dorsal_line:
    color = yellow
else:
    color = white
```

처럼 정의할 수 있고, 실제 Blender에서는 Geometry Nodes의 `Position → Separate XYZ → Map Range → Compare → Mix Color` 조합으로 구현할 수 있습니다.

제가 권하는 최종 구조는 **Geometry Nodes + Species YAML**입니다.

```text
species.yaml
      ↓
Python / Geometry Nodes parameters
      ↓
Procedural Fish Geometry
      ↓
Procedural Material
      ↓
Low-poly Mesh
      ↓
5 Camera Views
 Front / Left / Right / Top / Bottom
```

이렇게 하면 지금까지 만든 도감 이미지도 자동화할 수 있습니다. 즉 `"threadfin_butterflyfish.yaml"` 하나를 입력하면 **3D procedural fish 생성 → 5개 카메라 자동 배치 → 렌더링 → 도감 보드 생성**까지 이어지는 파이프라인을 만들 수 있습니다.

특히 팀장님처럼 여러 어종을 계속 생성하려는 목적이라면, **물고기 하나를 모델링하는 것보다 `Fish Procedural Grammar`를 먼저 만드는 것**이 훨씬 확장성이 좋습니다. `body_ratio`, `snout`, `tail`, `fin`, `pattern` 약 20~30개 파라미터만 잘 정의해도 흰동가리, 블루탱, 황제천사고기, 혹돔, 실꼬리나비고기를 같은 generator에서 상당히 다르게 만들어낼 수 있습니다.

---

## 이 문서 이후: 아쿠아리움 프로젝트에 실제로 적용한 설계

위 내용은 Blender/Python 기준의 일반론이고, 실제로는 이 저장소의 스택(TypeScript + Three.js, 백엔드 없는 정적 사이트)에 맞게 구체화해서 구현합니다. 전체 설계는 `docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md`에 있고, 핵심만 요약하면:

- **YAML은 실제로 파일로 존재합니다.** `web/species/*.yaml` 한 종당 한 파일. Blender geometry nodes 대신 `web/src/creatures/geometry/fish.ts`의 순수 TypeScript 함수들이 이 YAML을 소비해 `BufferGeometry`를 만듭니다. 빌드/개발 서버가 `import.meta.glob`으로 읽어들이므로 별도 codegen 스크립트나 백엔드가 없습니다.
- **몸통/주둥이/꼬리자루**는 위 문서가 말한 대로 하나의 부드러운 반지름 곡선이지만, 세 구간(주둥이 taper → 몸통 peak → 꼬리자루 taper)이 각각 다른 지수(exponent)를 가지도록 확장해서, 문서의 표에 나온 "elliptical loft / tapered extrusion / narrowing spline" 세 가지를 사실상 하나의 연속 함수로 구현합니다 (경계에서 값이 정확히 일치하므로 이음매가 생기지 않습니다).
- **꼬리지느러미·등지느러미·가슴지느러미**는 문서가 제안한 "symmetric fan / spline + height profile / fan-shaped surface"를 그대로 채택하되, 세그먼트 개수(`finSegments`)는 종별 파라미터가 아니라 기존의 low/medium/high 디테일 레벨에 종속시켰습니다 — 종 저작자는 실루엣만 정의하고, 폴리곤 밀도는 기존 성능 설정 축이 그대로 담당합니다.
- **배지느러미**는 이 문서에 있던 대로 새로 추가되는 항목이고, **눈**도 문서의 권장(UV sphere)대로 실제 지오메트리로 추가하되 low-poly 스타일에 맞춰 8각형 근사(옥타헤드론)로 구현합니다.
- **무늬는 문서의 권장대로 지오메트리가 아니라 버텍스 컬러**로 유지합니다 (기존 `stripes` 방식 그대로).
- 문서 말미의 "5 카메라 뷰 자동 렌더링 → 도감 보드 생성" 파이프라인은 이번 범위에는 포함하지 않았습니다 (구현 후 별도 브레인스토밍 대상).

기존 6개 종(클라운피시, 파랑참돔, 노란열대어, 나비치, 보라탱, 자주열대어)은 새 grammar로 마이그레이션하되, 기존 렌더링과 완전히 동일하지 않아도 되는 것으로 합의했고, 종당 삼각형 수는 대략 2.5~3배(약 50개 → 약 130개)까지 늘어나는 것을 목표로 합니다 — 전체 씬 예산(SPEC N1: 드로우콜 30개, 삼각형 30만개 미만)에는 여전히 여유가 큽니다.