# Quiet Aquarium

A static, backend-free 3D aquarium scene. This is a single-context repo — see `web/src/`.

## Language

**Lobe**:
One half (upper or lower) of a fish's tail fin, each with its own root point and its own rim of geometry running from that root out to the tail's outer tip.
_Avoid_: Fan (that's a `style`, not a lobe), half, wing.

**Style** (tail fin):
Which silhouette a tail fin's two lobes take. `"fan"`: both lobes share one root at the body centerline, forming a single continuous paddle (e.g. clownfish, butterflyfish). `"fork"`: the lobes' roots separate, opening a real V-gap between two distinct pointed lobes (e.g. tangs, seabream); a deep `forkSpread` also stands in for a lunate silhouette rather than introducing a third style.
_Avoid_: Shape, type.

**Fork spread**:
For a `"fork"`-style tail fin, how far the two lobes' roots separate along the body's vertical axis, as a fraction of the fin's height. Zero means the roots coincide (visually identical to `"fan"`). Ignored for `"fan"`.
_Avoid_: Notch (the old name — described a single shared root nudged along x; renamed because the roots now genuinely separate, a different geometric idea).

**Tip color** / **tip band**:
An accent-colored band painted across the outer tip of a tail fin lobe, independent of the lobe's own `upperColor`/`lowerColor`. `tipBandWidth` controls how much of the lobe (as a fraction of its length, from the tip inward) the band covers; `tipColor` controls which palette color it uses, defaulting to `"accent"`.
_Avoid_: Trim, edge color.
