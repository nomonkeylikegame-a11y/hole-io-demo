import {
    Camera, Canvas, Color, Graphics, HorizontalTextAlignment, Label, Layers, Material,
    Mesh, MeshRenderer, Node, primitives, Texture2D, UITransform, utils, Vec3, view,
} from 'cc';
import { BOARD_HALF, CAMERA_YAW, PROPS, PropState, StackPattern, TIER_RADIUS } from './DistrictRules';

interface Geometry {
    positions: number[];
    uvs?: number[];
    indices?: number[];
}

export interface Art {
    paving: Texture2D;
    atlas: Texture2D;
    props: Record<string, Geometry>;
}

interface PropView {
    model: Node;
    shadow?: Node;
}

interface BlockSector {
    x: number;
    z: number;
    blocks: Set<Readonly<PropState>>;
    visible: boolean;
}

interface Spark {
    node: Node;
    time: number;
    life: number;
    size: number;
    x: number;
    z: number;
    dx: number;
    dz: number;
    lift: number;
}

type HudIcon = 'block' | 'audio' | 'muted' | 'replay';

const COL = { ink: '#172937', cream: '#fff6dc' };
const tint = (value: string): Color => Color.fromHEX(new Color(), value);
const countFormat = new Intl.NumberFormat('vi-VN');
const HOLE_SIDES = 64;
const HOLE_OPENING = 0.95;
const GROUND_RAYS = HOLE_SIDES + 4;
const SECTOR_SIZE = 6;
const CAMERA_ZOOM = 0.70;
const CAMERA_RIGHT_X = Math.cos(CAMERA_YAW);
const CAMERA_DEPTH_X = Math.sin(CAMERA_YAW);

export class DistrictView {
    private readonly world: Node;
    private readonly camera: Camera;
    private readonly canvas: Node;
    private readonly left: Node;
    private readonly controls: Node;
    private readonly finish: Node;
    private readonly objective: Label;
    private readonly status: Label;
    private readonly audio: Node;
    private readonly targets = new Map<Node, { width: number; height: number }>();
    private readonly props = new Map<Readonly<PropState>, PropView>();
    private readonly sectors = new Map<number, BlockSector>();
    private readonly spareBlocks = new Map<StackPattern, Node[]>();
    private readonly materials: Material[] = [];
    private readonly models: Mesh[] = [];
    private readonly meshes: Mesh[] = [];
    private readonly focus = new Vec3();
    private readonly hole: Node;
    private readonly ripple: Node;
    private readonly marker: Node;
    private readonly disk: Mesh;
    private readonly wave: Node;
    private readonly waveMaterial: Material;
    private readonly waveColor = new Color();
    private readonly sparks: Spark[] = [];
    private sparkCursor = 0;
    private lastBurst = -1;
    private growAt = -1;
    private impactAt = -1;
    private waveAt = -1;
    private waveRadius = 0;
    private waveAlpha = 0;
    private readonly groundAngles = new Float64Array(GROUND_RAYS);
    private readonly groundGeometry: primitives.IDynamicGeometry = {
        positions: new Float32Array(GROUND_RAYS * 6),
        uvs: new Float32Array(GROUND_RAYS * 4),
        indices16: new Uint16Array(this.ringIndices(GROUND_RAYS)),
        minPos: { x: -BOARD_HALF, y: 0, z: -BOARD_HALF },
        maxPos: { x: BOARD_HALF, y: 0, z: BOARD_HALF },
    };
    private readonly groundPose = new Vec3(Infinity, Infinity, Infinity);
    private ground?: Mesh;
    private softShadow!: Material;
    private propMaterial!: Material;
    private stackMaterials!: Record<StackPattern, Material>;
    private width = 0;
    private height = 0;

