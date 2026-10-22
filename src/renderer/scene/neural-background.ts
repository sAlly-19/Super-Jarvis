import * as THREE from 'three'

interface NodeParticle {
  pos: THREE.Vector3
  vel: THREE.Vector3
  baseColor: THREE.Color
}

export class NeuralBackground {
  private scene: THREE.Scene
  private group: THREE.Group
  private isVisible: boolean = true

  // Particles
  private nodeCount: number = 130
  private nodes: NodeParticle[] = []
  private pointsMesh: THREE.Points | null = null

  // Connections (Synapses)
  private maxConnections: number = 700
  private connectDistance: number = 2.4
  private linesMesh: THREE.LineSegments | null = null
  private linePositions: Float32Array
  private lineColors: Float32Array
  private lineGeometry: THREE.BufferGeometry

  // 3D Bounds for particle circulation
  private bounds = {
    minX: -8.0,
    maxX: 8.0,
    minY: -5.0,
    maxY: 5.5,
    minZ: -9.0,
    maxZ: 0.5
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.name = 'NeuralBackground'
    this.scene.add(this.group)

    // Pre-allocate line buffers (2 vertices per segment, 3 floats each)
    this.linePositions = new Float32Array(this.maxConnections * 2 * 3)
    this.lineColors = new Float32Array(this.maxConnections * 2 * 4) // RGBA
    this.lineGeometry = new THREE.BufferGeometry()

    this.initNodes()
    this.initPoints()
    this.initLines()
  }

