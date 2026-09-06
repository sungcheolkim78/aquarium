[질문]  
바닷속 지형을 **대략적인 고저차 맵(Height Map)**으로 먼저 만들고, 그 위에 바위·산호·모래·절벽 같은 작은 지형 요소를 procedural하게 자동 배치하는 방법입니다.

[질문의도]  
지금까지 만든 Low-Poly 해저 풍경을 실제 3D 환경으로 확장한다고 보면, **Macro Terrain → Terrain Classification → Detail Scatter**의 3단계 procedural 시스템으로 만드는 것이 가장 관리하기 좋습니다.

[응답]

네. 이 방식이 상당히 적합합니다. 특히 Blender Geometry Nodes를 쓴다면 저는 아래 구조를 추천합니다.

```text
             [Seed]
                │
                ▼
       ┌─────────────────┐
       │ Macro Heightmap │
       │   128×128 정도   │
       └────────┬────────┘
                │
       Noise + Ridge + Basin
                │
                ▼
       ┌─────────────────┐
       │  Base Seafloor  │
       └────────┬────────┘
                │
          지형 특성 계산
       ┌────────┼────────┐
       ▼        ▼        ▼
     Height   Slope   Curvature
       │        │        │
       └────────┼────────┘
                ▼
        Terrain Classification
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
   Sand       Rock       Reef
                             │
              ┌──────────────┼───────────┐
              ▼              ▼           ▼
            Rocks          Coral       Plants
```

### 1. 가장 먼저 아주 낮은 해상도의 Macro Terrain을 만듭니다

처음부터 고해상도 mesh를 만드는 것은 추천하지 않습니다.

예를 들어 100m × 100m 해저라면:

```yaml
terrain:
  size: [100, 100]
  resolution: [128, 128]

  elevation:
    min: -8
    max: 12

  seed: 1729
```

정도만 있어도 충분합니다.

Height를 단순하게 표현하면:

\[
H(x,y)=
A_1N_{\mathrm{large}}(x,y)
+A_2N_{\mathrm{medium}}(x,y)
+A_3R(x,y)
\]

정도로 시작할 수 있습니다.

여기서

- `N_large`: 전체적인 언덕과 계곡
- `N_medium`: 중간 크기의 지형 변화
- `R`: ridge/절벽 구조

입니다.

중요한 것은 **noise를 너무 많이 섞지 않는 것**입니다.

해저가 이런 식으로 되는 것보다

```text
^^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^^^^^
```

이런 식으로 큰 형태가 먼저 보여야 합니다.

```text
               _____
          ____/     \__
     ____/             \____

____                     _____
    \___________________/
```

즉 **큰 공간감부터 만든 다음 작은 디테일을 추가**합니다.

---

## 2. Height Map 자체를 직접 디자인할 수도 있습니다

이게 상당히 유용합니다.

예를 들어 grayscale map 하나를 만들어서

```text
Black ---------------- White
낮은 곳                 높은 곳
```

으로 정의합니다.

그런데 저는 단순 Height Map보다 **Semantic Terrain Map을 하나 더 두는 것**을 추천합니다.

예를 들어 RGB map을:

```text
R = Rock
G = Coral
B = Sand
```

처럼 정의합니다.

그러면 아티스트가 대충 이렇게 칠하기만 해도 됩니다.

```text
       ROCK
   ███████████
 ███         ███

       SAND
      ........
    ............

           CORAL
        **********
```

Procedural system이 이를 읽어서 자동으로 세부 지형을 만듭니다.

---

## 3. 여기서 중요한 것이 Slope입니다

Height Map으로부터 기울기를 계산합니다.

\[
S(x,y)=|\nabla H(x,y)|
\]

그러면 지형을 자동으로 분류할 수 있습니다.

| 지형 조건 | 생성할 것 |
|---|---|
| slope < 10° | 모래 |
| 10–25° | 작은 돌 |
| 25–45° | 바위 + 산호 |
| >45° | 절벽 |
| 높은 지점 | 산호 군락 |
| 낮은 움푹한 곳 | 모래 |
| ridge | 큰 바위/산호 |

이렇게 하면 랜덤하게 오브젝트를 뿌리는 것보다 훨씬 자연스럽습니다.

---

# 4. Curvature도 사용하면 훨씬 좋아집니다

Slope보다 한 단계 더 나가면 **curvature**를 사용할 수 있습니다.

대략:

```text
Convex

        /\
       /  \
______/    \______

→ 산호 / 바위


Concave

______      ______
      \____/

→ 모래 / 작은 돌
```

이렇게 만들 수 있습니다.

그래서 실제 procedural rule을:

```python
if slope < 10 and curvature < 0:
    biome = "sand"

elif slope < 25:
    biome = "small_rocks"

elif slope < 45:
    biome = "reef"

else:
    biome = "cliff"
```

정도로 정의할 수 있습니다.

---

# 5. 그 위에 Detail Scatter Layer를 만듭니다

이제 중요한 부분입니다.

바위 하나하나를 지형 mesh에 직접 포함시키지 않습니다.

별도의 **Scatter System**으로 만듭니다.

```text
Base Terrain
     │
     ├── Rock Scatter
     ├── Coral Scatter
     ├── Pebble Scatter
     ├── Seaweed Scatter
     ├── Shell Scatter
     └── Debris Scatter
```

예를 들어:

```yaml
rock:
  density: 0.12
  scale: [0.3, 2.5]
  slope: [15, 50]
  clustering: 0.7

coral:
  density: 0.08
  slope: [5, 35]
  depth: [-15, -3]
  clustering: 0.85

sand:
  slope: [0, 12]
```