    constructor(parent: Node, onAudio: () => void, onRestart: () => void) {
        this.world = this.child(parent, 'Khu phố');
        this.camera = this.child(this.world, 'Camera 3D').addComponent(Camera);
        this.camera.projection = Camera.ProjectionType.ORTHO;
        this.camera.clearColor = tint('#eac397');
        this.camera.visibility = Layers.Enum.DEFAULT;
        this.camera.near = 0.1;
        this.camera.far = 150;

        this.disk = this.mesh(this.ring(0, 1));
        this.hole = this.child(this.world, 'Hố');
        this.addMesh(this.hole, 'Viền ngoài', this.mesh(this.ring(0.91, 1.015)),
            this.material('#e2b86f'), 0, 0.022, 0);
        const walls = [
            { radius: 0.95, depth: -0.004, color: '#526590' },
            { radius: 0.91, depth: -0.33, color: '#3b4b78' },
            { radius: 0.81, depth: -0.73, color: '#293657' },
            { radius: 0.63, depth: -1.15, color: '#1d2948' },
            { radius: 0.42, depth: -1.56, color: '#131c32' },
            { radius: 0.27, depth: -1.90, color: '#0d1427' },
        ];
        for (let i = 1; i < walls.length; i++) {
            const upper = walls[i - 1];
            const lower = walls[i];
            this.addMesh(this.hole, 'Thành hố', this.mesh(this.ring(lower.radius, upper.radius, lower.depth, upper.depth)),
                this.material(upper.color), 0, 0, 0);
        }
        const bottom = walls[walls.length - 1];
        this.addMesh(this.hole, 'Đáy hố', this.disk, this.material(bottom.color), 0, bottom.depth, 0)
            .setScale(bottom.radius, 1, bottom.radius);
        this.ripple = this.addMesh(this.hole, 'Gợn sáng', this.mesh(this.ring(0.972, 0.991)),
            this.material('#d3efe393'), 0, 0.026, 0);
        this.marker = this.child(this.hole, 'Dấu sáng');
        const dot = this.material('#a5deaf');
        for (let index = 0; index < 4; index++) {
            const turn = index * Math.PI / 2;
            this.addMesh(this.marker, 'Chấm', this.disk, dot, Math.cos(turn) * 0.966, 0.031, Math.sin(turn) * 0.966)
                .setScale(0.029, 1, 0.029);
        }
        this.waveMaterial = this.material('#b0ebd467');
        this.wave = this.addMesh(this.world, 'Sóng trên mặt đường', this.mesh(this.ring(0.974, 1)),
            this.waveMaterial, 0, 0.036, 0);
        this.wave.active = false;
        const chip = this.mesh(primitives.box());
        const sparkMaterials = [this.material('#a9eccd', undefined, true), this.material('#ffd285', undefined, true)];
        for (let i = 0; i < 30; i++) {
            const node = this.addMesh(this.world, 'Tia sáng', chip, sparkMaterials[i % 2], 0, 0, 0);
            node.active = false;
            this.sparks.push({ node, time: 0, life: 0, size: 0, x: 0, z: 0, dx: 0, dz: 0, lift: 0 });
        }
        this.pose(0, 0, TIER_RADIUS[0], 0, 0);
        this.follow(0, 0, TIER_RADIUS[0], 1, 0);

        this.canvas = this.child(parent, 'Giao diện', true);
        this.canvas.addComponent(UITransform).setContentSize(1280, 720);
        const hudCamera = this.child(this.canvas, 'Camera giao diện', true).addComponent(Camera);
        hudCamera.projection = Camera.ProjectionType.ORTHO;
        hudCamera.priority = 10;
        hudCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        hudCamera.visibility = Layers.Enum.UI_2D;
        hudCamera.far = 2000;
        this.canvas.addComponent(Canvas).cameraComponent = hudCamera;

        this.left = this.child(this.canvas, 'Thông tin', true);
        const blockIcon = this.child(this.left, 'Khối đã nuốt', true);
        blockIcon.setPosition(10, 0);
        this.drawIcon(blockIcon.addComponent(Graphics), 'block');
        this.objective = this.label(this.left, 'Đang dựng khu phố…', 24, true);
        this.objective.node.setPosition(28, 0);
        this.status = this.label(this.left, 'Cấp 1', 15);
        this.status.node.setPosition(28, -26);

        this.controls = this.child(this.canvas, 'Điều khiển', true);
        this.audio = this.iconButton(this.controls, 'Âm thanh', 'audio', onAudio);
        this.audio.setPosition(-66, 0);
        this.iconButton(this.controls, 'Chơi lại', 'replay', onRestart).setPosition(-22, 0);

        this.finish = this.child(this.canvas, 'Hoàn thành', true);
        this.label(this.finish, 'Đã dọn xong!', 32, true, true).node.setPosition(0, 24);
        this.iconButton(this.finish, 'Chơi lại', 'replay', onRestart).setPosition(0, -22);
        this.finish.active = false;
        this.resize();
    }

