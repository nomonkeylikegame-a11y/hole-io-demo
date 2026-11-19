import {
    Camera, Canvas, Color, Graphics, HorizontalTextAlignment, Label, Layers, Material,
    Mesh, MeshRenderer, Node, primitives, Texture2D, UITransform, utils, Vec3, view,
} from 'cc';
import { BOARD_HALF, CAMERA_YAW, PROPS, PropState, StackPattern, TIER_MASS, TIER_RADIUS } from './DistrictRules';

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

const COL = {
    ink: '#172937', panel: '#223846', cream: '#fff6dc', muted: '#c0d1c4',
    mint: '#a6e0ab',
};
const tint = (value: string): Color => Color.fromHEX(new Color(), value);

export class DistrictView {
    private readonly world: Node;
    private readonly camera: Camera;
    private readonly canvas: Node;
    private readonly left: Node;
    private readonly controls: Node;
    private readonly finish: Node;
    private readonly title: Label;
    private readonly objective: Label;
    private readonly status: Label;
    private readonly progress: Graphics;
    private readonly audio: Label;
    private readonly replay: Label;
    private readonly targets = new Map<Node, { width: number; height: number }>();
    private readonly props = new Map<Readonly<PropState>, PropView>();
    private readonly materials: Material[] = [];
    private readonly models: Mesh[] = [];
    private readonly meshes: Mesh[] = [];
    private readonly focus = new Vec3();
    private readonly hole: Node;
    private readonly ripple: Node;
    private readonly marker: Node;
    private readonly disk: Mesh;
    private softShadow!: Material;
    private propMaterial!: Material;
    private stackMaterials!: Record<StackPattern, Material>;
    private statsWidth = 282;
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
        this.addMesh(this.hole, 'Viền ngoài', this.disk, this.material('#e2b86f'), 0, 0.042, 0);
        this.addMesh(this.hole, 'Vực sâu', this.disk, this.material('#11192f'), 0, 0.05, 0).setScale(0.945, 1, 0.945);
        this.addMesh(this.hole, 'Lòng hố', this.mesh(this.ring(0.74, 0.93)),
            this.material('#293756'), 0, 0.06, 0);
        this.ripple = this.addMesh(this.hole, 'Gợn sáng', this.mesh(this.ring(0.9, 0.925)),
            this.material('#91b4ad65'), 0, 0.07, 0);
        this.marker = this.child(this.hole, 'Dấu sáng');
        const dot = this.material('#a5deaf');
        for (let index = 0; index < 4; index++) {
            const turn = index * Math.PI / 2;
            this.addMesh(this.marker, 'Chấm', this.disk, dot, Math.cos(turn) * 0.967, 0.076, Math.sin(turn) * 0.967)
                .setScale(0.041, 1, 0.041);
        }
        this.pose(0, 0, TIER_RADIUS[0], 0, 0);
        this.follow(0, 0, TIER_RADIUS[0], 1);

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
        this.title = this.label(this.left, 'Pocket District', 34, COL.cream, true);
        this.objective = this.label(this.left, 'Đang dựng khu phố…', 16, COL.muted);
        this.status = this.label(this.left, 'CẤP 01', 15, COL.mint, true);
        this.progress = this.child(this.left, 'Thanh tiến độ', true).addComponent(Graphics);

        this.controls = this.child(this.canvas, 'Điều khiển', true);
        this.audio = this.button(this.controls, 'Có tiếng', 105, onAudio);
        this.replay = this.button(this.controls, 'Chơi lại', 91, onRestart);