처럼 정의할 수 있습니다.

---

# 6. 완전 Random Scatter는 피하는 것이 좋습니다

이 부분이 시각적으로 상당히 중요합니다.

이렇게 균일하게 나오면:

```text
*   *   *   *   *
  *   *   *   *
*   *   *   *   *
```

인공적으로 보입니다.

실제 자연환경처럼:

```text
***                 *
****              ***
 **

          *****
         ******
          **

                         ***
```

**cluster**를 만들어야 합니다.

그래서 scatter density 자체에도 Noise를 사용합니다.

\[
P(x,y)=Noise(x,y)\times BiomeMask(x,y)
\]

즉:

```text
Terrain
   ↓
Biome Mask
   ↓
Noise Density
   ↓
Poisson Scatter
   ↓
Object Instance
```

구조를 추천합니다.

---

# 7. 산호는 "부모-자식" 방식으로 생성하면 좋습니다

산호 하나를 그냥 뿌리는 것보다:

```text
Coral Colony
     │
     ├── Large Coral
     │
     ├── Medium Coral
     ├── Small Coral
     ├── Rock
     └── Pebbles
```

처럼 **하나의 ecosystem prefab**으로 만드는 겁니다.

예를 들어 큰 산호가 생성되면 주변 반경 2m 안에:

```text
         small coral

     pebble    pebble

        BIG CORAL

 rock              coral

        pebble
```

같이 secondary scatter를 수행합니다.

이것만 해도 풍경이 훨씬 자연스럽습니다.

---

# 8. Low-Poly 스타일에는 더 잘 맞습니다

지금 만들고 계신 이미지 스타일이라면 mesh를 굉장히 단순하게 만들 수 있습니다.

예를 들어 바위는:

```text
Icosphere
   ↓
Subdivision = 2
   ↓
Random Vertex Displacement
   ↓
Scale XYZ Random
   ↓
Shade Flat
```

정도면 충분합니다.

산호도 procedural grammar로:

```text
Trunk
 ├── Branch
 │    ├── Branch
 │    └── Branch
 └── Branch
      ├── Branch
      └── Branch
```

처럼 생성하고 polygon 수를 제한하면 됩니다.

---

# 9. LOD도 자동화하기 좋습니다

카메라에서 멀어질수록:

```text
Camera

│
├─ 0–10m
│    Coral high detail
│    Rock high detail
│
├─ 10–30m
│    Coral low-poly
│    Rock low-poly
│
├─ 30–100m
│    Very simple geometry
│
└─ 100m+
     silhouette
```

정도로 만들 수 있습니다.

특히 해저에서는 fog가 있기 때문에 먼 곳의 geometry는 매우 단순해도 전혀 문제가 없습니다.

---

# 10. 저는 최종적으로 4개의 Map을 두겠습니다

이 프로젝트라면 다음 구조가 가장 실용적이라고 봅니다.

```text
Height Map
    │
    ├── 전체 고저차
    │
Biome Map
    │
    ├── Sand
    ├── Rock
    ├── Coral
    └── Empty
    │
Density Map
    │
    └── object density
    │
Path / Exclusion Map
    │
    └── 아무것도 생성하지 않을 공간
```

특히 마지막 **Exclusion Map**이 중요합니다.

지금 만든 그림들을 보면 가운데에 넓은 빈 공간이 있어서 깊이감이 생깁니다.

```text
Coral                         Coral
████                           ████
████                           ████
██                               ██


             EMPTY


      fish              fish


_______________________________
             sand
```

따라서 모든 공간을 procedural object로 채우기보다 **의도적으로 비워두는 영역을 정의하는 것**이 공간감을 만드는 데 훨씬 중요합니다.

---

## 추천하는 전체 시스템

제가 구현한다면 이런 아키텍처로 만들겠습니다.

```text
              World Seed
                  │
                  ▼
          Macro Terrain Gen
                  │
          ┌───────┴───────┐
          ▼               ▼
      Height Map       Biome Map
          │               │
          └───────┬───────┘
                  ▼
          Terrain Analysis
          Height / Slope
            / Curvature
                  │
                  ▼
          Biome Classification
                  │
       ┌──────────┼───────────┐
       ▼          ▼           ▼
     Sand        Reef        Cliff
                  │
                  ▼
            Primary Scatter
          Rock / Large Coral
                  │
                  ▼
           Secondary Scatter
        Small Coral / Pebbles
                  │
                  ▼
             Decoration
          Seaweed / Shells
                  │
                  ▼
                 LOD
                  │
                  ▼
              Rendering
```

그리고 이 구조의 가장 큰 장점은 **`seed` 하나만 바꿔도 새로운 해저 세계가 만들어진다**는 것입니다.

```yaml
world:
  seed: 20260906

terrain:
  roughness: 0.35
  relief: 0.65
  valley_width: 0.7

reef:
  density: 0.35
  clustering: 0.8

rock:
  density: 0.25

open_space:
  ratio: 0.55
```

이 정도 파라미터만 가지고도 다양한 해저를 생성할 수 있습니다.

특히 지금 목표라면 **Blender Geometry Nodes를 중심으로 `Height Map → Slope/Curvature → Biome Mask → Hierarchical Scatter`**를 만드는 방향을 추천합니다. 이후 물고기도 같은 방식으로 `Fish Species + School Size + Depth Range + Movement Path`를 procedural layer로 얹으면, 앞에서 만든 Low-Poly Great Barrier Reef 장면을 **seed만 바꿔 계속 생성할 수 있는 procedural underwater world**로 발전시킬 수 있습니다.