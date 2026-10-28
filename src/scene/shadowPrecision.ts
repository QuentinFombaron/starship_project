import * as THREE from 'three'

// three.js looks up directional shadows from the float32 world position. The replay world is
// Earth-centred (~6.4e6 m from the origin), where float32 is only good to ~0.5 m, coarser than a
// shadow texel: the hull's self-shadow jumps every frame and the light seems to blink.
// Look up from the camera-relative view position instead (precise, since modelViewMatrix is built
// in float64 on the CPU), with the shadow matrix pre-multiplied by the camera's world matrix.
// Imported for its side effects by every Canvas that renders shadows, before any shader compiles.

const SHADOW_FROM_WORLD =
  'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );'
const SHADOW_FROM_VIEW =
  'shadowWorldPosition = mvPosition + viewMatrix * vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0.0 );'

const chunk = THREE.ShaderChunk.shadowmap_vertex
if (chunk.includes(SHADOW_FROM_WORLD)) {
  THREE.ShaderChunk.shadowmap_vertex = chunk.replace(SHADOW_FROM_WORLD, SHADOW_FROM_VIEW)
  // DirectionalLightShadow isn't exported, so reach its prototype through an instance
  const proto = Object.getPrototypeOf(new THREE.DirectionalLight().shadow) as {
    matrix: THREE.Matrix4
    updateMatrices(light: THREE.Light, camera: THREE.Camera): void
  }
  const updateMatrices = proto.updateMatrices
  proto.updateMatrices = function (light, camera) {
    updateMatrices.call(this, light, camera)
    this.matrix.multiply(camera.matrixWorld)
  }
} else if (!chunk.includes(SHADOW_FROM_VIEW)) {
  console.warn('shadowPrecision: three.js shadowmap_vertex changed; precise shadow patch not applied')
}
