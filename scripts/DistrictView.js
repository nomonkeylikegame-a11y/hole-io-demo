import { Camera, Canvas, Color, Graphics, HorizontalTextAlignment, Label, Layers, Material, MeshRenderer, Node, primitives, UITransform, utils, Vec3, view, } from 'cc';
import { BOARD_HALF, CAMERA_YAW, PROPS, TIER_MASS, TIER_RADIUS } from './DistrictRules.js';
const COL = {
    ink: '#172937', panel: '#223846', cream: '#fff6dc', muted: '#c0d1c4',
    mint: '#a6e0ab',
};
const tint = (value) => Color.fromHEX(new Color(), value);
const HOLE_SIDES = 64;
const HOLE_OPENING = 0.95;
const GROUND_RAYS = HOLE_SIDES + 4;
export class DistrictView {
    constructor(parent, onAudio, onRestart) {
        this.targets = new Map();
        this.props = new Map();
        this.materials = [];
        this.models = [];
        this.meshes = [];
        this.focus = new Vec3();
        this.waveColor = new Color();
        this.sparks = [];
        this.sparkCursor = 0;
        this.lastBurst = -1;
        this.growAt = -1;
        this.impactAt = -1;
        this.waveAt = -1;
        this.waveRadius = 0;
        this.waveAlpha = 0;
        this.groundAngles = new Float64Array(GROUND_RAYS);
        this.groundGeometry = {
            positions: new Float32Array(GROUND_RAYS * 6),
            uvs: new Float32Array(GROUND_RAYS * 4),
            indices16: new Uint16Array(this.ringIndices(GROUND_RAYS)),
            minPos: { x: -BOARD_HALF, y: 0, z: -BOARD_HALF },
            maxPos: { x: BOARD_HALF, y: 0, z: BOARD_HALF },
        };
        this.groundPose = new Vec3(Infinity, Infinity, Infinity);
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
        this.addMesh(this.hole, 'Viền ngoài', this.mesh(this.ring(0.91, 1.015)), this.material('#e2b86f'), 0, 0.022, 0);
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
            this.addMesh(this.hole, 'Thành hố', this.mesh(this.ring(lower.radius, upper.radius, lower.depth, upper.depth)), this.material(upper.color), 0, 0, 0);
        }
        const bottom = walls[walls.length - 1];
        this.addMesh(this.hole, 'Đáy hố', this.disk, this.material(bottom.color), 0, bottom.depth, 0)
            .setScale(bottom.radius, 1, bottom.radius);
        this.ripple = this.addMesh(this.hole, 'Gợn sáng', this.mesh(this.ring(0.972, 0.991)), this.material('#d3efe393'), 0, 0.026, 0);
        this.marker = this.child(this.hole, 'Dấu sáng');
        const dot = this.material('#a5deaf');
        for (let index = 0; index < 4; index++) {
            const turn = index * Math.PI / 2;
            this.addMesh(this.marker, 'Chấm', this.disk, dot, Math.cos(turn) * 0.966, 0.031, Math.sin(turn) * 0.966)
                .setScale(0.029, 1, 0.029);
        }
        this.waveMaterial = this.material('#b0ebd467');
        this.wave = this.addMesh(this.world, 'Sóng trên mặt đường', this.mesh(this.ring(0.974, 1)), this.waveMaterial, 0, 0.036, 0);
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
        this.button(this.finish, 'Chơi lại', 126, onRestart).node.parent.setPosition(0, -42);
        this.finish.active = false;
        this.resize();
    }
    build(art) {
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
        };
        for (const prop of PROPS)
            this.models.push(this.mesh(art.props[prop.name]));
    }
    resetProps(props) {
        for (const prop of this.props.keys())
            this.removeProp(prop);
        for (const prop of props)
            this.props.set(prop, this.createProp(prop));
    }
    renderProp(prop, holeX, holeZ) {
        const { model, shadow } = this.props.get(prop);
        const { x, z, height, entry, angle } = prop;
        if (!entry) {
            model.setPosition(x, height, z);
            const lean = Math.min(7, prop.fallSpeed * 2.1);
            const column = prop.stack.column;
            model.setRotationFromEuler(column % 2 ? lean : -lean, angle, column % 3 ? lean : -lean);
            return;
        }
        if (shadow)
            shadow.active = false;
        const depth = Math.min(1, -height / entry.depth);
        const inward = 1 - depth * 0.77;
        const scale = 1 - 0.86 * Math.max(0, (depth - 0.32) / 0.68) ** 1.6;
        model.setScale(scale, scale, scale);
        model.setRotationFromEuler(depth * 57, angle + depth * 68, depth * 21 * (entry.x < 0 ? -1 : 1));
        model.setPosition(holeX + entry.x * inward, height, holeZ + entry.z * inward);
    }
    removeProp(prop) {
        const { model, shadow } = this.props.get(prop);
        model.destroy();
        shadow === null || shadow === void 0 ? void 0 : shadow.destroy();
        this.props.delete(prop);
    }
    createProp(prop) {
        const { tier, x, z, angle, height, stack } = prop;
        const material = stack ? this.stackMaterials[stack.pattern] : this.propMaterial;
        const model = this.addMesh(this.world, PROPS[tier].name, this.models[tier], material, x, height, z);
        model.setRotationFromEuler(0, angle, 0);
        if (stack)
            return { model };
        const shadow = this.addMesh(this.world, 'Bóng', this.disk, this.softShadow, x + 0.13, 0.012, z + 0.14);
        const size = PROPS[tier].footprint;
        shadow.setScale(size * 1.15, 1, size * 0.83);
        shadow.setRotationFromEuler(0, angle, 0);
        return { model, shadow };
    }
    resetFeedback() {
        this.sparkCursor = 0;
        this.lastBurst = this.growAt = this.impactAt = -1;
        for (const spark of this.sparks)
            spark.node.active = false;
        this.startWave(0, 0, TIER_RADIUS[0], 0, false);
    }
    swallowEffect(x, z, radius, time, count, heavy) {
        if (heavy)
            this.impactAt = time;
        if (time - this.lastBurst < 0.09)
            return;
        this.lastBurst = time;
        this.burst(x, z, radius, time, Math.min(8, 3 + Math.floor(Math.sqrt(count))), heavy ? 1.4 : 0.85);
    }
    growEffect(x, z, radius, time) {
        this.growAt = this.impactAt = time;
        this.startWave(x, z, radius, time, true);
        this.burst(x, z, radius, time, 20, 1.7);
    }
    burst(x, z, radius, time, count, strength) {
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
    startWave(x, z, radius, time, growth) {
        this.wave.setPosition(x, 0.036, z);
        this.wave.active = true;
        this.waveRadius = radius;
        this.waveAt = time;
        this.waveAlpha = growth ? 208 : 144;
        if (growth)
            this.waveColor.set(255, 204, 126, this.waveAlpha);
        else
            this.waveColor.set(176, 235, 212, this.waveAlpha);
    }
    updateFeedback(time) {
        if (this.wave.active) {
            const progress = (time - this.waveAt) / 0.72;
            if (progress >= 1)
                this.wave.active = false;
            else {
                const remaining = 1 - progress;
                const width = this.waveRadius * (2.95 - 1.98 * remaining * remaining);
                this.wave.setScale(width, 1, width);
                this.waveColor.a = Math.round(this.waveAlpha * remaining * remaining);
                this.waveMaterial.setProperty('mainColor', this.waveColor);
            }
        }
        for (const spark of this.sparks) {
            if (!spark.node.active)
                continue;
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
    pose(x, z, radius, time, pulse) {
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
    follow(x, z, radius, blend, time) {
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
        const targetZoom = (portrait ? 8.25 : 7.2) + radius * 2.15 + intro * 2.6 + recoil;
        this.camera.orthoHeight += (targetZoom - this.camera.orthoHeight) * blend;
        const impact = time - this.impactAt;
        const shake = Math.max(0, 1 - impact / 0.28) ** 2;
        const distance = 24 + 2.4 * intro;
        this.camera.node.setPosition(this.focus.x + Math.sin(CAMERA_YAW) * distance + Math.sin(impact * 69) * shake * 0.15, 36 + 3.6 * intro, this.focus.z + Math.cos(CAMERA_YAW) * distance + Math.cos(impact * 79) * shake * 0.12);
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
    showLoadError() {
        this.objective.string = 'Không tải được khu phố.';
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
        for (const material of this.materials)
            material.destroy();
    }
    mesh(geo) {
        const mesh = utils.MeshUtils.createMesh(geo, undefined, { calculateBounds: true });
        this.meshes.push(mesh);
        return mesh;
    }
    material(hex, texture, instanced = false) {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', technique: hex.length === 9 ? 1 : 0,
            defines: { USE_TEXTURE: !!texture, USE_INSTANCING: instanced } });
        material.setProperty('mainColor', tint(hex));
        if (texture)
            material.setProperty('mainTexture', texture);
        this.materials.push(material);
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
    writeGround(x, z, radius) {
        // Project the hole perimeter onto the square board. The four corner rays keep the outer edges exact.
        const turn = Math.PI * 2;
        const half = BOARD_HALF;
        const angles = this.groundAngles;
        for (let i = 0; i < HOLE_SIDES; i++)
            angles[i] = i * turn / HOLE_SIDES;
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
            uvs[i * 4] = (innerX + half) / (half * 2);
            uvs[i * 4 + 1] = (innerZ + half) / (half * 2);
            uvs[i * 4 + 2] = (outerX + half) / (half * 2);
            uvs[i * 4 + 3] = (outerZ + half) / (half * 2);
        }
        this.groundPose.set(x, z, radius);
    }
    ring(inner, outer, innerY = 0, outerY = 0) {
        const positions = [];
        for (let i = 0; i < HOLE_SIDES; i++) {
            const angle = (i / HOLE_SIDES) * Math.PI * 2;
            const x = Math.cos(angle);
            const z = Math.sin(angle);
            positions.push(x * inner, innerY, z * inner, x * outer, outerY, z * outer);
        }
        return { positions, indices: this.ringIndices(HOLE_SIDES) };
    }
    ringIndices(sides) {
        const indices = [];
        for (let i = 0; i < sides; i++) {
            const next = ((i + 1) % sides) * 2;
            indices.push(i * 2, next, i * 2 + 1, i * 2 + 1, next, next + 1);
        }
        return indices;
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
