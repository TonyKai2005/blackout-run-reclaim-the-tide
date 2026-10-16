import * as pc from 'playcanvas';

export type WorldAction =
  | { type: 'interact'; id: string }
  | { type: 'talk'; id: string; name: string }
  | { type: 'drop'; id: string }
  | { type: 'recover'; id: string }
  | { type: 'shoot'; id: string; weapon: 'Pod Burst' | 'Seed Repeater' }
  | { type: 'fire'; weapon: 'Pod Burst' | 'Seed Repeater' }
  | { type: 'damage'; amount: number }
  | { type: 'footstep' }
  | { type: 'drone' }
  | { type: 'weapon'; weapon: 'Pod Burst' | 'Seed Repeater' };

export interface WorldPose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
}

export interface WorldLabel {
  id: string;
  text: string;
  kind: 'threat' | 'crew';
  x: number;
  y: number;
  opacity: number;
}

export interface BotSnapshot {
  id: string;
  position: [number, number, number];
  index: number;
  stun: number;
  attackCooldown: number;
}

export interface WorldItemView {
  status: 'world' | 'held' | 'installed' | 'delivered' | 'processed';
  position?: [number, number, number] | { x: number; y: number; z: number };
}

export interface WorldView {
  phase: number;
  items: Record<string, WorldItemView>;
  targetId: string | null;
  canInteractTarget: boolean;
  sorterOnline: boolean;
  waterOnline: boolean;
  windOnline: boolean;
  bossLeftDown: boolean;
  bossRightDown: boolean;
  captured: boolean;
  repeaterAvailable: boolean;
}

const V = (x: number, y: number, z: number) => new pc.Vec3(x, y, z);

// Every location is on the same walkable island slab. The straightforward route is intentional.
export const WORLD_POINTS: Record<string, pc.Vec3> = {
  spawn: V(0, 1.0, 31),
  battery: V(-18, 1.0, 13),
  grid_socket: V(-6, 1.2, 13),
  sorter_jam: V(-19, 1.0, -4),
  waste_a: V(-22, 1.0, 12),
  waste_b: V(-27, 1.0, -22),
  sorter_chute: V(-15, 1.2, -6),
  sorter_switch: V(-11, 1.2, -2),
  comms_switch: V(5, 1.2, 14),
  intake_a: V(25, 1.0, -16),
  intake_b: V(12, 1.0, -19),
  filter_frame: V(22, 1.0, 3),
  filter_cartridge: V(23, 1.0, 9),
  filter_socket: V(18, 1.2, -8),
  water_switch: V(15, 1.2, -4),
  wind_converter: V(-12, 1.0, -18),
  wind_socket: V(-3, 1.2, -27),
  wind_switch: V(3, 1.2, -27),
  boss_node_left: V(11, 2.45, -24.7),
  boss_node_right: V(15, 2.45, -24.7),
  capture_switch: V(13, 1.2, -19),
  extraction: V(0, 1.0, 34)
};

const ITEM_MODELS: Record<string, string> = {
  battery: 'BatteryModule', waste_a: 'WasteBundle', waste_b: 'WasteBundle',
  filter_frame: 'FilterFrame', filter_cartridge: 'IntakeFilter', wind_converter: 'WindModule'
};

const ITEM_SIZE: Record<string, number> = {
  battery: 0.85, waste_a: 0.85, waste_b: 0.85,
  filter_frame: 1.1, filter_cartridge: 0.6, wind_converter: 0.72
};

const hex = (color: number) => new pc.Color(
  ((color >> 16) & 255) / 255,
  ((color >> 8) & 255) / 255,
  (color & 255) / 255
);

function material(color: number, gloss = 0.35, metalness = 0, emissive = 0): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  mat.diffuse = hex(color);
  mat.useMetalness = true;
  mat.metalness = metalness;
  mat.gloss = gloss;
  if (emissive) {
    mat.emissive = hex(color);
    mat.emissiveIntensity = emissive;
  }
  mat.update();
  return mat;
}

function transparent(color: number, opacity: number, emissive = 0): pc.StandardMaterial {
  const mat = material(color, 0.65, 0, emissive);
  mat.opacity = opacity;
  mat.blendType = pc.BLEND_NORMAL;
  mat.depthWrite = false;
  mat.update();
  return mat;
}

interface Bot {
  id: string;
  entity: pc.Entity;
  home: pc.Vec3;
  path: pc.Vec3[];
  index: number;
  stun: number;
  attackCooldown: number;
  bob: number;
  eye: pc.Entity;
}

type CrewMode = 'walk' | 'inspect' | 'idle' | 'signal';
type CrewJoint = { entity: pc.Entity; base: pc.Vec3 };

interface CrewRig {
  head: CrewJoint;
  torso: CrewJoint;
  leftArm: CrewJoint;
  rightArm: CrewJoint;
  leftLeg: CrewJoint;
  rightLeg: CrewJoint;
}

interface CrewMember {
  id: string;
  label: string;
  entity: pc.Entity;
  waypoints: pc.Vec3[];
  waypointIndex: number;
  mode: CrewMode;
  timeLeft: number;
  motion: number;
  speed: number;
  heading: number;
  seed: number;
  rig: CrewRig | null;
}

interface Pulse {
  entity: pc.Entity;
  ttl: number;
  velocity: pc.Vec3;
  baseScale: number;
}