    build(art: Art): void {
        const box = this.mesh(primitives.box());
        const base = this.material('#b3795a');
        const trim = this.material('#efd09e');
        for (let side = 0; side < 4; side++) {
            const angle = side * Math.PI / 2;
            const edge = BOARD_HALF + 0.1;
            const x = Math.cos(angle) * edge;
            const z = Math.sin(angle) * edge;
            this.addMesh(this.world, 'Thành khu phố', box, base, x, -0.55, z)
                .setScale(side % 2 ? BOARD_HALF * 2 + 0.42 : 0.2, 0.57, side % 2 ? 0.2 : BOARD_HALF * 2 + 0.42);
            this.addMesh(this.world, 'Viền khu phố', box, trim, x, -0.14, z)
                .setScale(side % 2 ? BOARD_HALF * 2 + 0.44 : 0.22, 0.26, side % 2 ? 0.22 : BOARD_HALF * 2 + 0.44);
        }
        this.writeGround(0, 0, TIER_RADIUS[0]);
        this.ground = utils.MeshUtils.createDynamicMesh(0, this.groundGeometry, undefined, {
            maxSubMeshes: 1, maxSubMeshVertices: GROUND_RAYS * 2, maxSubMeshIndices: GROUND_RAYS * 6,
        });
        this.meshes.push(this.ground);
        this.addMesh(this.world, 'Mặt đường', this.ground, this.material('#ffffff', art.paving), 0, 0, 0);
        this.softShadow = this.material('#4b493c41');
        this.propMaterial = this.material('#ffffff', art.atlas);
        this.stackMaterials = {
            round: this.material('#76d8dd', art.atlas, true),
            pyramid: this.material('#ffad83', art.atlas, true),
            square: this.material('#c5a9ec', art.atlas, true),
            ring: this.material('#f694a4', art.atlas, true),
            cross: this.material('#a6d683', art.atlas, true),
            steps: this.material('#82aef5', art.atlas, true),
        };
        for (const prop of PROPS) this.models.push(this.mesh(art.props[prop.name]));
    }

    resetProps(props: Iterable<Readonly<PropState>>): void {
        for (const prop of this.props.keys()) this.releaseProp(prop);
        this.sectors.clear();
        for (const prop of props) {
            if (!prop.stack) {
                this.props.set(prop, this.createProp(prop));
                continue;
            }
            const col = Math.floor((prop.x + BOARD_HALF) / SECTOR_SIZE);
            const row = Math.floor((prop.z + BOARD_HALF) / SECTOR_SIZE);
            const key = this.sectorKey(col, row);
            let sector = this.sectors.get(key);
            if (!sector) {
                sector = {
                    x: (col + 0.5) * SECTOR_SIZE - BOARD_HALF,
                    z: (row + 0.5) * SECTOR_SIZE - BOARD_HALF,
                    blocks: new Set(), visible: false,
                };
                this.sectors.set(key, sector);
            }
            sector.blocks.add(prop);
        }
    }

    renderProp(prop: Readonly<PropState>, holeX: number, holeZ: number): void {
        let visual = this.props.get(prop);
        if (!visual && prop.entry) {
            visual = this.createProp(prop);
            this.props.set(prop, visual);
        }
        if (!visual) return;
        const { model, shadow } = visual;
        const { x, z, height, entry, angle } = prop;
        if (!entry) {
            model.setPosition(x, height, z);
            const lean = Math.min(7, prop.fallSpeed * 2.1);
            const column = prop.stack!.column;
            model.setRotationFromEuler(column % 2 ? lean : -lean, angle, column % 3 ? lean : -lean);
            return;
        }

        if (shadow) shadow.active = false;
        const depth = Math.min(1, -height / entry.depth);
        const inward = 1 - depth * 0.77;
        const scale = 1 - 0.86 * Math.max(0, (depth - 0.32) / 0.68) ** 1.6;
        model.setScale(scale, scale, scale);
        model.setRotationFromEuler(depth * 57, angle + depth * 68, depth * 21 * (entry.x < 0 ? -1 : 1));
        model.setPosition(holeX + entry.x * inward, height, holeZ + entry.z * inward);
    }

