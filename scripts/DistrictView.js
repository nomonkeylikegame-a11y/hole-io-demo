import { Camera, Canvas, Color, Graphics, HorizontalTextAlignment, Label, Layers, Material, MeshRenderer, Node, primitives, UITransform, utils, Vec3, view, } from 'cc';
import { BOARD_HALF, CAMERA_YAW, PROPS, TIER_MASS } from './DistrictRules.js';
const COL = {
    ink: '#172937', panel: '#223846', cream: '#fff6dc', muted: '#c0d1c4',
    mint: '#a6e0ab', gold: '#ffc877', light: '#f8e8bf',
};
const tint = (value) => Color.fromHEX(new Color(), value);
export class DistrictView {
    constructor(parent, onAudio, onRestart) {
        this.targets = new Map();
        this.materials = new Map();
        this.models = [];
        this.meshes = [];
        this.focus = new Vec3();
        this.statsWidth = 282;
        this.width = 0;
        this.height = 0;
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
        this.addMesh(this.hole, 'Lòng hố', this.mesh(this.ring(0.74, 0.93)), this.material('#293756'), 0, 0.06, 0);
        this.ripple = this.addMesh(this.hole, 'Gợn sáng', this.mesh(this.ring(0.9, 0.925)), this.material('#91b4ad65'), 0, 0.07, 0);
        this.marker = this.child(this.hole, 'Dấu sáng');
        const dot = this.material('#a5deaf');
        for (let index = 0; index < 4; index++) {
            const turn = index * Math.PI / 2;
            this.addMesh(this.marker, 'Chấm', this.disk, dot, Math.cos(turn) * 0.967, 0.076, Math.sin(turn) * 0.967)
                .setScale(0.041, 1, 0.041);
        }
        this.pose(0, 0, 0.68, 0, 0);
        this.follow(0, 0, 0.68, 1);
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
        this.bottom = this.child(this.canvas, 'Gợi ý', true);
        this.hint = this.label(this.bottom, '', 16, COL.cream, true, true);
        this.finish = this.child(this.canvas, 'Hoàn thành', true);
        this.label(this.finish, 'Đã dọn xong!', 32, COL.cream, true, true).node.setPosition(0, 43);
        this.label(this.finish, 'Đã nuốt hết vật thể.', 15, COL.muted, false, true)
            .node.setPosition(0, 7);
        this.button(this.finish, 'Chơi lại', 126, onRestart).node.parent.setPosition(0, -42);
        this.finish.active = false;
        this.resize();
    }
    build(art) {
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
        for (const prop of PROPS)
            this.models.push(this.mesh(art.props[prop.name]));
    }
    createProp(placement) {
        const { tier, x, z, angle } = placement;
        const model = this.addMesh(this.world, PROPS[tier].name, this.models[tier], this.propMaterial, x, 0, z);
        model.setRotationFromEuler(0, angle, 0);
        const shadow = this.addMesh(this.world, 'Bóng', this.disk, this.softShadow, x + 0.13, 0.012, z + 0.14);
        const size = PROPS[tier].footprint;
        shadow.setScale(size * 1.15, 1, size * 0.83);
        shadow.setRotationFromEuler(0, angle, 0);
        return { model, shadow };
    }
    pose(x, z, radius, time, pulse) {
        this.hole.setPosition(x, 0, z);
        this.hole.setScale(radius * (1 + pulse * 0.07), 1, radius * (1 + pulse * 0.07));
        const ripple = 0.84 + 0.12 * (0.5 + 0.5 * Math.sin(time * 3));
        this.ripple.setScale(ripple, 1, ripple);
        this.marker.setRotationFromEuler(0, time * 25, 0);
    }
    follow(x, z, radius, blend) {
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
    resize() {
        const { width, height } = view.getVisibleSize();
        if (width === this.width && height === this.height)
            return false;
        this.width = width;
        this.height = height;
        this.canvas.setPosition(width / 2, height / 2);
        this.canvas.getComponent(UITransform).setContentSize(width, height);
        const camera = this.canvas.getComponent(Canvas).cameraComponent;
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
        this.audio.node.parent.setPosition(-154, 0);
        this.replay.node.parent.setPosition(-45.5, 0);
        this.bottom.setPosition(0, -height / 2 + margin + 23);
        const hintWidth = Math.min(438, width - 2 * margin);
        this.panel(this.bottom, hintWidth, 44, COL.ink);
        this.hint.overflow = Label.Overflow.SHRINK;
        this.hint.node.getComponent(UITransform).setContentSize(hintWidth - 24, 38);
        this.panel(this.finish, Math.min(320, width - 2 * margin), 170, COL.ink);
        return true;
    }
    updateStatus(mass, tier, eaten, total) {
        this.objective.string = `${eaten} / ${total} vật đã nuốt`;
        const nextTier = TIER_MASS[tier + 1];
        this.status.string = nextTier
            ? `CẤP 0${tier + 1}     ·     ${mass}/${nextTier} KHỐI LƯỢNG`
            : `CẤP 0${tier + 1}     ·     KÍCH THƯỚC TỐI ĐA`;
        const width = this.statsWidth - 36;
        const progress = nextTier ? (mass - TIER_MASS[tier]) / (nextTier - TIER_MASS[tier]) : 1;
        this.progress.clear();
        this.fill(this.progress, 0, 0, width, 6, 3, COL.panel);
        if (progress > 0)
            this.fill(this.progress, 0, 0, Math.max(6, width * progress), 6, 3, COL.mint);
    }
    message(text) {
        this.hint.string = text;
    }
    setMuted(muted) {
        this.audio.string = muted ? 'Tắt tiếng' : 'Có tiếng';
    }
    showFinish(visible) {
        this.finish.active = visible;
    }
    controlAt(x, y) {
        for (const [node, size] of this.targets) {
            const pos = node.worldPosition;
            if (node.activeInHierarchy &&
                Math.abs(pos.x - x) <= size.width / 2 && Math.abs(pos.y - y) <= size.height / 2)
                return true;
        }
        return false;
    }
    dispose() {
        this.world.destroy();
        this.canvas.destroy();
        for (const mesh of this.meshes)
            mesh.destroy();
        for (const material of this.materials.values())
            material.destroy();
    }
    mesh(geo) {
        const mesh = utils.MeshUtils.createMesh(geo, undefined, { calculateBounds: true });
        this.meshes.push(mesh);
        return mesh;
    }
    material(hex, texture) {
        const key = texture !== null && texture !== void 0 ? texture : hex;
        const existing = this.materials.get(key);
        if (existing)
            return existing;
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', technique: hex.length === 9 ? 1 : 0,
            defines: { USE_TEXTURE: !!texture } });
        material.setProperty('mainColor', tint(hex));
        if (texture)
            material.setProperty('mainTexture', texture);
        this.materials.set(key, material);
        return material;
    }
    addMesh(parent, name, mesh, material, x, y, z) {
        const node = this.child(parent, name);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setSharedMaterial(material, 0);
        node.setPosition(x, y, z);
        return node;
    }
    child(parent, name, ui = false) {
        const node = new Node(name);
        node.layer = ui ? Layers.Enum.UI_2D : Layers.Enum.DEFAULT;
        node.parent = parent;
        return node;
    }
    ring(inner, outer) {
        const positions = [];
        const indices = [];
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
    label(parent, text, size, color, bold = false, center = false) {
        const node = this.child(parent, text || 'Nhãn', true);
        const label = node.addComponent(Label);
        node.getComponent(UITransform).setAnchorPoint(center ? 0.5 : 0, 0.5);
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
    panel(parent, width, height, color) {
        // Draw the background before the text children so the HUD batches in reading order.
        let bg = parent.getChildByName('Nền');
        if (!bg) {
            bg = this.child(parent, 'Nền', true);
            bg.addComponent(Graphics);
            bg.setSiblingIndex(0);
        }
        const shape = bg.getComponent(Graphics);
        shape.clear();
        this.fill(shape, -width / 2, -height / 2, width, height, 13, color);
    }
    fill(shape, x, y, width, height, radius, color) {
        shape.fillColor = tint(color);
        shape.roundRect(x, y, width, height, radius);
        shape.fill();
    }
    button(parent, text, width, action) {
        const hit = this.child(parent, text, true);
        hit.addComponent(UITransform).setContentSize(width, 46);
        this.panel(hit, width, 46, COL.ink);
        hit.on(Node.EventType.TOUCH_END, action);
        this.targets.set(hit, { width, height: 46 });
        return this.label(hit, text, 16, COL.cream, true, true);
    }
}