export class World3D {
  readonly app: pc.Application;
  readonly canvas: HTMLCanvasElement;
  readonly camera: pc.Entity;
  readonly player: pc.Entity;
  readonly onAction: (action: WorldAction) => void;
  private readonly playerVisual: pc.Entity;
  private playerRig: CrewRig | null = null;
  private playerMotion = 0;
  private readonly solid = material(0xe5e8df, 0.27, 0.06);
  private readonly dockMaterial = material(0xc7d2cc, 0.4, 0.04);
  private readonly dark = material(0x233a43, 0.42, 0.42);
  private readonly oxidized = material(0x8d6151, 0.24, 0.55);
  private readonly yellow = material(0xf5bd43, 0.46, 0.08);
  private readonly foliage = material(0x47816a, 0.26, 0.0);
  private readonly aqua = material(0x43babc, 0.62, 0.1, 0.08);
  private readonly activeLamp = material(0x91e6dd, 0.15, 0, 1.1);
  private readonly inactiveLamp = material(0x607b80, 0.2, 0.15);
  private readonly danger = material(0xf47948, 0.24, 0.15, 0.7);
  private readonly ocean = material(0x168aaf, 0.88, 0.02);
  private readonly foam = transparent(0xd9f9f3, 0.48);
  private readonly waterActive = transparent(0x68d6dc, 0.9, 0.3);
  private readonly waterInactive = transparent(0x388fa5, 0.78, 0.04);
  private readonly beaconMat = transparent(0x078da0, 0.62, 1.8);
  private readonly routeMat = transparent(0x087784, 0.78, 0.8);
  private readonly worldObjects = new Map<string, pc.Entity>();
  private readonly itemEntities = new Map<string, pc.Entity>();
  private readonly heldItemBodies = new Set<string>();
  private readonly itemSyncKeys = new Map<string, string>();
  private readonly modelAssets = new Map<string, pc.Asset>();
  private readonly serviceLamps = new Map<string, pc.Entity[]>();
  private readonly bots: Bot[] = [];
  private readonly crew: CrewMember[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly ripples: pc.Entity[] = [];
  private readonly turbineRotors: pc.Entity[] = [];
  private readonly routeMarks: pc.Entity[] = [];
  private readonly beltRollers: pc.Entity[] = [];
  private readonly weakpoints: pc.Entity[] = [];
  private readonly weaponMount: pc.Entity;
  private readonly weaponPlaceholders: Record<'Pod Burst' | 'Seed Repeater', pc.Entity>;
  private readonly beacon: pc.Entity;
  private readonly beam: pc.Entity;
  private poolWater!: pc.Entity;
  private readonly boss: pc.Entity;
  private readonly communityLamps: pc.Entity[] = [];
  private keys = new Set<string>();
  private active = false;
  private targetId: string | null = null;
  private canInteractTarget = false;
  private heldId: string | null = null;
  private phase = 1;
  private yaw = 0;
  private pitch = 0;
  private fireHeld = false;
  private fireCooldown = 0;
  private footstepClock = 0;
  private elapsed = 0;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private recoverCooldown = new Map<string, number>();
  private recoil = 0;
  private settings = { sensitivity: 1, fov: 82, reducedEffects: false };
  private weapon: 'Pod Burst' | 'Seed Repeater' = 'Pod Burst';
  private repeaterAvailable = false;

  constructor(app: pc.Application, canvas: HTMLCanvasElement, onAction: (action: WorldAction) => void) {
    this.app = app;
    this.canvas = canvas;
    this.onAction = onAction;
    app.scene.ambientLight = new pc.Color(0.36, 0.43, 0.48);
    app.scene.fog.type = pc.FOG_LINEAR;
    app.scene.fog.color = new pc.Color(0.65, 0.84, 0.91);
    app.scene.fog.start = 72;
    app.scene.fog.end = 245;
    app.scene.exposure = 0.84;
    const sun = new pc.Entity('Morning sun');
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.93, 0.75), intensity: 1.55, castShadows: true, shadowDistance: 72, shadowResolution: 1024 });
    sun.setEulerAngles(-48, -32, 0);
    app.root.addChild(sun);
    const fill = new pc.Entity('Sky fill');
    fill.addComponent('light', { type: 'directional', color: new pc.Color(0.62, 0.84, 1), intensity: 0.36 });
    fill.setEulerAngles(-25, 140, 0);
    app.root.addChild(fill);
    this.applyEnvironmentTextures();
    this.buildIsland();
    this.player = new pc.Entity('Engineer');
    this.player.setPosition(WORLD_POINTS.spawn);
    this.player.addComponent('collision', { type: 'capsule', radius: 0.38, height: 1.8 });
    this.player.addComponent('rigidbody', { type: 'dynamic', mass: 78, friction: 0.55, restitution: 0, linearDamping: 0.4, angularFactor: pc.Vec3.ZERO });
    app.root.addChild(this.player);
    this.playerVisual = new pc.Entity('Playable engineer appearance');
    this.player.addChild(this.playerVisual);
    this.playerVisual.setLocalPosition(0, -0.9, 0);
    const avatarFallback = this.buildCrewFallback(this.playerVisual, 0x55a48e);
    this.playerRig = avatarFallback.rig;
    this.model('EngineerPlayer', this.playerVisual, 1.84, V(0, 0, 0), V(0, 180, 0), [avatarFallback.visual], instance => {
      this.playerRig = this.findCrewRig(instance);
    }, true);
    this.camera = new pc.Entity('Third-person shoulder camera');
    this.camera.addComponent('camera', { clearColor: new pc.Color(0.59, 0.83, 0.94), farClip: 550, nearClip: 0.06, fov: this.settings.fov });
    app.root.addChild(this.camera);
    this.weaponMount = new pc.Entity('Botanical tool mount');
    this.playerVisual.addChild(this.weaponMount);
    this.weaponMount.setLocalPosition(0.36, 1.18, -0.54);
    this.weaponPlaceholders = {
      'Pod Burst': this.buildWeaponPlaceholder('Pod Burst'),
      'Seed Repeater': this.buildWeaponPlaceholder('Seed Repeater')
    };
    this.weaponPlaceholders['Seed Repeater'].enabled = false;
    this.buildItems();
    this.buildStations();
    this.buildBots();
    this.buildCrew();
    this.boss = this.buildBoss();
    this.boss.enabled = false;
    this.beacon = this.primitive('Goal marker', 'cylinder', V(0, 0.05, 0), V(1.55, 0.06, 1.55), this.beaconMat);
    this.beam = this.primitive('Goal light', 'cylinder', V(0, 3.5, 0), V(0.12, 7, 0.12), this.beaconMat);
    for (let i = 0; i < 4; i++) {
      const marker = this.primitive(`Route arrow ${i}`, 'cone', V(0, 0.04, 0), V(0.3, 0.04, 0.55), this.routeMat);
      this.routeMarks.push(marker);
    }
    this.beacon.enabled = false;
    this.beam.enabled = false;
    this.routeMarks.forEach(mark => mark.enabled = false);
    this.updateThirdPersonCamera();
    this.bindInput();
    // Apply look and movement before Ammo's fixed step; place the shoulder camera after physics.
    app.on('frameupdate', (milliseconds: number) => {
      if (!this.active) return;
      this.updateLook();
      const physicsDt = Math.min(Math.max(milliseconds / 1000, 0), app.maxDeltaTime) * app.timeScale;
      this.updateMovement(physicsDt);
    });
    app.on('update', (dt: number) => this.update(Math.min(dt, 0.06)));
  }

  private primitive(name: string, type: string, position: pc.Vec3, scale: pc.Vec3, mat: pc.StandardMaterial, parent: pc.Entity = this.app.root): pc.Entity {
    const entity = new pc.Entity(name);
    entity.addComponent('render', { type, material: mat, castShadows: type !== 'plane' });
    entity.setPosition(position);
    entity.setLocalScale(scale);
    parent.addChild(entity);
    return entity;
  }

  private solidBox(name: string, position: pc.Vec3, size: pc.Vec3, mat: pc.StandardMaterial): pc.Entity {
    const root = new pc.Entity(name);
    root.setPosition(position);
    this.app.root.addChild(root);
    const surface = this.primitive(`${name} surface`, 'box', V(0, 0, 0), size, mat, root);
    if (name === 'Island platform' || name === 'South dock' || name === 'Battery pier') {
      // Huge flat quays create shadow-map banding at shallow camera angles.
      surface.render!.receiveShadows = false;
      surface.render!.castShadows = false;
    }
    root.addComponent('collision', { type: 'box', halfExtents: size.clone().mulScalar(0.5) });
    root.addComponent('rigidbody', { type: 'static', friction: 0.75 });
    return root;
  }

  private addLamp(group: string, position: pc.Vec3, color?: pc.StandardMaterial): void {
    const lamp = this.primitive(`${group} lamp`, 'sphere', position, V(0.24, 0.24, 0.24), color ?? this.inactiveLamp);
    const list = this.serviceLamps.get(group) ?? [];
    list.push(lamp);
    this.serviceLamps.set(group, list);
  }

  private texture(draw: (context: CanvasRenderingContext2D) => void): pc.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas textures are unavailable.');
    draw(context);
    const texture = new pc.Texture(this.app.graphicsDevice, { width: 512, height: 512, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT });
    texture.setSource(canvas);
    return texture;
  }

  private applyEnvironmentTextures(): void {
    let seed = 19317;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
    const concrete = this.texture(ctx => {
      ctx.fillStyle = '#aeb8b5'; ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 3800; i++) {
        const value = random() > 0.48 ? 220 : 75;
        ctx.fillStyle = `rgba(${value},${value},${value},${0.012 + random() * 0.045})`;
        const x = random() * 512; const y = random() * 512; const size = 0.35 + random() * 1.4;
        ctx.fillRect(x, y, size, size);
      }
    });
    for (const mat of [this.solid, this.dockMaterial]) {
      mat.diffuse = hex(0xffffff);
      mat.diffuseMap = concrete;
      mat.diffuseMapTiling = new pc.Vec2(4, 4);
      mat.update();
    }
    const waves = this.texture(ctx => {
      ctx.fillStyle = '#137fa6'; ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 640; i++) {
        const x = random() * 512; const y = random() * 512; const width = 6 + random() * 52;
        ctx.strokeStyle = random() > 0.45 ? `rgba(196,247,239,${0.1 + random() * 0.35})` : `rgba(7,54,91,${0.08 + random() * 0.22})`;
        ctx.lineWidth = 0.4 + random() * 2.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + width * 0.5, y - 2 - random() * 5, x + width, y + random() * 2); ctx.stroke();
      }
    });
    this.ocean.diffuse = hex(0xffffff);
    this.ocean.diffuseMap = waves;
    this.ocean.diffuseMapTiling = new pc.Vec2(10, 10);
    this.ocean.update();
  }

  private buildIsland(): void {
    this.primitive('Open sea', 'plane', V(0, -2.15, -3), V(470, 1, 470), this.ocean);
    for (let i = 0; i < 84; i++) {
      const angle = i * 2.399;
      const radius = 43 + (i % 13) * 12.5;
      const x = Math.cos(angle) * radius;
      const z = -4 + Math.sin(angle) * radius;
      const streak = this.primitive('Sunlit foam', 'plane', V(x, -2.11 + (i % 3) * 0.005, z), V(1.2 + (i % 5) * 0.7, 1, 0.045), this.foam);
      streak.setEulerAngles(0, (i * 41) % 180, 0);
      this.ripples.push(streak);
    }
    this.solidBox('Island platform', V(0, -0.6, -10), V(70, 1.2, 55), this.solid);
    this.solidBox('South dock', V(0, -0.55, 27), V(18, 1.1, 19), this.dockMaterial);
    this.solidBox('Battery pier', V(-18, -0.55, 15), V(14, 1.1, 9), this.dockMaterial);
    const slab = material(0xcbd3cc, 0.45, 0.08);
    for (let x = -32; x <= 32; x += 8) {
      this.primitive('Concrete seam', 'box', V(x, 0.017, -10), V(0.055, 0.018, 55), this.dark);
    }
    for (let z = -36; z <= 16; z += 8) {
      this.primitive('Concrete seam', 'box', V(0, 0.017, z), V(69, 0.018, 0.055), this.dark);
    }
    for (const x of [-8, -4, 0, 4, 8]) this.primitive('Dock seam', 'box', V(x, 0.017, 27), V(0.055, 0.018, 19), this.dark);
    for (const z of [19, 23, 27, 31, 35]) this.primitive('Dock seam', 'box', V(0, 0.017, z), V(18, 0.018, 0.055), this.dark);
    for (const x of [-34.2, 34.2]) {
      for (let z = -33; z <= 15; z += 6) {
        this.primitive('Safety bollard', 'cylinder', V(x, 0.46, z), V(0.44, 0.9, 0.44), this.yellow);
        this.primitive('Safety cap', 'cylinder', V(x, 0.93, z), V(0.48, 0.12, 0.48), this.dark);
      }
    }
    for (const z of [-37.2, 36.2]) {
      for (let x = z < 0 ? -31 : -7; x <= (z < 0 ? 31 : 7); x += 6) {
        this.primitive('Perimeter bollard', 'cylinder', V(x, 0.42, z), V(0.38, 0.84, 0.38), this.yellow);
      }
    }
    // Large structures stay at sector edges so the guided route never runs through a locked room.
    this.solidBox('Materials recovery building', V(-29, 4.2, -1), V(9.3, 8.4, 23), slab);
    this.primitive('Recovery roof', 'box', V(-29, 8.56, -1), V(10.3, 0.35, 24), this.dark);
    this.solidBox('Water treatment hall', V(29.7, 3.9, -3), V(8, 7.8, 22), slab);
    this.primitive('Treatment roof', 'box', V(29.7, 7.94, -3), V(8.9, 0.35, 23), this.dark);
    this.solidBox('Energy control house', V(-7, 2.25, -33), V(11, 4.5, 7), slab);
    this.primitive('Energy roof', 'box', V(-7, 4.66, -33), V(12, 0.34, 8), this.dark);
    for (let i = 0; i < 7; i++) {
      const z = -11 + i * 3.1;
      this.primitive('Recovery glass', 'box', V(-24.27, 5.2, z), V(0.08, 2.15, 2.0), material(0x76b6bf, 0.86, 0.1));
      this.primitive('Treatment glass', 'box', V(25.64, 4.8, z), V(0.08, 2.0, 2.0), material(0x70aebd, 0.86, 0.1));
    }
    for (let i = 0; i < 10; i++) {
      this.primitive('Coastal floodlight pole', 'cylinder', V(-30 + i * 6.2, 2.8, 16.2), V(0.12, 5.6, 0.12), this.dark);
      this.primitive('Coastal floodlight', 'box', V(-30 + i * 6.2, 5.62, 16.2), V(0.82, 0.14, 0.42), this.activeLamp);
    }
    // Water process is readable from the quay: an open basin and visible bright flow.
    this.primitive('Water basin wall', 'cylinder', V(18.5, 0.64, -13), V(12.7, 1.28, 12.7), this.dark);
    this.poolWater = this.primitive('Water basin', 'cylinder', V(18.5, 1.32, -13), V(11.7, 0.06, 11.7), transparent(0x49b8cd, 0.83, 0.15));
    for (let i = 0; i < 5; i++) {
      const pipe = this.primitive('Treatment pipe', 'cylinder', V(25.3, 1.02 + i * 0.34, -19.3 + i * 1.3), V(0.27, 5.0, 0.27), this.oxidized);
      pipe.setEulerAngles(0, 0, 90);
    }
    this.primitive('Recovery conveyor', 'box', V(-20.4, 1.12, -7), V(3.7, 0.34, 10.2), this.dark);
    this.primitive('Recovery belt surface', 'box', V(-20.4, 1.32, -7), V(3.3, 0.05, 9.8), material(0x38545a, 0.25, 0.08));
    for (let i = 0; i < 9; i++) {
      const roller = this.primitive('Sorter roller', 'cylinder', V(-20.4, 1.39, -11.5 + i * 1.1), V(3.28, 0.14, 0.14), this.oxidized);
      roller.setEulerAngles(0, 0, 90);
      this.beltRollers.push(roller);
    }
    const colors = [material(0x3f9cc4, 0.38), material(0x75a869, 0.38), material(0xbb916d, 0.38)];
    for (let i = 0; i < 3; i++) {
      this.primitive(`Sorting bay ${i + 1}`, 'box', V(-25.3 + i * 4.8, 0.75, -16.5), V(4.1, 1.5, 3.6), colors[i]);
      this.primitive('Sorting bay rim', 'box', V(-25.3 + i * 4.8, 1.55, -16.5), V(4.24, 0.12, 3.75), this.dark);
    }
    // Buildings and landscape seen beyond the island sell the scale without blocking play.
    for (let i = 0; i < 23; i++) {
      const x = -150 + i * 15.3;
      const z = -145 - (i % 4) * 9;
      this.primitive('Far coastal rock', 'sphere', V(x, -1.3, z), V(13 + (i % 5) * 3, 6 + (i % 6) * 3, 11 + (i % 3) * 5), material(0x9fac9b, 0.16));
      this.primitive('Far coastal green', 'sphere', V(x, 5 + (i % 5) * 1.4, z), V(11 + (i % 4) * 2, 2.5, 10), this.foliage);
    }
    for (let i = 0; i < 9; i++) {
      const x = 46 + i * 7;
      const house = this.primitive('Community home', 'box', V(x, 3.4 + (i % 3), -82 - (i % 3) * 8), V(5, 6 + (i % 3) * 2, 5), slab);
      this.primitive('Community roof', 'box', V(x, 6.7 + (i % 3) * 2, -82 - (i % 3) * 8), V(5.6, 0.3, 5.6), this.dark);
      const lit = this.primitive('Community window', 'box', V(x, 4.5, -79.45 - (i % 3) * 8), V(1.6, 1.5, 0.06), this.inactiveLamp);
      this.communityLamps.push(lit);
      house.enabled = true;
    }
    this.buildTurbine(V(-8, 0, -63), 1.0);
    this.buildTurbine(V(-44, -1, -74), 0.72);
    this.buildTurbine(V(28, -1, -87), 0.62);
    this.modelAt('WindTurbine', V(13, -1.2, -73), 38);
    this.modelAt('RescueCrane', V(-21, 0, 16), 11);
    this.modelAt('CargoContainer', V(-23, 0, 18), 4.2);
    this.modelAt('RescueLaunch', V(10, -0.7, 29), 5.8);
  }

  private buildTurbine(at: pc.Vec3, size: number): void {
    const white = material(0xf2f3ec, 0.47, 0.15);
    this.primitive('Wind tower', 'cylinder', V(at.x, at.y + 11 * size, at.z), V(1.15 * size, 22 * size, 1.15 * size), white);
    this.primitive('Wind nacelle', 'box', V(at.x, at.y + 22 * size, at.z + 0.5 * size), V(2.7 * size, 1.2 * size, 3.8 * size), white);
    const rotor = new pc.Entity('Wind rotor');
    rotor.setPosition(at.x, at.y + 22 * size, at.z + 2.4 * size);
    this.app.root.addChild(rotor);
    this.primitive('Turbine hub', 'sphere', V(0, 0, 0), V(1.1 * size, 1.1 * size, 1.1 * size), this.dark, rotor);
    for (let i = 0; i < 3; i++) {
      const blade = new pc.Entity('Rotor blade');
      blade.setLocalEulerAngles(0, 0, i * 120);
      rotor.addChild(blade);
      this.primitive('Tapered blade', 'box', V(0, 5.25 * size, 0), V(0.56 * size, 10.3 * size, 0.25 * size), white, blade);
      this.primitive('Blade tip', 'box', V(0, 10.3 * size, 0), V(0.57 * size, 0.82 * size, 0.27 * size), this.danger, blade);
    }
    this.turbineRotors.push(rotor);
  }

  private buildStations(): void {
    const names: Record<string, string> = {
      grid_socket: 'GRID STORAGE', sorter_jam: 'JAMMED SORTER', sorter_chute: 'WASTE INPUT',
      sorter_switch: 'SORTER CONTROL', comms_switch: 'COMMS CONTROL',
      intake_a: 'INTAKE A', intake_b: 'INTAKE B', filter_socket: 'FILTER RACK',
      water_switch: 'WATER CONTROL', wind_socket: 'WIND CONTROL MODULE',
      wind_switch: 'TURBINE START', capture_switch: 'RECOVERY CAPTURE', extraction: 'RESCUE LAUNCH'
    };
    for (const [id, label] of Object.entries(names)) {
      const at = WORLD_POINTS[id];
      const base = this.primitive(label, id === 'extraction' ? 'cylinder' : 'box', V(at.x, id === 'extraction' ? 0.12 : 0.75, at.z), id === 'extraction' ? V(3, 0.22, 3) : V(1.05, 1.5, 0.66), id === 'extraction' ? this.yellow : this.dark);
      this.worldObjects.set(id, base);
      if (id !== 'extraction') {
        this.primitive('Terminal face', 'box', V(at.x, 1.13, at.z - 0.35), V(0.77, 0.61, 0.08), this.inactiveLamp);
        this.primitive('Terminal control', 'sphere', V(at.x + 0.28, 0.61, at.z - 0.38), V(0.11, 0.11, 0.11), this.yellow);
        this.addLamp(id.startsWith('sorter') ? 'sorter' : id.startsWith('intake') || id.startsWith('water') || id.startsWith('filter') ? 'water' : id.startsWith('wind') ? 'wind' : 'comms', V(at.x, 1.57, at.z));
      }
    }
    this.modelAt('SortingConveyor', V(-20.4, 0.7, -7), 5.5);
    this.modelAt('ServiceTerminal', V(-6, 0.0, 13), 1.6);
    this.modelAt('IntakeFilter', V(18, 0.0, -8), 2.1);
    for (const id of ['intake_a', 'intake_b']) {
      const at = WORLD_POINTS[id];
      this.primitive('Intake debris', 'sphere', V(at.x, 0.48, at.z + 1.0), V(1.4, 0.65, 1.2), this.oxidized);
    }
  }

  private buildItems(): void {
    for (const [id, model] of Object.entries(ITEM_MODELS)) {
      const at = WORLD_POINTS[id];
      const entity = new pc.Entity(id);
      entity.setPosition(at.x, Math.max(0.65, at.y), at.z);
      entity.addComponent('collision', { type: 'box', halfExtents: V(ITEM_SIZE[id] * 0.45, ITEM_SIZE[id] * 0.4, ITEM_SIZE[id] * 0.45) });
      entity.addComponent('rigidbody', { type: 'dynamic', mass: id.startsWith('waste') ? 11 : 18, friction: 0.7, restitution: 0.06, linearDamping: 0.2, angularDamping: 0.78 });
      this.app.root.addChild(entity);
      const silhouette = this.primitive(`${id} silhouette`, 'box', V(0, 0, 0), V(ITEM_SIZE[id], ITEM_SIZE[id] * 0.7, ITEM_SIZE[id]), id.startsWith('waste') ? this.oxidized : this.aqua, entity);
      this.model(model, entity, ITEM_SIZE[id] * 1.35, V(0, -0.15, 0), V(0, 0, 0), [silhouette]);
      this.itemEntities.set(id, entity);
      this.worldObjects.set(id, entity);
    }
  }

  private buildWeaponPlaceholder(name: 'Pod Burst' | 'Seed Repeater'): pc.Entity {
    const root = new pc.Entity(name);
    this.weaponMount.addChild(root);
    const leaf = name === 'Pod Burst' ? this.foliage : this.aqua;
    const fallback = [
      this.primitive('Botanical housing', 'capsule', V(0, 0, 0), V(0.22, 0.26, name === 'Pod Burst' ? 0.67 : 0.9), leaf, root),
      this.primitive('Muzzle bloom', 'sphere', V(0, 0.03, -0.42), V(0.25, 0.25, 0.24), this.yellow, root),
      this.primitive('Tool stock', 'box', V(0.12, -0.13, 0.35), V(0.16, 0.33, 0.32), this.dark, root)
    ];
    this.model(name === 'Pod Burst' ? 'PodBurst' : 'SeedRepeater', root, name === 'Pod Burst' ? 0.68 : 0.86, V(0, -0.06, 0.04), V(0, 180, 0), fallback);
    return root;
  }

  private buildBots(): void {
    const routes = [
      [V(-12, 0.4, 4), V(-17, 0.4, -4), V(-11, 0.4, -11), V(-7, 0.4, -3)],
      [V(10, 0.4, 4), V(13, 0.4, -8), V(6, 0.4, -16), V(1, 0.4, -5)]
    ];
    for (let i = 0; i < 2; i++) {
      const root = new pc.Entity(`Debris cleaner ${i + 1}`);
      root.setPosition(routes[i][0]);
      this.app.root.addChild(root);
      const fallback = [
        this.primitive('Cleanup chassis', 'box', V(0, 0.7, 0), V(1.35, 0.8, 1.5), this.oxidized, root),
        this.primitive('Cleanup shell', 'sphere', V(0, 1.13, 0), V(1.65, 0.85, 1.4), this.dark, root)
      ];
      for (const x of [-0.5, 0.5]) {
        const wheel = this.primitive('Cleanup wheel', 'cylinder', V(x, 0.42, 0.53), V(0.52, 0.18, 0.52), this.dark, root);
        wheel.setEulerAngles(0, 0, 90);
        fallback.push(wheel);
      }
      const eye = this.primitive('Cleanup scanner', 'box', V(0, 1.16, -0.72), V(0.68, 0.12, 0.08), this.danger, root);
      this.model(i === 0 ? 'TrashCleaner_A' : 'TrashCleaner_B', root, 2.05, V(0, 0.0, 0), V(0, 180, 0), fallback);
      this.bots.push({ id: `robot_${i}`, entity: root, home: routes[i][0].clone(), path: routes[i], index: 1, stun: 0, attackCooldown: 0, bob: i * 2, eye });
    }
  }

  private buildCrew(): void {
    // Short authored loops keep background activity on safe walkable ground.
    // Crew have no collision, weapon hit target or mission interaction.
    const routes = [
      { id: 'crew_dock', label: 'DOCK ENGINEER', model: 'IslandTechnician_Orange', color: 0xe8a049, points: [V(6, 0.02, 22), V(7, 0.02, 26), V(5, 0.02, 27)] },
      { id: 'crew_coast', label: 'COAST SURVEYOR', model: 'IslandTechnician_Green', color: 0x60acb4, points: [V(-30, 0.02, -29), V(-27, 0.02, -29), V(-27, 0.02, -26)] },
      { id: 'crew_water', label: 'WATER TECHNICIAN', model: 'IslandTechnician_Green', color: 0xa2be72, points: [V(28, 0.02, -25), V(29, 0.02, -28), V(26, 0.02, -30)] },
      { id: 'crew_battery', label: 'BATTERY STEWARD', model: 'IslandTechnician_Orange', color: 0xe8a049, points: [V(-14, 0.02, 15), V(-13, 0.02, 18), V(-16, 0.02, 18)] },
      { id: 'crew_recovery', label: 'RECOVERY MECHANIC', model: 'IslandTechnician', color: 0x60acb4, points: [V(-20, 0.02, 3), V(-18, 0.02, 6), V(-17, 0.02, 4)] },
      { id: 'crew_filter', label: 'FILTER SPECIALIST', model: 'IslandTechnician_Green', color: 0xa2be72, points: [V(18, 0.02, 8), V(16, 0.02, 10), V(18, 0.02, 12)] },
      { id: 'crew_wind', label: 'WIND FORECASTER', model: 'IslandTechnician_Orange', color: 0xe8a049, points: [V(-17, 0.02, -24), V(-16, 0.02, -27), V(-19, 0.02, -28)] }
    ];
    for (const [index, route] of routes.entries()) {
      const root = new pc.Entity(route.label);
      root.setPosition(route.points[0]);
      this.app.root.addChild(root);
      const { visual, rig } = this.buildCrewFallback(root, route.color);
      const member: CrewMember = {
        id: route.id, label: route.label, entity: root, waypoints: route.points,
        waypointIndex: 0, mode: 'idle', timeLeft: 1.2 + index * 0.8,
        motion: index * 1.7, speed: 0.74 + index * 0.12,
        heading: 180 - index * 65, seed: (19317 + index * 7123) >>> 0, rig
      };
      this.crew.push(member);
      this.model(route.model, root, 1.83, V(0, 0, 0), V(0, 180, 0), [visual], instance => {
        member.rig = this.findCrewRig(instance);
      }, true);
    }
  }

  private buildCrewFallback(parent: pc.Entity, jacketColor: number): { visual: pc.Entity; rig: CrewRig } {
    const visual = new pc.Entity('Technician fallback');
    parent.addChild(visual);
    const jacket = material(jacketColor, 0.39, 0.04);
    const cloth = material(0x2f4a53, 0.28, 0.02);
    const skin = material(0xc2926d, 0.28);
    const hardHat = material(0xf3d76d, 0.45, 0.03);
    const reflective = material(0xd5eecc, 0.38, 0.02);
    const joint = (name: string, at: pc.Vec3) => {
      const entity = new pc.Entity(name);
      visual.addChild(entity);
      entity.setLocalPosition(at);
      return entity;
    };
    const torso = joint('Torso', V(0, 1.25, 0));
    this.primitive('Safety jacket', 'box', V(0, 0, 0), V(0.55, 0.75, 0.33), jacket, torso);
    this.primitive('Reflective band', 'box', V(0, -0.12, -0.172), V(0.52, 0.045, 0.015), reflective, torso);
    const head = joint('Head', V(0, 1.66, 0));
    this.primitive('Face', 'sphere', V(0, 0, -0.02), V(0.29, 0.31, 0.28), skin, head);
    this.primitive('Safety helmet', 'sphere', V(0, 0.15, -0.01), V(0.34, 0.17, 0.32), hardHat, head);
    const leftArm = joint('Arm_Left', V(-0.37, 1.45, 0));
    const rightArm = joint('Arm_Right', V(0.37, 1.45, 0));
    for (const arm of [leftArm, rightArm]) this.primitive('Sleeve', 'capsule', V(0, -0.25, 0), V(0.18, 0.53, 0.18), jacket, arm);
    const leftLeg = joint('Leg_Left', V(-0.16, 0.87, 0));
    const rightLeg = joint('Leg_Right', V(0.16, 0.87, 0));
    for (const leg of [leftLeg, rightLeg]) {
      this.primitive('Work trousers', 'capsule', V(0, -0.31, 0), V(0.2, 0.64, 0.22), cloth, leg);
      this.primitive('Work boot', 'box', V(0, -0.69, -0.065), V(0.22, 0.19, 0.36), this.dark, leg);
    }
    const asJoint = (entity: pc.Entity): CrewJoint => ({ entity, base: entity.getLocalEulerAngles().clone() });
    return { visual, rig: {
      head: asJoint(head), torso: asJoint(torso), leftArm: asJoint(leftArm), rightArm: asJoint(rightArm),
      leftLeg: asJoint(leftLeg), rightLeg: asJoint(rightLeg)
    } };
  }

  private findCrewRig(model: pc.Entity): CrewRig | null {
    const find = (name: string): CrewJoint | null => {
      const entity = model.findByName(name) as pc.Entity | null;
      return entity ? { entity, base: entity.getLocalEulerAngles().clone() } : null;
    };
    const head = find('Head');
    const torso = find('Torso');
    const leftArm = find('Arm_Left');
    const rightArm = find('Arm_Right');
    const leftLeg = find('Leg_Left');
    const rightLeg = find('Leg_Right');
    return head && torso && leftArm && rightArm && leftLeg && rightLeg
      ? { head, torso, leftArm, rightArm, leftLeg, rightLeg } : null;
  }

  private buildBoss(): pc.Entity {
    const root = new pc.Entity('Fixed recovery machine');
    root.setPosition(13, 0, -27);
    this.app.root.addChild(root);
    const fallback = [
      this.primitive('Recovery machine base', 'cylinder', V(0, 1.2, 0), V(5.5, 2.4, 4.2), this.oxidized, root),
      this.primitive('Recovered debris shell', 'sphere', V(0, 2.15, 0), V(5.2, 2.8, 4.0), this.dark, root)
    ];
    this.model('TideHeap', root, 4.0, V(0, 0.2, 0), V(0, 0, 0), fallback);
    for (const x of [-2.0, 2.0]) {
      const node = this.primitive('Exposed power node', 'sphere', V(x, 2.45, 2.3), V(0.7, 0.7, 0.7), this.danger, root);
      this.weakpoints.push(node);
    }
    return root;
  }

  private model(name: string, parent: pc.Entity, desiredMaxSize: number, offset = V(0, 0, 0), euler = V(0, 0, 0), fallback: pc.Entity[] = [], onReady?: (model: pc.Entity) => void, fitWholeModel = false): void {
    let asset = this.modelAssets.get(name);
    if (!asset) {
      asset = new pc.Asset(name, 'container', { url: `assets/models/${name}.glb` });
      this.modelAssets.set(name, asset);
      this.app.assets.add(asset);
    }
    asset.ready(() => {
      const resource = asset.resource as pc.ContainerResource;
      if (!resource?.instantiateRenderEntity) return;
      const instance = resource.instantiateRenderEntity();
      parent.addChild(instance);
      instance.setLocalPosition(offset);
      instance.setLocalEulerAngles(euler);
      let actualSize = 0;
      const lower = V(Infinity, Infinity, Infinity);
      const upper = V(-Infinity, -Infinity, -Infinity);
      for (const render of instance.findComponents('render') as pc.RenderComponent[]) {
        for (const mesh of render.meshInstances) {
          const box = mesh.aabb;
          if (fitWholeModel) {
            const min = box.getMin();
            const max = box.getMax();
            lower.x = Math.min(lower.x, min.x); lower.y = Math.min(lower.y, min.y); lower.z = Math.min(lower.z, min.z);
            upper.x = Math.max(upper.x, max.x); upper.y = Math.max(upper.y, max.y); upper.z = Math.max(upper.z, max.z);
          } else {
            const half = box.halfExtents;
            actualSize = Math.max(actualSize, half.x * 2, half.y * 2, half.z * 2);
          }
        }
      }
      if (fitWholeModel && Number.isFinite(lower.x)) actualSize = Math.max(upper.x - lower.x, upper.y - lower.y, upper.z - lower.z);
      if (actualSize > 0.01) instance.setLocalScale(desiredMaxSize / actualSize, desiredMaxSize / actualSize, desiredMaxSize / actualSize);
      fallback.forEach(entity => entity.enabled = false);
      onReady?.(instance);
    });
    asset.on('error', () => { /* Procedural silhouette remains usable if an optional model fails. */ });
    if (!asset.loaded && !asset.loading) this.app.assets.load(asset);
  }

  private modelAt(name: string, at: pc.Vec3, desiredMaxSize: number): void {
    const anchor = new pc.Entity(`${name} display`);
    anchor.setPosition(at);
    this.app.root.addChild(anchor);
    this.model(name, anchor, desiredMaxSize);
  }

  private bindInput(): void {
    window.addEventListener('keydown', event => {
      if (!this.active) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyG', 'KeyQ', 'Digit1', 'Digit2', 'Space', 'ShiftLeft'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyE') this.tryInteract();
      if (event.code === 'KeyG' && this.heldId) this.onAction({ type: 'drop', id: this.heldId });
      if (event.code === 'KeyQ') this.onAction({ type: 'drone' });
      if (event.code === 'Digit1') this.selectWeapon('Pod Burst');
      if (event.code === 'Digit2' && this.repeaterAvailable) this.selectWeapon('Seed Repeater');
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; this.lookDeltaX = this.lookDeltaY = 0; });
    document.addEventListener('mousemove', event => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;
      this.lookDeltaX += event.movementX;
      this.lookDeltaY += event.movementY;
    });
    this.canvas.addEventListener('mousedown', event => {
      if (event.button === 0 && this.active && document.pointerLockElement === this.canvas) {
        this.fireHeld = true;
        this.tryFire();
      }
    });
    this.canvas.addEventListener('click', () => {
      if (this.active && document.pointerLockElement !== this.canvas) this.requestPointerLock();
    });
    window.addEventListener('mouseup', event => { if (event.button === 0) this.fireHeld = false; });
  }

  private selectWeapon(name: 'Pod Burst' | 'Seed Repeater'): void {
    if (name === this.weapon) return;
    this.weapon = name;
    this.weaponPlaceholders['Pod Burst'].enabled = name === 'Pod Burst';
    this.weaponPlaceholders['Seed Repeater'].enabled = name === 'Seed Repeater';
    this.onAction({ type: 'weapon', weapon: name });
  }

  private tryInteract(): void {
    const choice = this.interactionChoice();
    if (choice?.kind === 'objective') this.onAction({ type: 'interact', id: choice.id });
    else if (choice?.kind === 'crew') {
      const from = choice.member.entity.getPosition();
      const to = this.player.getPosition();
      choice.member.heading = Math.atan2(from.x - to.x, from.z - to.z) * pc.math.RAD_TO_DEG;
      choice.member.mode = 'idle';
      choice.member.timeLeft = 5.8;
      this.onAction({ type: 'talk', id: choice.member.id, name: choice.member.label });
    }
    else if (choice?.kind === 'drop') this.onAction({ type: 'drop', id: choice.id });
  }

  private tryFire(): void {
    if (!this.active || this.fireCooldown > 0 || document.pointerLockElement !== this.canvas) return;
    this.updateLook();
    this.updateThirdPersonCamera();
    this.fireCooldown = this.weapon === 'Pod Burst' ? 0.52 : 0.11;
    this.recoil = this.weapon === 'Pod Burst' ? 0.16 : 0.075;
    this.onAction({ type: 'fire', weapon: this.weapon });
    const origin = this.camera.getPosition().clone();
    const direction = this.camera.forward.clone();
    const range = this.weapon === 'Pod Burst' ? 18 : 48;
    let hit: { id: string; distance: number } | null = null;
    for (const bot of this.bots) {
      if (!bot.entity.enabled || bot.stun > 0) continue;
      const at = bot.entity.getPosition().clone().add(V(0, 1.1, 0));
      const relative = at.clone().sub(this.player.getPosition());
      if (-relative.x * Math.sin(this.yaw) - relative.z * Math.cos(this.yaw) < 0.1) continue;
      const distance = this.raySphere(origin, direction, at, 1.1);
      if (distance !== null && distance < range && (!hit || distance < hit.distance)) hit = { id: bot.id, distance };
    }
    if (this.phase >= 3 && this.boss.enabled) {
      for (const [id, at] of [['boss_node_left', WORLD_POINTS.boss_node_left], ['boss_node_right', WORLD_POINTS.boss_node_right]] as const) {
        const node = this.weakpoints[id.endsWith('left') ? 0 : 1];
        if (!node?.enabled) continue;
        const distance = this.raySphere(origin, direction, at, 0.9);
        if (distance !== null && distance < range && (!hit || distance < hit.distance)) hit = { id, distance };
      }
    }
    const muzzle = this.weaponMount.getPosition().clone().add(this.weaponMount.forward.clone().mulScalar(0.42));
    let end = origin.clone().add(direction.clone().mulScalar(hit?.distance ?? range));
    const sightBlock = this.app.systems.rigidbody?.raycastFirst(origin, end, {
      filterCallback: (entity: pc.Entity) => entity !== this.player && entity.rigidbody?.type === pc.BODYTYPE_STATIC
    });
    if (sightBlock && sightBlock.point.distance(origin) < end.distance(origin) - 0.2) {
      end = sightBlock.point.clone();
      hit = null;
    }
    const obstruction = this.app.systems.rigidbody?.raycastFirst(muzzle, end, {
      filterCallback: (entity: pc.Entity) => entity !== this.player && entity.rigidbody?.type === pc.BODYTYPE_STATIC
    });
    if (obstruction && obstruction.point.distance(muzzle) < end.distance(muzzle) - 0.2) {
      end = obstruction.point.clone();
      hit = null;
    }
    if (hit) {
      this.onAction({ type: 'shoot', id: hit.id, weapon: this.weapon });
      if (hit.id.startsWith('robot_')) {
        const bot = this.bots.find(one => one.id === hit!.id);
        if (bot) { bot.stun = this.weapon === 'Pod Burst' ? 4.4 : 2.2; this.spark(bot.entity.getPosition().clone().add(V(0, 1, 0)), 0xffba6c); }
      } else this.spark(end, 0x91ed83);
    }
    const travel = end.clone().sub(muzzle);
    if (travel.length() < 0.1) return;
    const pod = this.primitive('Seed pod', 'sphere', muzzle.clone().add(travel.clone().normalize().mulScalar(0.22)), V(this.weapon === 'Pod Burst' ? 0.19 : 0.09, this.weapon === 'Pod Burst' ? 0.19 : 0.09, this.weapon === 'Pod Burst' ? 0.19 : 0.09), this.weapon === 'Pod Burst' ? this.yellow : this.foliage);
    this.pulses.push({ entity: pod, ttl: Math.min(0.48, travel.length() / 56), velocity: travel.normalize().mulScalar(56), baseScale: 1 });
  }

  private raySphere(origin: pc.Vec3, direction: pc.Vec3, center: pc.Vec3, radius: number): number | null {
    const delta = center.clone().sub(origin);
    const along = delta.dot(direction);
    if (along < 0) return null;
    const perpendicularSq = delta.lengthSq() - along * along;
    if (perpendicularSq > radius * radius) return null;
    return along - Math.sqrt(radius * radius - perpendicularSq);
  }

  private spark(at: pc.Vec3, color: number): void {
    if (this.settings.reducedEffects) return;
    const mat = transparent(color, 0.8, 2.0);
    for (let i = 0; i < 5; i++) {
      const entity = this.primitive('Impact fragment', 'sphere', at.clone(), V(0.07, 0.07, 0.07), mat);
      const angle = (i * 2.399) + this.elapsed;
      this.pulses.push({ entity, ttl: 0.37, velocity: V(Math.sin(angle) * 3, 2 + i * 0.35, Math.cos(angle) * 3), baseScale: 1 });
    }
  }

  private update(dt: number): void {
    this.elapsed += dt;
    this.updateThirdPersonCamera();
    this.updateWater(dt);
    this.updateMarkers(dt);
    this.updatePulses(dt);
    if (!this.active) return;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.fireHeld && this.weapon === 'Seed Repeater') this.tryFire();
    this.updateCargo();
    this.updateBots(dt);
    this.updateCrew(dt);
    this.updatePlayerVisual(dt);
    this.weaponMount.setLocalPosition(0.36, 1.18, -0.54 + this.recoil);
    this.recoil = Math.max(0, this.recoil - dt * 1.15);
    for (const rotor of this.turbineRotors) if (rotor.enabled) rotor.rotateLocal(0, 0, this.windOnline ? dt * 23 : dt * 0.45);
    if (this.sorterOnline) for (const roller of this.beltRollers) roller.rotateLocal(0, dt * 200, 0);
    const at = this.player.getPosition();
    if (at.y < -4 || Math.abs(at.x) > 36 || at.z < -39 || at.z > 37) this.setPose({ position: [0, 1.05, 31], yaw: 0.55, pitch: 0 });
    for (const [id, item] of this.itemEntities) {
      if (!item.enabled || this.heldId === id) continue;
      const where = item.getPosition();
      if (where.y < -2.5 || Math.abs(where.x) > 35 || where.z < -38 || where.z > 37) {
        if ((this.recoverCooldown.get(id) ?? 0) < this.elapsed) {
          this.recoverCooldown.set(id, this.elapsed + 3);
          this.onAction({ type: 'recover', id });
        }
      }
    }
  }

  private updateWater(dt: number): void {
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      const p = ripple.getPosition();
      ripple.setPosition(p.x + dt * (i % 3 - 1) * 0.38, p.y, p.z + dt * ((i % 4) - 1.5) * 0.14);
      if (Math.abs(p.x) > 220 || Math.abs(p.z) > 220) ripple.setPosition(-p.x * 0.85, p.y, -p.z * 0.85);
    }
    if (this.waterOnline) this.poolWater.setLocalEulerAngles(0, this.elapsed * 3.2, 0);
  }

  private updateLook(): void {
    if (this.lookDeltaX === 0 && this.lookDeltaY === 0) return;
    this.yaw -= this.lookDeltaX * this.settings.sensitivity * 0.0022;
    this.pitch = pc.math.clamp(this.pitch - this.lookDeltaY * this.settings.sensitivity * 0.0022, -1.38, 1.38);
    this.lookDeltaX = this.lookDeltaY = 0;
    this.camera.setEulerAngles(this.pitch * pc.math.RAD_TO_DEG, this.yaw * pc.math.RAD_TO_DEG, 0);
    this.playerVisual.setLocalEulerAngles(0, this.yaw * pc.math.RAD_TO_DEG, 0);
  }

  private updateThirdPersonCamera(): void {
    const at = this.player.getPosition();
    const forward = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const focus = at.clone().add(V(0, 0.55, 0));
    const desired = focus.clone().sub(forward.mulScalar(3.25)).add(right.mulScalar(0.62));
    desired.y += 0.62 - Math.sin(this.pitch) * 0.65;
    const ray = desired.clone().sub(focus);
    const wall = this.app.systems.rigidbody?.raycastFirst(focus, desired, {
      filterCallback: (entity: pc.Entity) => entity !== this.player && entity.rigidbody?.type === pc.BODYTYPE_STATIC
    });
    const distance = ray.length();
    if (wall && distance > 0.001) {
      const clear = Math.max(0.35, wall.point.distance(focus) - 0.22);
      desired.copy(focus).add(ray.mulScalar(Math.min(clear, distance) / distance));
    }
    this.camera.setPosition(desired);
    this.camera.setEulerAngles(this.pitch * pc.math.RAD_TO_DEG, this.yaw * pc.math.RAD_TO_DEG, 0);
    this.playerVisual.setLocalEulerAngles(0, this.yaw * pc.math.RAD_TO_DEG, 0);
    this.playerVisual.enabled = desired.distance(focus) > 0.86;
  }

  private updatePlayerVisual(dt: number): void {
    const rig = this.playerRig;
    if (!rig) return;
    const velocity = this.player.rigidbody!.linearVelocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    this.playerMotion += dt * Math.max(2.2, speed * 1.65);
    const stride = Math.sin(this.playerMotion) * pc.math.clamp(speed / 3.8, 0, 1);
    const set = (joint: CrewJoint, x = 0, y = 0, z = 0) => {
      joint.entity.setLocalEulerAngles(joint.base.x + x, joint.base.y + y, joint.base.z + z);
    };
    set(rig.leftLeg, stride * 23);
    set(rig.rightLeg, -stride * 23);
    set(rig.leftArm, -stride * 11 - 12);
    set(rig.rightArm, stride * 7 - 28);
    set(rig.torso, speed > 5.8 ? 5 : speed > 0.4 ? 2 : 0);
    set(rig.head, -3);
  }

  private updateMovement(dt: number): void {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const length = Math.hypot(forward, right) || 1;
    const speed = this.keys.has('ShiftLeft') ? 7.2 : 5.2;
    const targetX = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) / length * speed;
    const targetZ = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) / length * speed;
    const body = this.player.rigidbody!;
    const velocity = body.linearVelocity;
    const responseSeconds = forward || right ? 0.045 : 0.035;
    const blend = 1 - Math.exp(-dt / responseSeconds);
    body.linearVelocity = V(
      velocity.x + (targetX - velocity.x) * blend,
      velocity.y,
      velocity.z + (targetZ - velocity.z) * blend
    );
    if (this.keys.has('Space') && Math.abs(velocity.y) < 0.16 && this.player.getPosition().y < 1.15) body.applyImpulse(0, 320, 0);
    if (forward || right) {
      this.footstepClock -= dt;
      if (this.footstepClock <= 0) {
        this.onAction({ type: 'footstep' });
        this.footstepClock = this.keys.has('ShiftLeft') ? 0.31 : 0.44;
      }
    } else this.footstepClock = Math.min(this.footstepClock, 0.12);
  }

  private heldItemTarget(): pc.Vec3 {
    const at = this.player.getPosition();
    const forward = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return at.clone().add(forward.mulScalar(1.2)).add(right.mulScalar(-0.22)).add(V(0, 0.5, 0));
  }

  private updateCargo(): void {
    if (!this.heldId) return;
    const entity = this.itemEntities.get(this.heldId);
    if (!entity?.enabled) return;
    // Keep the prop fixed relative to the player and shoulder camera. A lagged
    // world-space follow makes it visibly wobble when the player turns or walks.
    entity.setPosition(this.heldItemTarget());
  }

  private updateBots(dt: number): void {
    for (const bot of this.bots) {
      if (!bot.entity.enabled) continue;
      bot.attackCooldown = Math.max(0, bot.attackCooldown - dt);
      if (bot.stun > 0) {
        bot.stun -= dt;
        bot.eye.setLocalScale(0.5, 0.05, 0.08);
        continue;
      }
      bot.eye.setLocalScale(0.68, 0.12, 0.08);
      const at = bot.entity.getPosition().clone();
      const player = this.player.getPosition();
      const playerDistance = Math.hypot(player.x - at.x, player.z - at.z);
      const chase = playerDistance < 8.0;
      const goal = chase ? player : bot.path[bot.index];
      const delta = V(goal.x - at.x, 0, goal.z - at.z);
      const distance = delta.length();
      if (!chase && distance < 0.8) bot.index = (bot.index + 1) % bot.path.length;
      else if (distance > 0.2) {
        delta.normalize();
        const speed = chase ? 2.7 : 1.3;
        bot.entity.setPosition(at.x + delta.x * dt * speed, 0.03 + Math.sin(this.elapsed * 5 + bot.bob) * 0.04, at.z + delta.z * dt * speed);
        bot.entity.setEulerAngles(0, Math.atan2(-delta.x, -delta.z) * pc.math.RAD_TO_DEG, 0);
      }
      if (chase && playerDistance < 1.85 && bot.attackCooldown <= 0) {
        bot.attackCooldown = 1.35;
        this.onAction({ type: 'damage', amount: 12 });
        this.spark(player.clone().add(V(0, 0.9, 0)), 0xff754e);
      }
    }
  }

  private crewRandom(member: CrewMember): number {
    member.seed = (Math.imul(member.seed, 1664525) + 1013904223) >>> 0;
    return member.seed / 4294967296;
  }

  private pauseCrew(member: CrewMember): void {
    const choice = this.crewRandom(member);
    member.mode = choice < 0.42 ? 'inspect' : choice < 0.81 ? 'idle' : 'signal';
    member.timeLeft = 1.4 + this.crewRandom(member) * 2.9;
  }

  private poseCrew(member: CrewMember): void {
    const rig = member.rig;
    if (!rig) return;
    const walking = member.mode === 'walk';
    const stride = walking ? Math.sin(member.motion * 7.7) : 0;
    const inspect = member.mode === 'inspect';
    const signal = member.mode === 'signal';
    const set = (joint: CrewJoint, x = 0, y = 0, z = 0) => {
      joint.entity.setLocalEulerAngles(joint.base.x + x, joint.base.y + y, joint.base.z + z);
    };
    set(rig.leftLeg, stride * 21);
    set(rig.rightLeg, -stride * 21);
    set(rig.leftArm, walking ? -stride * 18 : inspect ? -29 : 0);
    set(rig.rightArm, walking ? stride * 18 : inspect ? -35 : 0, 0, signal ? 58 + Math.sin(member.motion * 7) * 16 : 0);
    set(rig.torso, inspect ? 12 + Math.sin(member.motion * 1.9) * 2 : walking ? 2 : 0);
    set(rig.head, inspect ? -11 : 0, Math.sin(member.motion * (inspect ? 2.1 : 0.9)) * (walking ? 3 : 11));
  }

  private updateCrew(dt: number): void {
    for (const member of this.crew) {
      member.motion += dt;
      const at = member.entity.getPosition();
      if (member.mode === 'walk') {
        const goal = member.waypoints[member.waypointIndex];
        const dx = goal.x - at.x;
        const dz = goal.z - at.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.12) {
          member.entity.setPosition(goal.x, goal.y, goal.z);
          this.pauseCrew(member);
        } else {
          const step = Math.min(distance, member.speed * dt);
          const heading = Math.atan2(-dx, -dz) * pc.math.RAD_TO_DEG;
          const turn = ((heading - member.heading + 540) % 360) - 180;
          member.heading += turn * Math.min(1, dt * 6);
          member.entity.setPosition(at.x + dx / distance * step, 0.02 + Math.sin(member.motion * 15) * 0.012, at.z + dz / distance * step);
        }
      } else {
        member.timeLeft -= dt;
        member.entity.setPosition(at.x, 0.02, at.z);
        if (member.timeLeft <= 0) {
          const next = 1 + Math.floor(this.crewRandom(member) * (member.waypoints.length - 1));
          member.waypointIndex = (member.waypointIndex + next) % member.waypoints.length;
          member.mode = 'walk';
        }
      }
      const glance = member.mode === 'idle' ? Math.sin(member.motion * 0.8) * 8 : 0;
      member.entity.setEulerAngles(0, member.heading + glance, 0);
      this.poseCrew(member);
    }
  }

  private updateMarkers(_dt: number): void {
    const target = this.targetId ? this.targetPosition(this.targetId) : null;
    if (!target) { this.beacon.enabled = false; this.beam.enabled = false; this.routeMarks.forEach(mark => mark.enabled = false); return; }
    this.beacon.enabled = true;
    this.beam.enabled = true;
    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.15;
    this.beacon.setPosition(target.x, 0.075, target.z);
    this.beacon.setLocalScale(1.5 * pulse, 0.06, 1.5 * pulse);
    this.beam.setPosition(target.x, 3.7, target.z);
    this.beam.setLocalScale(0.12 + pulse * 0.04, 7.2, 0.12 + pulse * 0.04);
    const from = this.player.getPosition();
    const delta = V(target.x - from.x, 0, target.z - from.z);
    const distance = delta.length();
    if (distance < 6) { this.routeMarks.forEach(mark => mark.enabled = false); return; }
    delta.normalize();
    for (let i = 0; i < this.routeMarks.length; i++) {
      const mark = this.routeMarks[i];
      mark.enabled = true;
      mark.setPosition(from.x + delta.x * (2.6 + i * 2.3), 0.052, from.z + delta.z * (2.6 + i * 2.3));
      mark.setEulerAngles(0, -Math.atan2(delta.x, -delta.z) * pc.math.RAD_TO_DEG, 0);
    }
  }

  private updatePulses(dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      pulse.ttl -= dt;
      if (pulse.ttl <= 0) { pulse.entity.destroy(); this.pulses.splice(i, 1); continue; }
      const at = pulse.entity.getPosition();
      pulse.entity.setPosition(at.x + pulse.velocity.x * dt, at.y + pulse.velocity.y * dt, at.z + pulse.velocity.z * dt);
      pulse.velocity.y -= dt * 4;
      const s = pulse.baseScale * Math.min(1, pulse.ttl * 4);
      pulse.entity.setLocalScale(s * 0.12, s * 0.12, s * 0.12);
    }
  }

  private get windOnline(): boolean { return this._windOnline; }
  private get waterOnline(): boolean { return this._waterOnline; }
  private get sorterOnline(): boolean { return this._sorterOnline; }
  private _windOnline = false;
  private _waterOnline = false;
  private _sorterOnline = false;

  /** Restore loose cargo only when its saved location changes or a run is loaded. */
  sync(view: WorldView, restorePositions = false): void {
    this.phase = view.phase;
    this.targetId = view.targetId;
    this.canInteractTarget = view.canInteractTarget;
    this.repeaterAvailable = view.repeaterAvailable;
    this._sorterOnline = view.sorterOnline;
    this._waterOnline = view.waterOnline;
    this._windOnline = view.windOnline;
    this.heldId = null;
    for (const [id, data] of Object.entries(view.items)) {
      const entity = this.itemEntities.get(id);
      if (!entity) continue;
      entity.enabled = data.status === 'world' || data.status === 'held';
      const body = entity.rigidbody;
      const collider = entity.collision;
      const wasHeld = this.heldItemBodies.has(id);
      if (data.status === 'held') {
        this.heldId = id;
        if (!wasHeld) {
          // A carried item follows the hand visually; physics no longer fights
          // that position or collides with the player's capsule.
          if (body) body.enabled = false;
          if (collider) collider.enabled = false;
          this.heldItemBodies.add(id);
        }
        if (!wasHeld || restorePositions) entity.setPosition(this.heldItemTarget());
      } else if (wasHeld) {
        if (collider) collider.enabled = true;
        if (body) {
          body.enabled = true;
          body.teleport(entity.getPosition());
          body.linearVelocity = V(0, 0, 0);
          body.angularVelocity = V(0, 0, 0);
        }
        this.heldItemBodies.delete(id);
      }
      const point = data.position
        ? Array.isArray(data.position) ? data.position : [data.position.x, data.position.y, data.position.z]
        : null;
      const syncKey = `${data.status}:${point ? point.join(',') : 'home'}`;
      const changed = this.itemSyncKeys.get(id) !== syncKey;
      if (data.status === 'world' && body && (restorePositions || changed)) {
        const safe = WORLD_POINTS[id];
        body.teleport(point ? point[0] : safe.x, point ? Math.max(0.7, point[1]) : safe.y, point ? point[2] : safe.z);
        body.linearVelocity = V(0, 0, 0);
        body.angularVelocity = V(0, 0, 0);
      }
      this.itemSyncKeys.set(id, syncKey);
    }
    this.bots[0].entity.enabled = view.phase >= 1 && view.phase <= 3;
    this.bots[1].entity.enabled = view.phase >= 2 && view.phase <= 3;
    this.boss.enabled = view.phase >= 3 && !view.captured;
    this.weakpoints[0].enabled = !view.bossLeftDown;
    this.weakpoints[1].enabled = !view.bossRightDown;
    for (const [group, lamps] of this.serviceLamps) {
      const lit = group === 'sorter' ? view.sorterOnline : group === 'water' ? view.waterOnline : group === 'wind' ? view.windOnline : view.sorterOnline;
      for (const lamp of lamps) lamp.render!.material = lit ? this.activeLamp : this.inactiveLamp;
    }
    for (const window of this.communityLamps) window.render!.material = view.windOnline ? this.activeLamp : this.inactiveLamp;
    this.poolWater.render!.material = view.waterOnline ? this.waterActive : this.waterInactive;
    if (!view.repeaterAvailable && this.weapon === 'Seed Repeater') this.selectWeapon('Pod Burst');
  }

  get weaponName(): 'Pod Burst' | 'Seed Repeater' { return this.weapon; }

  get target(): string | null { return this.targetId; }

  targetPosition(id: string): pc.Vec3 | null {
    const entity = this.worldObjects.get(id);
    if (entity?.enabled) return entity.getPosition().clone();
    return WORLD_POINTS[id]?.clone() ?? null;
  }

  getGuidanceNav(): { distanceMeters: number; bearingDegrees: number } {
    const target = this.targetId ? this.targetPosition(this.targetId) : null;
    if (!target) return { distanceMeters: 0, bearingDegrees: 0 };
    const at = this.player.getPosition();
    const deltaX = target.x - at.x;
    const deltaZ = target.z - at.z;
    let relative = Math.atan2(deltaX, -deltaZ) + this.yaw;
    while (relative > Math.PI) relative -= 2 * Math.PI;
    while (relative < -Math.PI) relative += 2 * Math.PI;
    return { distanceMeters: Math.round(Math.hypot(deltaX, deltaZ)), bearingDegrees: relative * pc.math.RAD_TO_DEG };
  }

  projectTarget(): { x: number; y: number } | null {
    const target = this.targetId ? this.targetPosition(this.targetId) : null;
    if (!target || !this.camera.camera) return null;
    target.y = Math.max(1.6, target.y + 1.25);
    const toTarget = target.clone().sub(this.camera.getPosition());
    if (toTarget.dot(this.camera.forward) <= 0) return null;
    const projected = this.camera.camera.worldToScreen(target);
    const width = this.app.graphicsDevice.width;
    const height = this.app.graphicsDevice.height;
    if (projected.x < 30 || projected.y < 30 || projected.x > width - 30 || projected.y > height - 30) return null;
    return { x: projected.x / width, y: projected.y / height };
  }

  getWorldLabels(): WorldLabel[] {
    if (!this.camera.camera) return [];
    const cameraAt = this.camera.getPosition();
    const forward = this.camera.forward;
    const width = this.app.graphicsDevice.width;
    const height = this.app.graphicsDevice.height;
    const labels: WorldLabel[] = [];
    const add = (id: string, name: string, kind: WorldLabel['kind'], entity: pc.Entity, heightAboveFeet: number, maxDistance: number) => {
      if (!entity.enabled) return;
      const point = entity.getPosition().clone().add(V(0, heightAboveFeet, 0));
      const direction = point.clone().sub(cameraAt);
      const distance = direction.length();
      if (distance > maxDistance || direction.dot(forward) <= 0) return;
      const projected = this.camera.camera!.worldToScreen(point);
      if (projected.x < 48 || projected.y < 38 || projected.x > width - 48 || projected.y > height - 42) return;
      // Static buildings and loose cargo can hide labels. The player's own
      // collision capsule is excluded because the ray begins inside it.
      const occluder = this.app.systems.rigidbody?.raycastFirst(cameraAt, point, {
        filterCallback: (hitEntity: pc.Entity) => hitEntity !== this.player
      });
      if (occluder && occluder.point.distance(cameraAt) < distance - 0.55) return;
      labels.push({
        id, text: name, kind,
        x: projected.x / width, y: projected.y / height,
        opacity: pc.math.clamp((maxDistance - distance) / 3.5, 0, 1)
      });
    };
    for (const bot of this.bots) add(bot.id, bot.stun > 0 ? 'ROGUE TRASH CLEANER · STUNNED' : 'ROGUE TRASH CLEANER', 'threat', bot.entity, 2.15, 18);
    for (const member of this.crew) add(member.id, member.label, 'crew', member.entity, 2.05, 10);
    return labels;
  }

  private interactionChoice(): { kind: 'objective'; id: string } | { kind: 'crew'; member: CrewMember } | { kind: 'drop'; id: string } | null {
    const at = this.player.getPosition();
    if (this.canInteractTarget && this.targetId && !this.targetId.startsWith('boss_node')) {
      const target = this.targetPosition(this.targetId);
      if (target && Math.hypot(target.x - at.x, target.z - at.z) <= 3.15) return { kind: 'objective', id: this.targetId };
    }
    const facing = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let nearest: CrewMember | null = null;
    let nearestDistance = 2.65;
    for (const member of this.crew) {
      const where = member.entity.getPosition();
      const dx = where.x - at.x;
      const dz = where.z - at.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= nearestDistance || (distance > 1.15 && (dx * facing.x + dz * facing.z) / distance < -0.2)) continue;
      const from = at.clone().add(V(0, 0.55, 0));
      const to = where.clone().add(V(0, 1.2, 0));
      const wall = this.app.systems.rigidbody?.raycastFirst(from, to, {
        filterCallback: (entity: pc.Entity) => entity !== this.player && entity.rigidbody?.type === pc.BODYTYPE_STATIC
      });
      if (wall && wall.point.distance(from) < from.distance(to) - 0.25) continue;
      nearest = member;
      nearestDistance = distance;
    }
    if (nearest) return { kind: 'crew', member: nearest };
    return this.heldId ? { kind: 'drop', id: this.heldId } : null;
  }

  getInteraction(): { action: string; target?: string } | null {
    const choice = this.interactionChoice();
    if (!choice) return null;
    if (choice.kind === 'crew') return { action: 'Talk', target: choice.member.label };
    if (choice.kind === 'drop') return { action: 'Drop', target: 'carried cargo' };
    const item = this.itemEntities.has(choice.id);
    return { action: item ? this.heldId === choice.id ? 'Drop' : 'Pick up' : choice.id === 'extraction' ? 'Extract' : 'Interact', target: choice.id.replaceAll('_', ' ') };
  }

  setActive(active: boolean): void {
    if (!active && this.active) this.updateLook();
    this.active = active;
    if (!active) {
      this.keys.clear();
      this.fireHeld = false;
      this.lookDeltaX = this.lookDeltaY = 0;
      if (this.player.rigidbody) this.player.rigidbody.linearVelocity = V(0, 0, 0);
    }
  }

  requestPointerLock(): Promise<boolean> {
    if (document.pointerLockElement === this.canvas) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const finish = (locked: boolean) => {
        if (finished) return;
        finished = true;
        document.removeEventListener('pointerlockchange', changed);
        window.clearTimeout(timeout);
        resolve(locked);
      };
      const changed = () => {
        if (document.pointerLockElement === this.canvas) finish(true);
      };
      const failed = () => finish(false);
      document.addEventListener('pointerlockchange', changed);
      const timeout = window.setTimeout(() => finish(document.pointerLockElement === this.canvas), 1800);
      try {
        const requested = this.canvas.requestPointerLock();
        if (requested && typeof requested.catch === 'function') void requested.catch(failed);
      } catch {
        failed();
      }
    });
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
  }

  setSettings(sensitivity: number, fov: number, reducedEffects: boolean): void {
    this.settings = { sensitivity, fov, reducedEffects };
    this.camera.camera!.fov = fov;
  }

  getPose(): WorldPose {
    const at = this.player.getPosition();
    return { position: [at.x, at.y, at.z], yaw: this.yaw, pitch: this.pitch };
  }

  setPose(pose: WorldPose): void {
    this.player.rigidbody!.teleport(pose.position[0], Math.max(0.9, pose.position[1]), pose.position[2]);
    this.player.rigidbody!.linearVelocity = V(0, 0, 0);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.lookDeltaX = this.lookDeltaY = 0;
    this.updateThirdPersonCamera();
  }

  getItemPosition(id: string): [number, number, number] {
    const at = this.itemEntities.get(id)?.getPosition() ?? WORLD_POINTS[id];
    return [at.x, at.y, at.z];
  }

  resetBots(): void {
    for (const bot of this.bots) {
      bot.entity.setPosition(bot.home);
      bot.stun = 0;
      bot.attackCooldown = 0;
      bot.index = 1;
    }
  }

  getBots(): BotSnapshot[] {
    return this.bots.map(bot => {
      const at = bot.entity.getPosition();
      return { id: bot.id, position: [at.x, at.y, at.z], index: bot.index, stun: bot.stun, attackCooldown: bot.attackCooldown };
    });
  }

  setBots(saved: BotSnapshot[]): void {
    for (const snapshot of saved) {
      const bot = this.bots.find(entry => entry.id === snapshot.id);
      if (!bot || !Array.isArray(snapshot.position) || snapshot.position.length !== 3) continue;
      bot.entity.setPosition(...snapshot.position);
      bot.index = Math.max(0, Math.min(bot.path.length - 1, Math.trunc(snapshot.index) || 0));
      bot.stun = Math.max(0, snapshot.stun || 0);
      bot.attackCooldown = Math.max(0, snapshot.attackCooldown || 0);
    }
  }
}
