import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { LipSyncTargets } from '../audio/lip-sync'

export type MoodType = 'neutral' | 'surprised' | 'focused' | 'thoughtful' | 'friendly'

interface MorphTargetMap {
  [name: string]: number
}

/**
 * Creates a high-fidelity physical material for the eyes that transforms the
 * iris into authentic VS Code blue (#007acc / #0098ff) with a dark pupil,
 * clean white sclera, and subtle cyber glow compatible with bloom post-processing.
 */
function createVsCodeEyeMaterial(baseMat: THREE.Material): THREE.MeshPhysicalMaterial {
  const source = baseMat as THREE.MeshStandardMaterial
  const eyeMat = new THREE.MeshPhysicalMaterial({
    map: source.map,
    roughness: 0.10,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    reflectivity: 0.85
  })

  eyeMat.onBeforeCompile = (shader) => {
    // 1. Declare glow variable in shader main
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
      void main() {
        float vEyeIrisGlow = 0.0;
      `
    )

    // 2. Modify map fragment: recolor iris to VS Code blue while preserving pupil & sclera
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      #ifdef USE_MAP
        vec3 baseTexCol = diffuseColor.rgb;
        float lum = dot(baseTexCol, vec3(0.299, 0.587, 0.114));

        // Detect iris zone by luminance: pupil is very dark (<0.14), sclera is bright (>0.64)
        float isIris = smoothstep(0.12, 0.22, lum) * (1.0 - smoothstep(0.60, 0.72, lum));
        vEyeIrisGlow = isIris;

        // VS Code signature blue palette:
        // Deep blue #003e6b, Core VS Code blue #007acc, Vibrant accent #0098ff
        vec3 vscodeDeep = vec3(0.0, 0.26, 0.52);
        vec3 vscodeBlue = vec3(0.0, 0.478, 0.80);
        vec3 vscodeBright = vec3(0.0, 0.596, 1.0);

        float irisGrad = clamp((lum - 0.18) / 0.44, 0.0, 1.0);
        vec3 blueIris = mix(vscodeDeep, mix(vscodeBlue, vscodeBright, irisGrad), irisGrad);

        // Clean white sclera with subtle cool cyber tint
        vec3 whiteSclera = vec3(0.94, 0.96, 1.0) * (lum / 0.80);

        // Deep black/navy pupil
        vec3 darkPupil = vec3(0.015, 0.025, 0.05);

        if (lum < 0.14) {
          diffuseColor.rgb = darkPupil;
        } else if (lum > 0.64) {
          diffuseColor.rgb = min(vec3(1.0), whiteSclera);
        } else {
          diffuseColor.rgb = blueIris;
        }
      #endif
      `
    )

    // 3. Add subtle emissive bloom glow to the iris
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      #ifdef USE_MAP
        totalEmissiveRadiance += vec3(0.0, 0.478, 0.80) * vEyeIrisGlow * 0.35;
      #endif
      `
    )
  }

  return eyeMat
}

export function buildMorphCacheMap(morphDictionary: MorphTargetMap): Map<string, number> {
  const map = new Map<string, number>()
  for (const [key, idx] of Object.entries(morphDictionary)) {
    map.set(key, idx)
    map.set(key.toLowerCase(), idx)

    if (key.endsWith('_L')) {
      const alt = key.slice(0, -2) + 'Left'
      map.set(alt, idx)
      map.set(alt.toLowerCase(), idx)
    } else if (key.endsWith('_R')) {
      const alt = key.slice(0, -2) + 'Right'
      map.set(alt, idx)
      map.set(alt.toLowerCase(), idx)
    } else if (key.endsWith('Left')) {
      const alt = key.slice(0, -4) + '_L'
      map.set(alt, idx)
      map.set(alt.toLowerCase(), idx)
    } else if (key.endsWith('Right')) {
      const alt = key.slice(0, -5) + '_R'
      map.set(alt, idx)
      map.set(alt.toLowerCase(), idx)
    }
  }
  return map
}

export class AvatarController {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private modelRoot: THREE.Group | null = null
  private headMesh: THREE.Mesh | null = null
  private morphDictionary: MorphTargetMap = {}
  private morphInfluences: number[] | null = null
  private morphCache: Map<string, number> = new Map()

  // Procedural Nodes
  private grpTransform: THREE.Object3D | null = null
  private grpEyeLeft: THREE.Object3D | null = null
  private grpEyeRight: THREE.Object3D | null = null

  // Base transforms
  private baseTransformPos = new THREE.Vector3()
  private baseTransformRot = new THREE.Euler()
  private baseEyeLeftRot = new THREE.Euler()
  private baseEyeRightRot = new THREE.Euler()

  // Saccade & Eye dynamics
  private targetEyeYaw = 0
  private targetEyePitch = 0
  private currentEyeYaw = 0
  private currentEyePitch = 0
  private nextSaccadeTime = 0

  // Blinking state
  private isBlinking = false
  private blinkProgress = 0
  private blinkDuration = 0.16 // seconds
  private nextBlinkTime = 0

  // Mood state
  private currentMood: MoodType = 'neutral'
  private moodWeights: Record<string, number> = {}
  private targetMoodWeights: Record<string, number> = {}

  // Mouse eye interaction
  private isEyeTrackingEnabled = true
  private targetMouseEyeYaw = 0
  private targetMouseEyePitch = 0
  private currentMouseEyeYaw = 0
  private currentMouseEyePitch = 0

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene
    this.renderer = renderer
    this.setupMouseTracking()
  }

  public async loadModel(modelUrl?: string): Promise<void> {
    const isHttp = typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    let finalUrl = modelUrl || (isHttp ? '/models/facecap.glb' : './models/facecap.glb')
    if (!isHttp && finalUrl.startsWith('/')) {
      finalUrl = `.${finalUrl}`
    }
    console.log(`[AvatarController] Loading model from ${finalUrl}...`)

    const gltfLoader = new GLTFLoader()

    return new Promise((resolve, reject) => {
      gltfLoader.load(
        finalUrl,
        (gltf) => {
          this.modelRoot = gltf.scene
          this.scene.add(this.modelRoot)

          // Center and adjust initial orientation
          this.modelRoot.position.set(0, 0.10, 0)
          this.modelRoot.scale.set(0.70, 0.75, 0.70)

          // Create specialized materials for stylized avatar aesthetics:
          // 1. Head: Pure white porcelain / sleek matte android finish
          const headMaterial = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#ffffff'),
            roughness: 0.54,
            metalness: 0.02,
            clearcoat: 0.08,
            clearcoatRoughness: 0.25,
            reflectivity: 0.5
          })

          // 2. Teeth: Clean crisp white
          const teethMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#d1d6c1'),
            roughness: 0.20,
            metalness: 0.05
          })

          // 3. Eyes: VS Code Blue (#007acc) with subtle cyber glow and glass cornea
          const eyeLeftMaterial = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#007acc'),
            emissive: new THREE.Color('#0055aa'),
            emissiveIntensity: 0.65,
            roughness: 0.12,
            metalness: 0.25,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05
          })
          const eyeRightMaterial = eyeLeftMaterial.clone()

          // Find head mesh, eyes, teeth and specific nodes
          this.modelRoot.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh
              const parentName = child.parent?.name || ''
              const grandParentName = child.parent?.parent?.name || ''

              if (mesh.morphTargetInfluences && mesh.morphTargetDictionary) {
                this.headMesh = mesh
                this.morphDictionary = mesh.morphTargetDictionary
                this.morphInfluences = mesh.morphTargetInfluences
                this.buildMorphCache()
                mesh.material = headMaterial
                console.log(
                  `[AvatarController] Found head mesh with ${Object.keys(this.morphDictionary).length} blendshapes. Applied pure white material.`,
                  Object.keys(this.morphDictionary)
                )
              } else if (
                child.name === 'eyeLeft' ||
                parentName === 'eyeLeft' ||
                grandParentName === 'grp_eyeLeft'
              ) {
                mesh.material = createVsCodeEyeMaterial(mesh.material as THREE.Material)
                console.log('[AvatarController] Applied VS Code blue material to left eye mesh.')
              } else if (
                child.name === 'eyeRight' ||
                parentName === 'eyeRight' ||
                grandParentName === 'grp_eyeRight'
              ) {
                mesh.material = createVsCodeEyeMaterial(mesh.material as THREE.Material)
                console.log('[AvatarController] Applied VS Code blue material to right eye mesh.')
              } else if (
                child.name === 'teeth' ||
                parentName === 'teeth'
              ) {
                mesh.material = teethMaterial
                console.log('[AvatarController] Applied crisp white material to teeth mesh.')
              }
            }

            if (child.name === 'grp_transform') {
              this.grpTransform = child
              this.baseTransformPos.copy(child.position)
              this.baseTransformRot.copy(child.rotation)
            }
            if (child.name === 'grp_eyeLeft') {
              this.grpEyeLeft = child
              this.baseEyeLeftRot.copy(child.rotation)
            }
            if (child.name === 'grp_eyeRight') {
              this.grpEyeRight = child
              this.baseEyeRightRot.copy(child.rotation)
            }
          })

          // Setup initial timers
          const now = performance.now() / 1000
          this.nextBlinkTime = now + 3 + Math.random() * 2
          this.nextSaccadeTime = now + 1.5 + Math.random() * 1.5

          console.log('[AvatarController] Avatar model loaded successfully.')
          resolve()
        },
        undefined,
        (error) => {
          console.error('[AvatarController] Error loading GLB avatar:', error)
          reject(error)
        }
      )
    })
  }

  private setupMouseTracking(): void {
    window.addEventListener('mousemove', (e) => {
      if (!this.isEyeTrackingEnabled) {
        this.targetMouseEyeYaw = 0
        this.targetMouseEyePitch = 0
        return
      }

      const normX = (e.clientX / window.innerWidth) * 2 - 1
      const normY = (e.clientY / window.innerHeight) * 2 - 1

      // Horizontal yaw: left/right tracking
      this.targetMouseEyeYaw = normX * 0.22

      // Vertical pitch:
      // normY = -1 (mouse at top) => pitch should look UP (+pitch)
      // normY = +1 (mouse at bottom) => pitch should look DOWN (-pitch)
      // Provide full responsive amplitude when looking towards the top:
      if (normY < 0) {
        // Upper region of screen: lift eyes up responsively
        this.targetMouseEyePitch = -normY * 0.25
      } else {
        // Lower region of screen: look down naturally
        this.targetMouseEyePitch = -normY * 0.20
      }
    })
  }

  public setEyeTrackingEnabled(enabled: boolean): void {
    this.isEyeTrackingEnabled = enabled
    if (!enabled) {
      this.targetMouseEyeYaw = 0
      this.targetMouseEyePitch = 0
    }
  }

  public getEyeTrackingEnabled(): boolean {
    return this.isEyeTrackingEnabled
  }

  private buildMorphCache(): void {
    this.morphCache = buildMorphCacheMap(this.morphDictionary)
  }

  /**
   * O(1) high-performance setter for morph targets supporting ARKit blendshape naming variations
   */
  public setMorphTarget(name: string, value: number): void {
    if (!this.morphInfluences) return

    let idx = this.morphCache.get(name)
    if (idx === undefined) {
      idx = this.morphCache.get(name.toLowerCase())
    }

    if (idx !== undefined) {
      this.morphInfluences[idx] = value
    }
  }

  public getMorphTarget(name: string): number {
    if (!this.morphInfluences) return 0
    let idx = this.morphCache.get(name)
    if (idx === undefined) {
      idx = this.morphCache.get(name.toLowerCase())
    }
    return idx !== undefined ? this.morphInfluences[idx] : 0
  }

  /**
   * Directly sets jaw/mouth opening (used for offline speech fallback)
   */
  public setMouthOpen(value: number): void {
    this.setMorphTarget('jawOpen', Math.min(0.5, Math.max(0, value)))
  }

  /**
   * Sets emotional mood state with smooth blendshape offsets
   */
  public setMood(mood: MoodType): void {
    this.currentMood = mood
    console.log(`[AvatarController] Transitioning to mood: ${mood}`)

    // Reset target mood weights
    this.targetMoodWeights = {}

    switch (mood) {
      case 'surprised':
        this.targetMoodWeights['browInnerUp'] = 0.55
        this.targetMoodWeights['browOuterUpLeft'] = 0.4
        this.targetMoodWeights['browOuterUpRight'] = 0.4
        this.targetMoodWeights['eyeWideLeft'] = 0.35
        this.targetMoodWeights['eyeWideRight'] = 0.35
        this.targetMoodWeights['jawOpen'] = 0.08
        break
      case 'focused':
        this.targetMoodWeights['browDownLeft'] = 0.4
        this.targetMoodWeights['browDownRight'] = 0.4
        this.targetMoodWeights['eyeSquintLeft'] = 0.35
        this.targetMoodWeights['eyeSquintRight'] = 0.35
        break
      case 'thoughtful':
        this.targetMoodWeights['browDownLeft'] = 0.45
        this.targetMoodWeights['browInnerUp'] = 0.3
        this.targetMoodWeights['mouthPucker'] = 0.15
        this.targetMoodWeights['mouthRollLower'] = 0.12
        break
      case 'friendly':
        this.targetMoodWeights['mouthSmileLeft'] = 0.4
        this.targetMoodWeights['mouthSmileRight'] = 0.4
        this.targetMoodWeights['cheekSquintLeft'] = 0.25
        this.targetMoodWeights['cheekSquintRight'] = 0.25
        this.targetMoodWeights['browInnerUp'] = 0.15
        break
      case 'neutral':
      default:
        // All zeros
        break
    }
  }

  public getMood(): MoodType {
    return this.currentMood
  }

  /**
   * Main per-frame update loop (called at 60 FPS)
   */
  public update(delta: number, time: number, lipSync: LipSyncTargets): void {
    if (!this.modelRoot || !this.morphInfluences) return

    // 1. Procedural Breathing (on grp_transform)
    if (this.grpTransform) {
      const breath = Math.sin(time * 1.8)
      this.grpTransform.position.y = this.baseTransformPos.y + breath * 0.002
      this.grpTransform.rotation.x = this.baseTransformRot.x + breath * 0.005
      // Head stays still, no mouse movement on head
      this.grpTransform.rotation.y = this.baseTransformRot.y
      this.grpTransform.rotation.z = this.baseTransformRot.z
    }

    // 2. Procedural Eye Saccades + Mouse Eye Tracking (on grp_eyeLeft and grp_eyeRight)
    if (time >= this.nextSaccadeTime) {
      this.targetEyeYaw = (Math.random() - 0.5) * 0.05
      this.targetEyePitch = (Math.random() - 0.5) * 0.03
      this.nextSaccadeTime = time + 1.2 + Math.random() * 2.5
    }

    this.currentEyeYaw += (this.targetEyeYaw - this.currentEyeYaw) * 0.15
    this.currentEyePitch += (this.targetEyePitch - this.currentEyePitch) * 0.15

    // Smooth lerp mouse eye gaze
    if (!this.isEyeTrackingEnabled) {
      this.targetMouseEyeYaw = 0
      this.targetMouseEyePitch = 0
    }

    this.currentMouseEyeYaw += (this.targetMouseEyeYaw - this.currentMouseEyeYaw) * 0.12
    this.currentMouseEyePitch += (this.targetMouseEyePitch - this.currentMouseEyePitch) * 0.12

    const totalEyeYaw = this.currentEyeYaw + this.currentMouseEyeYaw
    const totalEyePitch = this.currentEyePitch + this.currentMouseEyePitch

    // Rotate the eyeball nodes (grp_eyeLeft and grp_eyeRight) along the correct axes
    // In facecap.glb, parent grp_scale has a +90 deg rotation on X.
    // The base pose in this GLB has a -0.146 rad downward bias. By applying a -0.146 rad correction,
    // the neutral gaze points straight forward at the camera.
    // - Local Z controls horizontal eye rotation (-yaw looks Right, +yaw looks Left in World space)
    // - Local X controls vertical eye rotation (-pitch looks Up, +pitch looks Down in World space)
    // - Local Y controls roll (twist), which must remain at baseEyeRot.y!
    const basePitchOffset = -0.146
    if (this.grpEyeLeft) {
      this.grpEyeLeft.rotation.z = this.baseEyeLeftRot.z - totalEyeYaw
      this.grpEyeLeft.rotation.x = this.baseEyeLeftRot.x + basePitchOffset - totalEyePitch
      this.grpEyeLeft.rotation.y = this.baseEyeLeftRot.y
    }
    if (this.grpEyeRight) {
      this.grpEyeRight.rotation.z = this.baseEyeRightRot.z - totalEyeYaw
      this.grpEyeRight.rotation.x = this.baseEyeRightRot.x + basePitchOffset - totalEyePitch
      this.grpEyeRight.rotation.y = this.baseEyeRightRot.y
    }

    // ARKit Eye gaze blendshapes - natural eyelid follow-through
    const eyelidYawWeight = Math.min(0.20, Math.abs(totalEyeYaw) * 0.7)

    if (totalEyeYaw > 0) {
      // Looking Right: Left eye (viewer's left) turns IN to nose, Right eye (viewer's right) turns OUT
      this.setMorphTarget('eyeLookIn_L', eyelidYawWeight)
      this.setMorphTarget('eyeLookOut_R', eyelidYawWeight)
      this.setMorphTarget('eyeLookOut_L', 0)
      this.setMorphTarget('eyeLookIn_R', 0)
    } else {
      // Looking Left: Left eye (viewer's left) turns OUT, Right eye (viewer's right) turns IN to nose
      this.setMorphTarget('eyeLookOut_L', eyelidYawWeight)
      this.setMorphTarget('eyeLookIn_R', eyelidYawWeight)
      this.setMorphTarget('eyeLookIn_L', 0)
      this.setMorphTarget('eyeLookOut_R', 0)
    }

    if (totalEyePitch > 0) {
      // Looking Up: Raise upper eyelids naturally and subtly widen eyes so pupil is fully visible
      const eyelidUpWeight = Math.min(0.42, totalEyePitch * 1.6)
      this.setMorphTarget('eyeLookUp_L', eyelidUpWeight)
      this.setMorphTarget('eyeLookUp_R', eyelidUpWeight)
      this.setMorphTarget('eyeWide_L', eyelidUpWeight * 0.35)
      this.setMorphTarget('eyeWide_R', eyelidUpWeight * 0.35)
      this.setMorphTarget('eyeLookDown_L', 0)
      this.setMorphTarget('eyeLookDown_R', 0)
    } else {
      // Looking Down: Eyelids follow Down naturally
      const eyelidDownWeight = Math.min(0.35, Math.abs(totalEyePitch) * 1.5)
      this.setMorphTarget('eyeLookDown_L', eyelidDownWeight)
      this.setMorphTarget('eyeLookDown_R', eyelidDownWeight)
      this.setMorphTarget('eyeLookUp_L', 0)
      this.setMorphTarget('eyeLookUp_R', 0)
      this.setMorphTarget('eyeWide_L', 0)
      this.setMorphTarget('eyeWide_R', 0)
    }

    // 3. Natural Eye Blinking (ARKit eyeBlinkLeft / eyeBlinkRight)
    let blinkWeight = 0
    if (!this.isBlinking && time >= this.nextBlinkTime) {
      this.isBlinking = true
      this.blinkProgress = 0
    }

    if (this.isBlinking) {
      this.blinkProgress += delta / this.blinkDuration
      if (this.blinkProgress >= 1) {
        this.isBlinking = false
        blinkWeight = 0
        this.nextBlinkTime = time + 3.0 + Math.random() * 3.5
      } else {
        // Sine curve for smooth lid closing and opening
        blinkWeight = Math.sin(this.blinkProgress * Math.PI)
      }
    }

    this.setMorphTarget('eyeBlinkLeft', blinkWeight)
    this.setMorphTarget('eyeBlinkRight', blinkWeight)
    this.setMorphTarget('eyeBlink_L', blinkWeight)
    this.setMorphTarget('eyeBlink_R', blinkWeight)

    // 4. Update Mood Blendshapes with smooth lerping
    for (const key in this.targetMoodWeights) {
      const target = this.targetMoodWeights[key] || 0
      const curr = this.moodWeights[key] || 0
      this.moodWeights[key] = curr + (target - curr) * 0.08
    }
    // Decay unselected mood keys
    for (const key in this.moodWeights) {
      if (this.targetMoodWeights[key] === undefined) {
        this.moodWeights[key] = (this.moodWeights[key] || 0) * 0.9
      }
    }

    for (const [key, val] of Object.entries(this.moodWeights)) {
      this.setMorphTarget(key, val)
    }

    // 5. Apply Real-time Lip-Sync Blendshapes (proportional and natural)
    // Conversational speech jaw opening capped at 0.22 to prevent gaping mouth
    const jawTotal = Math.min(0.22, lipSync.jawOpen)
    this.setMorphTarget('jawOpen', jawTotal)
    this.setMorphTarget('mouthFunnel', lipSync.mouthFunnel)
    this.setMorphTarget('mouthPucker', Math.max(lipSync.mouthPucker, this.moodWeights['mouthPucker'] || 0))
    this.setMorphTarget('mouthClose', lipSync.mouthClose)

    this.setMorphTarget('mouthStretchLeft', lipSync.mouthStretchLeft)
    this.setMorphTarget('mouthStretchRight', lipSync.mouthStretchRight)
    this.setMorphTarget('mouthStretch_L', lipSync.mouthStretchLeft)
    this.setMorphTarget('mouthStretch_R', lipSync.mouthStretchRight)

    const smileLeft = Math.max(lipSync.mouthSmileLeft, this.moodWeights['mouthSmileLeft'] || 0)
    const smileRight = Math.max(lipSync.mouthSmileRight, this.moodWeights['mouthSmileRight'] || 0)
    this.setMorphTarget('mouthSmileLeft', smileLeft)
    this.setMorphTarget('mouthSmileRight', smileRight)
    this.setMorphTarget('mouthSmile_L', smileLeft)
    this.setMorphTarget('mouthSmile_R', smileRight)
  }
}

