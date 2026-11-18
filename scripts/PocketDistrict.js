var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { _decorator, AudioClip, AudioSource, Component, Game, game, Input, input, JsonAsset, KeyCode, ResolutionPolicy, resources, Texture2D, Vec2, view, } from 'cc';
import { BOARD_HALF, CAMERA_YAW, makeDistrict, PROPS, tierFor, TIER_RADIUS } from './DistrictRules.js';
import { DistrictView } from './DistrictView.js';
const { ccclass } = _decorator;
const SFX = ['gulp-soft', 'gulp-heavy', 'too-big', 'grow', 'tap', 'restart', 'complete'];
const START_HINT = 'WASD / phím mũi tên · Kéo để di chuyển';
const SWALLOW_TIME = 0.35;
let PocketDistrict = class PocketDistrict extends Component {
    constructor() {
        super(...arguments);
        this.clips = new Map();
        this.layout = makeDistrict();
        this.keys = new Set();
        this.dragFrom = new Vec2();
        this.dragTo = new Vec2();
        this.touchId = null;
        this.props = [];
        this.x = 0;
        this.z = 0;
        this.mass = 0;
        this.tier = 0;
        this.eaten = 0;
        this.radius = TIER_RADIUS[0];
        this.time = 0;
        this.pulse = 0;
        this.notice = 0;
        this.bumpCooldown = 0;
        this.ready = false;
        this.finished = false;
        this.muted = false;
        this.interacted = false;
        this.restart = () => {
            if (!this.ready)
                return;
            this.unlockAudio();
            this.play('restart');
            this.resetRound();
        };
        this.toggleMute = () => {
            this.muted = !this.muted;
            this.district.setMuted(this.muted);
            if (this.muted) {
                this.music.pause();
            }
            else {
                this.interacted = true;
                this.resumeMusic();
                this.play('tap');
            }
        };
    }
    onLoad() {
        view.resizeWithBrowserSize(true);
        view.setDesignResolutionSize(1280, 720, ResolutionPolicy.FIXED_HEIGHT);
        this.district = new DistrictView(this.node, this.toggleMute, this.restart);
        this.district.message('Đang tải khu phố…');
        this.music = this.node.addComponent(AudioSource);
        this.music.playOnAwake = false;
        this.music.loop = true;
        this.music.volume = 0.46;
        this.effects = this.node.addComponent(AudioSource);
        this.effects.playOnAwake = false;
        this.effects.volume = 0.68;
        void this.load();
        void this.loadAudio();
    }
    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        game.on(Game.EVENT_HIDE, this.clearInput, this);
    }
    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        game.off(Game.EVENT_HIDE, this.clearInput, this);
        this.clearInput();
    }
    onDestroy() {
        this.district.dispose();
    }
    update(dt) {
        if (this.district.resize() && this.ready)
            this.updateStatus();
        if (!this.ready)
            return;
        const step = Math.min(dt, 0.05);
        this.time += step;
        this.bumpCooldown -= step;
        if (this.notice > 0) {
            this.notice -= step;
            if (this.notice <= 0 && !this.finished)
                this.district.message(START_HINT);
        }
        if (!this.finished) {
            this.move(step);
            this.updateProps(step);
        }
        this.radius += (TIER_RADIUS[this.tier] - this.radius) * (1 - Math.exp(-step * 9));
        this.pulse = Math.max(0, this.pulse - step * 2.7);
        this.district.pose(this.x, this.z, this.radius, this.time, this.pulse);
        this.district.follow(this.x, this.z, this.radius, 1 - Math.exp(-step * 4.7));
    }
    async load() {
        try {
            const [paving, atlas, geo] = await Promise.all([
                this.resource('art/district/texture', Texture2D),
                this.resource('art/prop-atlas/texture', Texture2D),
                this.resource('art/props', JsonAsset),
            ]);
            if (!this.isValid)
                return;
            this.district.build({ paving, atlas, props: geo.json });
            this.ready = true;
            this.resetRound();
            this.resumeMusic();
        }
        catch (error) {
            if (!this.isValid)
                return;
            console.error(error);
            this.district.message('Không tải được tài nguyên. Hãy mở lại màn chơi.');
        }
    }
    async loadAudio() {
        await Promise.all([
            this.resource('audio/side-street', AudioClip).then(clip => {
                if (!this.isValid)
                    return;
                this.music.clip = clip;
                this.resumeMusic();
            }).catch(error => console.warn('Không tải được nhạc nền.', error)),
            ...SFX.map(name => this.resource(`audio/${name}`, AudioClip).then(clip => {
                if (this.isValid)
                    this.clips.set(name, clip);
            }).catch(error => console.warn(`Không tải được hiệu ứng ${name}.`, error))),
        ]);
    }
    resource(path, kind) {
        return new Promise((resolve, reject) => {
            resources.load(path, kind, (error, asset) => {
                if (error)
                    reject(error);
                else
                    resolve(asset);
            });
        });
    }
    resetRound() {
        for (const prop of this.props) {
            prop.model.destroy();
            prop.shadow.destroy();
        }
        this.props = this.layout.map(placement => (Object.assign(Object.assign(Object.assign({}, placement), this.district.createProp(placement)), { age: -1 })));
        this.clearInput();
        this.x = this.z = this.mass = this.tier = this.eaten = 0;
        this.time = this.pulse = this.notice = this.bumpCooldown = 0;
        this.radius = TIER_RADIUS[0];
        this.finished = false;
        this.district.pose(0, 0, this.radius, 0, 0);
        this.district.follow(0, 0, this.radius, 1);
        this.district.message(START_HINT);
        this.district.showFinish(false);
        this.updateStatus();
    }
    move(dt) {
        const down = (key, alt) => Number(this.keys.has(key) || this.keys.has(alt));
        let right = down(KeyCode.KEY_D, KeyCode.ARROW_RIGHT) - down(KeyCode.KEY_A, KeyCode.ARROW_LEFT);
        let forward = down(KeyCode.KEY_W, KeyCode.ARROW_UP) - down(KeyCode.KEY_S, KeyCode.ARROW_DOWN);
        if (this.touchId !== null) {
            const dx = this.dragTo.x - this.dragFrom.x;
            const dy = this.dragTo.y - this.dragFrom.y;
            const length = Math.hypot(dx, dy);
            if (length > 9) {
                const power = Math.min(1, (length - 9) / 49) / length;
                right += dx * power;
                forward += dy * power;
            }
        }
        const distance = (7.65 + 0.18 * this.tier) * dt / Math.max(1, Math.hypot(right, forward));
        const cos = Math.cos(CAMERA_YAW);
        const sin = Math.sin(CAMERA_YAW);
        const edge = BOARD_HALF - this.radius * 0.47;
        this.x = Math.max(-edge, Math.min(edge, this.x + (right * cos - forward * sin) * distance));
        this.z = Math.max(-edge, Math.min(edge, this.z + (-right * sin - forward * cos) * distance));
    }
    updateProps(dt) {
        for (let index = this.props.length - 1; index >= 0; index--) {
            const prop = this.props[index];
            const data = PROPS[prop.tier];
            if (prop.age < 0) {
                const distance = Math.hypot(prop.x - this.x, prop.z - this.z);
                if (prop.tier > this.tier) {
                    if (distance < this.radius * 0.79 + data.footprint * 0.43 && this.bumpCooldown <= 0) {
                        this.bumpCooldown = 1.4;
                        this.play('too-big');
                        this.say(`Hố cần cấp ${prop.tier + 1} để nuốt ${data.label}.`);
                    }
                    continue;
                }
                if (distance > this.radius - data.footprint * 0.48)
                    continue;
                prop.age = 0;
                prop.shadow.active = false;
            }
            prop.age += dt;
            const t = Math.min(1, prop.age / SWALLOW_TIME);
            const scale = Math.max(0.025, 1 - t * t);
            prop.model.setScale(scale, scale, scale);
            prop.model.setRotationFromEuler(t * 55, prop.angle + t * 108, -t * 13);
            prop.model.setPosition(prop.x + (this.x - prop.x) * t, -0.76 * t * t, prop.z + (this.z - prop.z) * t);
            if (t < 1)
                continue;
            prop.model.destroy();
            prop.shadow.destroy();
            this.props.splice(index, 1);
            this.eaten++;
            this.mass += data.mass;
            this.pulse = 1;
            this.play(prop.tier <= 1 ? 'gulp-soft' : 'gulp-heavy');
            const next = tierFor(this.mass);
            if (next > this.tier) {
                this.tier = next;
                this.play('grow');
                this.say(`Cấp ${next + 1}! Giờ nuốt được ${PROPS[next].label}.`, 3);
            }
            this.updateStatus();
            if (this.eaten === this.layout.length) {
                this.finished = true;
                this.play('complete');
                this.district.message('Đã nuốt hết vật thể trong khu phố.');
                this.district.showFinish(true);
            }
        }
    }
    updateStatus() {
        this.district.updateStatus(this.mass, this.tier, this.eaten, this.layout.length);
    }
    say(text, seconds = 1.8) {
        this.notice = seconds;
        this.district.message(text);
    }
    unlockAudio() {
        if (this.interacted)
            return;
        this.interacted = true;
        this.resumeMusic();
    }
    resumeMusic() {
        if (this.ready && this.interacted && !this.muted && this.music.clip && !this.music.playing)
            this.music.play();
    }
    play(sound) {
        const clip = this.clips.get(sound);
        if (!this.muted && clip)
            this.effects.playOneShot(clip);
    }
    onKeyDown(event) {
        const key = event.keyCode;
        if (this.keys.has(key))
            return;
        if (key === KeyCode.KEY_M) {
            this.toggleMute();
            this.keys.add(key);
            return;
        }
        this.unlockAudio();
        if (key === KeyCode.KEY_R)
            this.restart();
        this.keys.add(key);
    }
    onKeyUp(event) {
        this.keys.delete(event.keyCode);
    }
    onTouchStart(event) {
        this.unlockAudio();
        if (this.touchId !== null)
            return;
        const point = event.getUILocation();
        if (this.district.controlAt(point.x, point.y))
            return;
        this.touchId = event.getID();
        this.dragFrom.set(point);
        this.dragTo.set(point);
    }
    onTouchMove(event) {
        if (event.getID() === this.touchId)
            event.getUILocation(this.dragTo);
    }
    onTouchEnd(event) {
        if (event.getID() === this.touchId)
            this.touchId = null;
    }
    clearInput() {
        this.keys.clear();
        this.touchId = null;
    }
};
PocketDistrict = __decorate([
    ccclass('PocketDistrict')
], PocketDistrict);
export { PocketDistrict };