        this.finish = this.child(this.canvas, 'Hoàn thành', true);
        this.label(this.finish, 'Đã dọn xong!', 32, COL.cream, true, true).node.setPosition(0, 43);
        this.label(this.finish, 'Đã nuốt hết vật thể.', 15, COL.muted, false, true)
            .node.setPosition(0, 7);
        this.button(this.finish, 'Chơi lại', 126, onRestart).node.parent!.setPosition(0, -42);
        this.finish.active = false;
        this.resize();
    }

    build(art: Art): void {
        const box = this.mesh(primitives.box());
        const base = this.addMesh(this.world, 'Đế khu phố', box, this.material('#b3795a'), 0, -0.56, 0);
        base.setScale(BOARD_HALF * 2 + 0.42, 0.58, BOARD_HALF * 2 + 0.42);
        const band = this.addMesh(this.world, 'Viền khu phố', box, this.material('#efd09e'), 0, -0.22, 0);
        band.setScale(BOARD_HALF * 2 + 0.55, 0.39, BOARD_HALF * 2 + 0.55);
        const half = BOARD_HALF;
        const ground = this.mesh({
            positions: [-half, 0, -half, -half, 0, half, half, 0, half, half, 0, -half],
            uvs: [0, 0, 0, 1, 1, 1, 1, 0],
            indices: [0, 1, 2, 0, 2, 3],
        });
        this.addMesh(this.world, 'Mặt đường', ground, this.material('#ffffff', art.paving), 0, 0, 0);
        this.softShadow = this.material('#4b493c41');
        this.propMaterial = this.material('#ffffff', art.atlas);
        this.stackMaterials = {
            round: this.material('#76d8dd', art.atlas, true),
            pyramid: this.material('#ffad83', art.atlas, true),
            square: this.material('#c5a9ec', art.atlas, true),
        };
        for (const prop of PROPS) this.models.push(this.mesh(art.props[prop.name]));
    }

    resetProps(props: readonly Readonly<PropState>[]): void {
        for (const prop of this.props.keys()) this.removeProp(prop);
        for (const prop of props) this.props.set(prop, this.createProp(prop));
    }

    renderProp(prop: Readonly<PropState>, holeX: number, holeZ: number): void {
        const { model, shadow } = this.props.get(prop)!;
        const { x, z, height, swallow, angle } = prop;
        if (swallow < 0) {
            model.setPosition(x, height, z);
            return;
        }

        if (shadow) shadow.active = false;
        const scale = Math.max(0.025, 1 - swallow * swallow);
        model.setScale(scale, scale, scale);
        model.setRotationFromEuler(swallow * 55, angle + swallow * 108, -swallow * 13);
        model.setPosition(x + (holeX - x) * swallow, -0.76 * swallow * swallow, z + (holeZ - z) * swallow);
    }

    removeProp(prop: Readonly<PropState>): void {
        const { model, shadow } = this.props.get(prop)!;
        model.destroy();
        shadow?.destroy();
        this.props.delete(prop);
    }

    private createProp(prop: Readonly<PropState>): PropView {
        const { tier, x, z, angle, height, stack } = prop;
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

    pose(x: number, z: number, radius: number, time: number, pulse: number): void {
        this.hole.setPosition(x, 0, z);
        this.hole.setScale(radius * (1 + pulse * 0.07), 1, radius * (1 + pulse * 0.07));
        const ripple = 0.84 + 0.12 * (0.5 + 0.5 * Math.sin(time * 3));
        this.ripple.setScale(ripple, 1, ripple);
        this.marker.setRotationFromEuler(0, time * 25, 0);
    }

    follow(x: number, z: number, radius: number, blend: number): void {
        const size = view.getVisibleSize();
        const portrait = size.width / size.height < 1.1;
        const followAmount = portrait ? 0.83 : 0.43;
        const targetX = x * followAmount;
        const targetZ = z * followAmount;
        this.focus.x += (targetX - this.focus.x) * blend;
        this.focus.z += (targetZ - this.focus.z) * blend;
        const targetZoom = (portrait ? 12.2 : 11.2) + radius * 1.85;
        this.camera.orthoHeight += (targetZoom - this.camera.orthoHeight) * blend;
        this.camera.node.setPosition(this.focus.x + Math.sin(CAMERA_YAW) * 24, 36, this.focus.z + Math.cos(CAMERA_YAW) * 24);
        this.camera.node.lookAt(this.focus);
    }

    resize(): boolean {
        const { width, height } = view.getVisibleSize();
        if (width === this.width && height === this.height) return false;
        this.width = width;
        this.height = height;
        this.canvas.setPosition(width / 2, height / 2);
        this.canvas.getComponent(UITransform)!.setContentSize(width, height);
        const camera = this.canvas.getComponent(Canvas)!.cameraComponent!;
        camera.orthoHeight = height / 2;
        camera.node.setPosition(0, 0, 1000);

        const compact = width < 635;
        const margin = compact ? 12 : 26;
        const leftEdge = -width / 2 + margin;
        const topEdge = height / 2 - margin;
        this.statsWidth = compact ? Math.min(292, width - 2 * margin) : 304;
        this.left.setPosition(leftEdge + this.statsWidth / 2, topEdge - 65);
        this.panel(this.left, this.statsWidth, 130, COL.ink);
        const start = -this.statsWidth / 2 + 18;
        this.title.node.setPosition(start, 37);
        this.objective.node.setPosition(start, 4);
        this.status.node.setPosition(start, -24);
        this.progress.node.setPosition(start, -46);

        this.controls.setPosition(width / 2 - margin, topEdge - (compact ? 160 : 24));
        this.audio.node.parent!.setPosition(-154, 0);
        this.replay.node.parent!.setPosition(-45.5, 0);
        this.panel(this.finish, Math.min(320, width - 2 * margin), 170, COL.ink);
        return true;
    }

    updateStatus(mass: number, tier: number, eaten: number, total: number): void {
        this.objective.string = `${eaten} / ${total} vật đã nuốt`;
        const nextTier = TIER_MASS[tier + 1];
        this.status.string = nextTier
            ? `CẤP 0${tier + 1}     ·     ${mass}/${nextTier} KHỐI LƯỢNG`
            : `CẤP 0${tier + 1}     ·     KÍCH THƯỚC TỐI ĐA`;
        const width = this.statsWidth - 36;
        const progress = nextTier ? (mass - TIER_MASS[tier]) / (nextTier - TIER_MASS[tier]) : 1;
        this.progress.clear();
        this.fill(this.progress, 0, 0, width, 6, 3, COL.panel);
        if (progress > 0) this.fill(this.progress, 0, 0, Math.max(6, width * progress), 6, 3, COL.mint);
    }

    showLoadError(): void {
        this.objective.string = 'Không tải được khu phố.';
    }

    setMuted(muted: boolean): void {
        this.audio.string = muted ? 'Tắt tiếng' : 'Có tiếng';
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

    private ring(inner: number, outer: number): Geometry {
        const positions: number[] = [];
        const indices: number[] = [];
        const sides = 64;
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const x = Math.cos(angle);
            const z = Math.sin(angle);
            positions.push(x * inner, 0, z * inner, x * outer, 0, z * outer);
            const next = ((i + 1) % sides) * 2;
            indices.push(i * 2, next, i * 2 + 1, i * 2 + 1, next, next + 1);
        }
        return { positions, indices };
    }

    private label(parent: Node, text: string, size: number, color: string, bold = false, center = false): Label {
        const node = this.child(parent, text || 'Nhãn', true);
        const label = node.addComponent(Label);
        node.getComponent(UITransform)!.setAnchorPoint(center ? 0.5 : 0, 0.5);
        label.horizontalAlign = center ? HorizontalTextAlignment.CENTER : HorizontalTextAlignment.LEFT;
        label.fontFamily = 'sans-serif';
        label.fontSize = size;
        label.lineHeight = size + 4;
        label.enableWrapText = false;
        label.isBold = bold;
        label.color = tint(color);
        label.string = text;
        return label;
    }

    private panel(parent: Node, width: number, height: number, color: string): void {
        // Draw the background before the text children so the HUD batches in reading order.
        let bg = parent.getChildByName('Nền');
        if (!bg) {
            bg = this.child(parent, 'Nền', true);
            bg.addComponent(Graphics);
            bg.setSiblingIndex(0);
        }
        const shape = bg.getComponent(Graphics)!;
        shape.clear();
        this.fill(shape, -width / 2, -height / 2, width, height, 13, color);
    }

    private fill(shape: Graphics, x: number, y: number, width: number, height: number, radius: number, color: string): void {
        shape.fillColor = tint(color);
        shape.roundRect(x, y, width, height, radius);
        shape.fill();
    }

    private button(parent: Node, text: string, width: number, action: () => void): Label {
        const hit = this.child(parent, text, true);
        hit.addComponent(UITransform).setContentSize(width, 46);
        this.panel(hit, width, 46, COL.ink);
        hit.on(Node.EventType.TOUCH_END, action);
        this.targets.set(hit, { width, height: 46 });
        return this.label(hit, text, 16, COL.cream, true, true);
    }
}