    removeProp(prop: Readonly<PropState>): void {
        if (prop.stack) {
            const col = Math.floor((prop.x + BOARD_HALF) / SECTOR_SIZE);
            const row = Math.floor((prop.z + BOARD_HALF) / SECTOR_SIZE);
            this.sectors.get(this.sectorKey(col, row))?.blocks.delete(prop);
        }
        this.releaseProp(prop);
    }

    private releaseProp(prop: Readonly<PropState>): void {
        const visual = this.props.get(prop);
        if (!visual) return;
        const { model, shadow } = visual;
        if (prop.stack) {
            const { pattern } = prop.stack;
            model.active = false;
            const pool = this.spareBlocks.get(pattern) ?? [];
            pool.push(model);
            this.spareBlocks.set(pattern, pool);
        } else {
            model.destroy();
            shadow?.destroy();
        }
        this.props.delete(prop);
    }

    private createProp(prop: Readonly<PropState>): PropView {
        const { tier, x, z, angle, height, stack } = prop;
        const cached = stack && this.spareBlocks.get(stack.pattern)?.pop();
        if (cached) {
            cached.setPosition(x, height, z);
            cached.setRotationFromEuler(0, angle, 0);
            cached.setScale(1, 1, 1);
            cached.active = true;
            return { model: cached };
        }
        const material = stack ? this.stackMaterials[stack.pattern] : this.propMaterial;
        const model = this.addMesh(this.world, PROPS[tier].name, this.models[tier], material, x, height, z);
        model.setRotationFromEuler(0, angle, 0);
        if (stack) return { model };
        const shadow = this.addMesh(this.world, 'Bóng', this.disk, this.softShadow, x + 0.13, 0.012, z + 0.14);
        const size = PROPS[tier].footprint;
        shadow.setScale(size * 1.15, 1, size * 0.83);
        shadow.setRotationFromEuler(0, angle, 0);
        return { model, shadow };
    }

    private sectorKey(col: number, row: number): number {
        return row * Math.ceil(BOARD_HALF * 2 / SECTOR_SIZE) + col;
    }

    private showCameraSectors(aspect: number): void {
        // Include the sector's corners and the visible tops of the tallest towers.
        const sectorMargin = (CAMERA_RIGHT_X + CAMERA_DEPTH_X) * SECTOR_SIZE * 0.5;
        const side = this.camera.orthoHeight * aspect + sectorMargin + 1.5;
        const depth = this.camera.orthoHeight * 1.22 + sectorMargin + 1;
        for (const sector of this.sectors.values()) {
            const x = sector.x - this.focus.x;
            const z = sector.z - this.focus.z;
            const slack = sector.visible ? 1 : 0;
            const along = x * CAMERA_DEPTH_X + z * CAMERA_RIGHT_X;
            const visible = Math.abs(x * CAMERA_RIGHT_X - z * CAMERA_DEPTH_X) <= side + slack &&
                along >= -depth - slack && along <= depth + slack + 4;
            if (visible === sector.visible) continue;

            sector.visible = visible;
            for (const block of sector.blocks) {
                if (visible) {
                    if (!this.props.has(block)) this.props.set(block, this.createProp(block));
                } else if (!block.entry) {
                    this.releaseProp(block);
                }
            }
        }
    }

    resetFeedback(): void {
        this.sparkCursor = 0;
        this.lastBurst = this.growAt = this.impactAt = -1;
        for (const spark of this.sparks) spark.node.active = false;
        this.startWave(0, 0, TIER_RADIUS[0], 0, false);
    }

    swallowEffect(x: number, z: number, radius: number, time: number, count: number, heavy: boolean): void {
        if (heavy) this.impactAt = time;
        if (time - this.lastBurst < 0.09) return;
        this.lastBurst = time;
        this.burst(x, z, radius, time, Math.min(8, 3 + Math.floor(Math.sqrt(count))), heavy ? 1.4 : 0.85);
    }

    growEffect(x: number, z: number, radius: number, time: number): void {
        this.growAt = this.impactAt = time;
        this.startWave(x, z, radius, time, true);
        this.burst(x, z, radius, time, 20, 1.7);
    }

