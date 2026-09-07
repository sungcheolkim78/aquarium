/**
 * Live per-species 3D preview for the species-info card. A second, tiny
 * renderer independent of the main scene — framed generically off each
 * species' own bounding sphere so it works for any of the four body plans
 * without per-geometry-kind camera logic.
 */

/**
 * Camera distance (along the view axis) so a sphere of `boundingRadius`
 * fits inside a `PerspectiveCamera`'s vertical field of view, with
 * `marginScale` extra breathing room (defaults to 1.5 = 50% margin).
 */
export function framingDistance(
  boundingRadius: number,
  fovDegrees: number,
  marginScale = 1.5,
): number {
  const halfAngleRadians = (fovDegrees * Math.PI) / 180 / 2;
  return (boundingRadius / Math.sin(halfAngleRadians)) * marginScale;
}