  private createGlowSpriteTexture(): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.25, 'rgba(244, 244, 245, 0.9)')
    gradient.addColorStop(0.55, 'rgba(161, 161, 170, 0.45)')
    gradient.addColorStop(1, 'rgba(24, 24, 27, 0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  private initNodes(): void {
    const palette = [
      new THREE.Color('#ffffff'), // Pure White
      new THREE.Color('#f4f4f5'), // Soft White
      new THREE.Color('#e4e4e7'), // Light Silver
      new THREE.Color('#d4d4d8'), // Silver
      new THREE.Color('#a1a1aa')  // Cool Gray
    ]

    for (let i = 0; i < this.nodeCount; i++) {
      const pos = new THREE.Vector3(
        this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX),
        this.bounds.minY + Math.random() * (this.bounds.maxY - this.bounds.minY),
        this.bounds.minZ + Math.random() * (this.bounds.maxZ - this.bounds.minZ)
      )

      // Random 3D drift velocity
      const speed = 0.003 + Math.random() * 0.006
      const theta = Math.random() * Math.PI * 2
      const phi = (Math.random() - 0.5) * Math.PI

      const vel = new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed,
        Math.sin(theta) * Math.cos(phi) * speed
      )

      const baseColor = palette[Math.floor(Math.random() * palette.length)].clone()

      this.nodes.push({ pos, vel, baseColor })
    }
  }

  private initPoints(): void {
    const positions = new Float32Array(this.nodeCount * 3)
    const colors = new Float32Array(this.nodeCount * 3)

    for (let i = 0; i < this.nodeCount; i++) {
      const node = this.nodes[i]
      positions[i * 3] = node.pos.x
      positions[i * 3 + 1] = node.pos.y
      positions[i * 3 + 2] = node.pos.z

      colors[i * 3] = node.baseColor.r
      colors[i * 3 + 1] = node.baseColor.g
      colors[i * 3 + 2] = node.baseColor.b
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const spriteTexture = this.createGlowSpriteTexture()
    const material = new THREE.PointsMaterial({
      size: 0.18,
      map: spriteTexture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    this.pointsMesh = new THREE.Points(geometry, material)
    this.group.add(this.pointsMesh)
  }

  private initLines(): void {
    this.lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage)
    )
    this.lineGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.lineColors, 4).setUsage(THREE.DynamicDrawUsage)
    )

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    this.linesMesh = new THREE.LineSegments(this.lineGeometry, material)
    this.group.add(this.linesMesh)
  }

  /**
   * Main per-frame update loop (called at 60 FPS)
   */
  public update(_delta: number, _time: number, isSpeaking: boolean = false): void {
    if (!this.isVisible || !this.pointsMesh) return

    const speedMultiplier = isSpeaking ? 1.35 : 1.0

    // 1. Move nodes & wrap around bounds
    const positionsAttr = this.pointsMesh.geometry.attributes.position as THREE.BufferAttribute
    const posArr = positionsAttr.array as Float32Array

    for (let i = 0; i < this.nodeCount; i++) {
      const node = this.nodes[i]
      node.pos.x += node.vel.x * speedMultiplier
      node.pos.y += node.vel.y * speedMultiplier
      node.pos.z += node.vel.z * speedMultiplier

      // Boundary wrapping with smooth loop
      if (node.pos.x < this.bounds.minX) node.pos.x = this.bounds.maxX
      else if (node.pos.x > this.bounds.maxX) node.pos.x = this.bounds.minX

      if (node.pos.y < this.bounds.minY) node.pos.y = this.bounds.maxY
      else if (node.pos.y > this.bounds.maxY) node.pos.y = this.bounds.minY

      if (node.pos.z < this.bounds.minZ) node.pos.z = this.bounds.maxZ
      else if (node.pos.z > this.bounds.maxZ) node.pos.z = this.bounds.minZ

      posArr[i * 3] = node.pos.x
      posArr[i * 3 + 1] = node.pos.y
      posArr[i * 3 + 2] = node.pos.z
    }
    positionsAttr.needsUpdate = true

    // 2. Connect neighboring nodes (Synapses)
    let connectionIdx = 0
    const maxConn = this.maxConnections
    const connectDistSq = this.connectDistance * this.connectDistance

    for (let i = 0; i < this.nodeCount; i++) {
      const nodeA = this.nodes[i]

      for (let j = i + 1; j < this.nodeCount; j++) {
        const nodeB = this.nodes[j]
        const dx = nodeA.pos.x - nodeB.pos.x
        const dy = nodeA.pos.y - nodeB.pos.y
        const dz = nodeA.pos.z - nodeB.pos.z
        const distSq = dx * dx + dy * dy + dz * dz

        if (distSq < connectDistSq) {
          const dist = Math.sqrt(distSq)
          const alpha = (1.0 - dist / this.connectDistance) * (isSpeaking ? 0.70 : 0.45)

          const pIdx = connectionIdx * 6
          const cIdx = connectionIdx * 8

          // Vertex 1
          this.linePositions[pIdx] = nodeA.pos.x
          this.linePositions[pIdx + 1] = nodeA.pos.y
          this.linePositions[pIdx + 2] = nodeA.pos.z

          this.lineColors[cIdx] = nodeA.baseColor.r
          this.lineColors[cIdx + 1] = nodeA.baseColor.g
          this.lineColors[cIdx + 2] = nodeA.baseColor.b
          this.lineColors[cIdx + 3] = alpha

          // Vertex 2
          this.linePositions[pIdx + 3] = nodeB.pos.x
          this.linePositions[pIdx + 4] = nodeB.pos.y
          this.linePositions[pIdx + 5] = nodeB.pos.z

          this.lineColors[cIdx + 4] = nodeB.baseColor.r
          this.lineColors[cIdx + 5] = nodeB.baseColor.g
          this.lineColors[cIdx + 6] = nodeB.baseColor.b
          this.lineColors[cIdx + 7] = alpha

          connectionIdx++
          if (connectionIdx >= maxConn) break
        }
      }
      if (connectionIdx >= maxConn) break
    }

    // Update line buffer geometry
    const linePosAttr = this.lineGeometry.attributes.position as THREE.BufferAttribute
    const lineColAttr = this.lineGeometry.attributes.color as THREE.BufferAttribute

    linePosAttr.needsUpdate = true
    lineColAttr.needsUpdate = true
    this.lineGeometry.setDrawRange(0, connectionIdx * 2)
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible
    this.group.visible = visible
    console.log(`[NeuralBackground] Visibility set to: ${visible}`)
  }

  public getVisible(): boolean {
    return this.isVisible
  }

  public destroy(): void {
    this.scene.remove(this.group)
    this.pointsMesh?.geometry.dispose()
    ;(this.pointsMesh?.material as THREE.Material)?.dispose()
    this.lineGeometry.dispose()
    ;(this.linesMesh?.material as THREE.Material)?.dispose()
  }
}