    private burst(x: number, z: number, radius: number, time: number, count: number, strength: number): void {
        for (let i = 0; i < count; i++) {
            const index = this.sparkCursor++;
            const spark = this.sparks[index % this.sparks.length];
            const angle = index * 2.399963;
            const dx = Math.cos(angle);
            const dz = Math.sin(angle);
            spark.time = time;
            spark.life = 0.25 + (i % 5) * 0.04;
            spark.size = (0.045 + (i % 3) * 0.018) * strength;
            spark.x = x + dx * radius * 0.89;
            spark.z = z + dz * radius * 0.89;
            const speed = (0.75 + (i % 4) * 0.28) * strength;
            spark.dx = dx * speed;
            spark.dz = dz * speed;
            spark.lift = (0.85 + (i % 4) * 0.3) * strength;
            spark.node.active = true;
        }
    }

    private startWave(x: number, z: number, radius: number, time: number, growth: boolean): void {
        this.wave.setPosition(x, 0.036, z);
        this.wave.active = true;
        this.waveRadius = radius;
        this.waveAt = time;
        this.waveAlpha = growth ? 208 : 144;
        if (growth) this.waveColor.set(255, 204, 126, this.waveAlpha);
        else this.waveColor.set(176, 235, 212, this.waveAlpha);
    }

    private updateFeedback(time: number): void {
        if (this.wave.active) {
            const progress = (time - this.waveAt) / 0.72;
            if (progress >= 1) this.wave.active = false;
            else {
                const remaining = 1 - progress;
                const width = this.waveRadius * (2.95 - 1.98 * remaining * remaining);
                this.wave.setScale(width, 1, width);
                this.waveColor.a = Math.round(this.waveAlpha * remaining * remaining);
                this.waveMaterial.setProperty('mainColor', this.waveColor);
            }
        }
        for (const spark of this.sparks) {
            if (!spark.node.active) continue;
            const age = time - spark.time;
            const remaining = 1 - age / spark.life;
            if (remaining <= 0) {
                spark.node.active = false;
                continue;
            }
            spark.node.setPosition(spark.x + spark.dx * age, 0.045 + spark.lift * age * remaining, spark.z + spark.dz * age);
            const size = spark.size * remaining;
            spark.node.setScale(size, size, size);
            spark.node.setRotationFromEuler(age * 330, spark.x * 45, age * 480);
        }
    }

    pose(x: number, z: number, radius: number, time: number, pulse: number): void {
        this.hole.setPosition(x, 0, z);
        this.hole.setScale(radius, radius, radius);
        if (this.ground && !this.groundPose.equals3f(x, z, radius)) {
            this.writeGround(x, z, radius);
            this.ground.updateSubMesh(0, this.groundGeometry);
        }
        const ripple = 1 + pulse * 0.02;
        this.ripple.setScale(ripple, 1, ripple);
        this.marker.setRotationFromEuler(0, time * 25, 0);
        this.updateFeedback(time);
    }

    follow(x: number, z: number, radius: number, blend: number, time: number): void {
        const size = view.getVisibleSize();
        const portrait = size.width / size.height < 1.1;
        const followAmount = portrait ? 0.96 : 0.78;
        const targetX = x * followAmount;
        const targetZ = z * followAmount;
        this.focus.x += (targetX - this.focus.x) * blend;
        this.focus.z += (targetZ - this.focus.z) * blend;
        const intro = Math.max(0, 1 - time / 0.94) ** 3;
        const growth = (time - this.growAt) / 0.68;
        const recoil = growth < 1 ? Math.sin(growth * Math.PI) * (1 - growth) * 1.1 : 0;
        const targetZoom = ((portrait ? 8.25 : 7.2) + radius * 2.15 + intro * 2.6 + recoil) * CAMERA_ZOOM;
        this.camera.orthoHeight += (targetZoom - this.camera.orthoHeight) * blend;
        const impact = time - this.impactAt;
        const shake = Math.max(0, 1 - impact / 0.28) ** 2;
        const distance = 24 + 2.4 * intro;
        this.camera.node.setPosition(
            this.focus.x + Math.sin(CAMERA_YAW) * distance + Math.sin(impact * 69) * shake * 0.15,
            36 + 3.6 * intro,
            this.focus.z + Math.cos(CAMERA_YAW) * distance + Math.cos(impact * 79) * shake * 0.12,
        );
        this.camera.node.lookAt(this.focus);
        this.showCameraSectors(size.width / size.height);
    }

