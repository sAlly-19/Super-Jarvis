import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  container: HTMLElement
  render: () => void
  setBloomEnabled: (enabled: boolean) => void
  isBloomEnabled: () => boolean
}

export function createScene(container: HTMLElement): SceneContext {
  // 1. Scene
  const scene = new THREE.Scene()

  // 2. Camera: Framed comfortably for the facecap avatar
  const width = container.clientWidth || window.innerWidth
  const height = container.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50)
  // Set camera back so entire face is perfectly centered and visible without covering HUD components
  camera.position.set(0, 0.22, 3.25)

  // 3. Renderer with high visual fidelity and ACESFilmic tone mapping
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.outputColorSpace = THREE.SRGBColorSpace

  container.appendChild(renderer.domElement)

  // Post-processing Bloom setup
  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.45,  // strength
    0.35,  // radius
    0.82   // threshold
  )
  composer.addPass(bloomPass)

  let bloomActive = true

  // 4. Studio Lighting setup balanced for monochromatic white android & silver glow aesthetics
  const ambientLight = new THREE.AmbientLight(0x27272a, 1.25)
  scene.add(ambientLight)

  // Soft key light from upper right
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  keyLight.position.set(1.5, 2.0, 2.0)
  scene.add(keyLight)

  // Neutral silver fill light from left
  const fillLight = new THREE.DirectionalLight(0xa1a1aa, 1.0)
  fillLight.position.set(-1.8, 0.5, 1.5)
  scene.add(fillLight)

  // Pure White Rim light on left silhouette
  const rimLeft = new THREE.DirectionalLight(0xffffff, 1.8)
  rimLeft.position.set(-2.4, 0.8, -1.8)
  scene.add(rimLeft)

  // Silver Rim light on right silhouette
  const rimRight = new THREE.DirectionalLight(0xd4d4d8, 1.8)
  rimRight.position.set(2.4, 0.8, -1.8)
  scene.add(rimRight)

  // Subtle bottom bounce light
  const bounceLight = new THREE.DirectionalLight(0x71717a, 0.5)
  bounceLight.position.set(0, -2.0, 1.0)
  scene.add(bounceLight)

  // 5. Interactive OrbitControls (user can rotate with mouse drag, zoom with wheel)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.target.set(0, 0.22, 0)
  controls.minDistance = 1.6
  controls.maxDistance = 5.0
  controls.maxPolarAngle = Math.PI / 2 + 0.15
  controls.minPolarAngle = Math.PI / 4
  controls.update()

  // 6. Automatic Resize Handler
  const onResize = (): void => {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
    bloomPass.resolution.set(w, h)
  }

  window.addEventListener('resize', onResize)

  const render = (): void => {
    if (bloomActive) {
      composer.render()
    } else {
      renderer.render(scene, camera)
    }
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    container,
    render,
    setBloomEnabled: (enabled: boolean) => {
      bloomActive = enabled
    },
    isBloomEnabled: () => bloomActive
  }
}