    resize(): void {
        const { width, height } = view.getVisibleSize();
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
        this.canvas.setPosition(width / 2, height / 2);
        this.canvas.getComponent(UITransform)!.setContentSize(width, height);
        const camera = this.canvas.getComponent(Canvas)!.cameraComponent!;
        camera.orthoHeight = height / 2;
        camera.node.setPosition(0, 0, 1000);

        const margin = width < 635 ? 12 : 24;
        const leftEdge = -width / 2 + margin;
        const topEdge = height / 2 - margin;
        this.left.setPosition(leftEdge, topEdge - 18);
        this.controls.setPosition(width / 2 - margin, topEdge - 18);
    }

    updateStatus(tier: number, eaten: number, total: number): void {
        this.objective.string = `${countFormat.format(eaten)} / ${countFormat.format(total)}`;
        this.status.string = `Cấp ${tier + 1}`;
    }

    showLoadError(): void {
        this.objective.string = 'Không tải được khu phố.';
    }

    setMuted(muted: boolean): void {
        this.drawIcon(this.audio.getComponent(Graphics)!, muted ? 'muted' : 'audio');
    }

    showFinish(visible: boolean): void {
        this.finish.active = visible;
    }

    controlAt(x: number, y: number): boolean {
        for (const [node, size] of this.targets) {
            const pos = node.worldPosition;
            if (node.activeInHierarchy &&
                Math.abs(pos.x - x) <= size.width / 2 && Math.abs(pos.y - y) <= size.height / 2) return true;
        }
        return false;
    }

    dispose(): void {
        this.world.destroy();
        this.canvas.destroy();
        for (const mesh of this.meshes) mesh.destroy();
        for (const material of this.materials) material.destroy();
    }

    private mesh(geo: Geometry): Mesh {
        const mesh = utils.MeshUtils.createMesh(geo, undefined, { calculateBounds: true });
        this.meshes.push(mesh);
        return mesh;
    }

    private material(hex: string, texture?: Texture2D, instanced = false): Material {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', technique: hex.length === 9 ? 1 : 0,
            defines: { USE_TEXTURE: !!texture, USE_INSTANCING: instanced } });
        material.setProperty('mainColor', tint(hex));
        if (texture) material.setProperty('mainTexture', texture);
        this.materials.push(material);
        return material;
    }

    private addMesh(parent: Node, name: string, mesh: Mesh, material: Material, x: number, y: number, z: number): Node {
        const node = this.child(parent, name);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setSharedMaterial(material, 0);
        node.setPosition(x, y, z);
        return node;
    }

    private child(parent: Node, name: string, ui = false): Node {
        const node = new Node(name);
        node.layer = ui ? Layers.Enum.UI_2D : Layers.Enum.DEFAULT;
        node.parent = parent;
        return node;
    }

    private writeGround(x: number, z: number, radius: number): void {
        // Project the hole perimeter onto the square board. The four corner rays keep the outer edges exact.
        const turn = Math.PI * 2;
        const half = BOARD_HALF;
        const angles = this.groundAngles;
        for (let i = 0; i < HOLE_SIDES; i++) angles[i] = i * turn / HOLE_SIDES;
        let corner = HOLE_SIDES;
        for (const cornerX of [-half, half]) {
            for (const cornerZ of [-half, half]) {
                const angle = Math.atan2(cornerZ - z, cornerX - x);
                angles[corner++] = angle < 0 ? angle + turn : angle;
            }
        }
        angles.sort();
        const { positions, uvs } = this.groundGeometry;
        const opening = radius * HOLE_OPENING;
        for (let i = 0; i < angles.length; i++) {
            const dx = Math.cos(angles[i]);
            const dz = Math.sin(angles[i]);
            const edgeX = ((dx >= 0 ? half : -half) - x) / dx;
            const edgeZ = ((dz >= 0 ? half : -half) - z) / dz;
            const edge = Math.min(edgeX, edgeZ);
            const innerX = x + dx * opening;
            const innerZ = z + dz * opening;
            const outerX = x + dx * edge;
            const outerZ = z + dz * edge;
            positions[i * 6] = innerX;
            positions[i * 6 + 2] = innerZ;
            positions[i * 6 + 3] = outerX;
            positions[i * 6 + 5] = outerZ;
            uvs![i * 4] = (innerX + half) / (half * 2);
            uvs![i * 4 + 1] = (innerZ + half) / (half * 2);
            uvs![i * 4 + 2] = (outerX + half) / (half * 2);
            uvs![i * 4 + 3] = (outerZ + half) / (half * 2);
        }
        this.groundPose.set(x, z, radius);
    }

    private ring(inner: number, outer: number, innerY = 0, outerY = 0): Geometry {
        const positions: number[] = [];
        for (let i = 0; i < HOLE_SIDES; i++) {
            const angle = (i / HOLE_SIDES) * Math.PI * 2;
            const x = Math.cos(angle);
            const z = Math.sin(angle);
            positions.push(x * inner, innerY, z * inner, x * outer, outerY, z * outer);
        }
        return { positions, indices: this.ringIndices(HOLE_SIDES) };
    }

    private ringIndices(sides: number): number[] {
        const indices: number[] = [];
        for (let i = 0; i < sides; i++) {
            const next = ((i + 1) % sides) * 2;
            indices.push(i * 2, next, i * 2 + 1, i * 2 + 1, next, next + 1);
        }
        return indices;
    }

    private label(parent: Node, text: string, size: number, bold = false, center = false): Label {
        const node = this.child(parent, text || 'Nhãn', true);
        const label = node.addComponent(Label);
        node.getComponent(UITransform)!.setAnchorPoint(center ? 0.5 : 0, 0.5);
        label.horizontalAlign = center ? HorizontalTextAlignment.CENTER : HorizontalTextAlignment.LEFT;
        label.fontFamily = 'sans-serif';
        label.fontSize = size;
        label.lineHeight = size + 4;
        label.enableWrapText = false;
        label.isBold = bold;
        label.color = tint(COL.ink);
        label.enableOutline = true;
        label.outlineColor = tint(COL.cream);
        label.outlineWidth = 2;
        label.string = text;
        return label;
    }

    private iconButton(parent: Node, name: string, icon: HudIcon, action: () => void): Node {
        const hit = this.child(parent, name, true);
        hit.addComponent(UITransform).setContentSize(44, 44);
        this.drawIcon(hit.addComponent(Graphics), icon);
        hit.on(Node.EventType.TOUCH_END, action);
        this.targets.set(hit, { width: 44, height: 44 });
        return hit;
    }

    private drawIcon(shape: Graphics, icon: HudIcon): void {
        shape.clear();
        shape.lineCap = Graphics.LineCap.ROUND;
        shape.lineJoin = Graphics.LineJoin.ROUND;
        for (const { color, width } of [{ color: COL.cream, width: 5 }, { color: COL.ink, width: 2 }]) {
            shape.strokeColor = tint(color);
            shape.lineWidth = width;
            if (icon === 'block') {
                shape.moveTo(-7, 5);
                shape.lineTo(0, 9);
                shape.lineTo(7, 5);
                shape.lineTo(7, -4);
                shape.lineTo(0, -8);
                shape.lineTo(-7, -4);
                shape.close();
                shape.moveTo(-7, 5);
                shape.lineTo(0, 1);
                shape.lineTo(7, 5);
                shape.moveTo(0, 1);
                shape.lineTo(0, -8);
            } else if (icon === 'replay') {
                shape.moveTo(8, 3);
                shape.bezierCurveTo(4, 11, -10, 9, -9, -1);
                shape.bezierCurveTo(-8, -10, 6, -10, 9, -2);
                shape.moveTo(8, 9);
                shape.lineTo(8, 3);
                shape.lineTo(2, 3);
            } else {
                shape.moveTo(-10, -3);
                shape.lineTo(-6, -3);
                shape.lineTo(-1, -7);
                shape.lineTo(-1, 7);
                shape.lineTo(-6, 3);
                shape.lineTo(-10, 3);
                shape.close();
                if (icon === 'muted') {
                    shape.moveTo(4, 4);
                    shape.lineTo(10, -4);
                    shape.moveTo(4, -4);
                    shape.lineTo(10, 4);
                } else {
                    shape.moveTo(3, 4);
                    shape.quadraticCurveTo(9, 0, 3, -4);
                    shape.moveTo(7, 7);
                    shape.quadraticCurveTo(15, 0, 7, -7);
                }
            }
            shape.stroke();
        }
    }
}
