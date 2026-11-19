import {
    _decorator, Asset, AudioClip, AudioSource, Component, EventKeyboard, EventTouch, Game, game,
    Input, input, JsonAsset, KeyCode, ResolutionPolicy, resources, Texture2D, Vec2, view,
} from 'cc';
import { BOARD_HALF, CAMERA_YAW, makeDistrict, Placement, PROPS, STACK_STEP, tierFor, TIER_RADIUS } from './DistrictRules';
import { Art, DistrictView, PropView } from './DistrictView';

const { ccclass } = _decorator;
const SFX = ['gulp-soft', 'gulp-heavy', 'too-big', 'grow', 'tap', 'restart', 'complete'] as const;
type Sound = typeof SFX[number];

interface Prop extends Placement, PropView {
    age: number;
    height: number;
}

const START_HINT = 'WASD / phím mũi tên · Kéo để di chuyển';
const SWALLOW_TIME = 0.35;

@ccclass('PocketDistrict')
export class PocketDistrict extends Component {
    private district!: DistrictView;
    private music!: AudioSource;
    private effects!: AudioSource;
    private readonly clips = new Map<Sound, AudioClip>();
    private readonly layout = makeDistrict();
    private readonly columnBase: number[] = [];
    private readonly keys = new Set<KeyCode>();
    private readonly dragFrom = new Vec2();
    private readonly dragTo = new Vec2();
    private touchId: number | null = null;

    private props: Prop[] = [];
    private x = 0;
    private z = 0;
    private mass = 0;
    private tier = 0;
    private eaten = 0;
    private radius = TIER_RADIUS[0];
    private time = 0;
    private pulse = 0;
    private notice = 0;
    private bumpCooldown = 0;
    private lastGulp = -1;
    private ready = false;
    private finished = false;
    private muted = false;
    private interacted = false;

    protected onLoad(): void {
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

    protected onEnable(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        game.on(Game.EVENT_HIDE, this.clearInput, this);
    }

    protected onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        game.off(Game.EVENT_HIDE, this.clearInput, this);
        this.clearInput();
    }

    protected onDestroy(): void {
        this.district.dispose();
    }

    protected update(dt: number): void {
        if (this.district.resize() && this.ready) this.updateStatus();
        if (!this.ready) return;

        const step = Math.min(dt, 0.05);
        this.time += step;
        this.bumpCooldown -= step;
        if (this.notice > 0) {
            this.notice -= step;
            if (this.notice <= 0 && !this.finished) this.district.message(START_HINT);
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

    private async load(): Promise<void> {
        try {
            const [paving, atlas, geo] = await Promise.all([
                this.resource('art/district/texture', Texture2D),
                this.resource('art/prop-atlas/texture', Texture2D),
                this.resource('art/props', JsonAsset),
            ]);
            if (!this.isValid) return;
            this.district.build({ paving, atlas, props: geo.json as Art['props'] });
            this.ready = true;
            this.resetRound();
            this.resumeMusic();
        } catch (error) {
            if (!this.isValid) return;
            console.error(error);
            this.district.message('Không tải được tài nguyên. Hãy mở lại màn chơi.');
        }
    }

    private async loadAudio(): Promise<void> {
        await Promise.all([
            this.resource('audio/side-street', AudioClip).then(clip => {
                if (!this.isValid) return;
                this.music.clip = clip;
                this.resumeMusic();
            }).catch(error => console.warn('Không tải được nhạc nền.', error)),
            ...SFX.map(name => this.resource(`audio/${name}`, AudioClip).then(clip => {
                if (this.isValid) this.clips.set(name, clip);
            }).catch(error => console.warn(`Không tải được hiệu ứng ${name}.`, error))),
        ]);
    }

    private resource<T extends Asset>(path: string, kind: new () => T): Promise<T> {
        return new Promise((resolve, reject) => {
            resources.load(path, kind, (error, asset) => {
                if (error) reject(error);
                else resolve(asset);
            });
        });
    }

    private readonly restart = (): void => {
        if (!this.ready) return;
        this.unlockAudio();
        this.play('restart');
        this.resetRound();
    };

    private resetRound(): void {
        for (const prop of this.props) {
            prop.model.destroy();
            prop.shadow?.destroy();
        }
        this.columnBase.length = 0;
        this.props = this.layout.map(placement => ({
            ...placement,
            ...this.district.createProp(placement),
            age: -1,
            height: (placement.stack?.level ?? 0) * STACK_STEP,
        }));
        this.clearInput();
        this.x = this.z = this.mass = this.tier = this.eaten = 0;
        this.time = this.pulse = this.notice = this.bumpCooldown = 0;
        this.lastGulp = -1;
        this.radius = TIER_RADIUS[0];
        this.finished = false;
        this.district.pose(0, 0, this.radius, 0, 0);
        this.district.follow(0, 0, this.radius, 1);
        this.district.message(START_HINT);
        this.district.showFinish(false);
        this.updateStatus();
    }

    private move(dt: number): void {
        const down = (key: KeyCode, alt: KeyCode): number => Number(this.keys.has(key) || this.keys.has(alt));
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

    private updateProps(dt: number): void {
        let gulp: Sound | undefined;
        for (let index = this.props.length - 1; index >= 0; index--) {
            const prop = this.props[index];
            const data = PROPS[prop.tier];
            if (prop.age < 0) {
                if (prop.stack) {
                    const { column, level } = prop.stack;
                    const target = (level - (this.columnBase[column] ?? 0)) * STACK_STEP;
                    if (prop.height > target) {
                        prop.height = Math.max(target, prop.height - dt * 3.5);
                        prop.model.setPosition(prop.x, prop.height, prop.z);
                    }
                    if (prop.height > 0) continue;
                }
                const distance = Math.hypot(prop.x - this.x, prop.z - this.z);
                if (prop.tier > this.tier) {
                    if (distance < this.radius * 0.79 + data.footprint * 0.43 && this.bumpCooldown <= 0) {
                        this.bumpCooldown = 1.4;
                        this.play('too-big');
                        this.say(`Hố cần cấp ${prop.tier + 1} để nuốt ${data.label}.`);
                    }
                    continue;
                }
                if (distance > this.radius - data.footprint * 0.48) continue;
                prop.age = 0;
                if (prop.shadow) prop.shadow.active = false;
            }

            prop.age += dt;
            const t = Math.min(1, prop.age / (prop.stack ? 0.2 : SWALLOW_TIME));
            const scale = Math.max(0.025, 1 - t * t);
            prop.model.setScale(scale, scale, scale);
            prop.model.setRotationFromEuler(t * 55, prop.angle + t * 108, -t * 13);
            prop.model.setPosition(
                prop.x + (this.x - prop.x) * t, -0.76 * t * t,
                prop.z + (this.z - prop.z) * t,
            );
            if (t < 1) continue;

            prop.model.destroy();
            prop.shadow?.destroy();
            if (prop.stack) this.columnBase[prop.stack.column] = prop.stack.level + 1;
            this.props.splice(index, 1);
            this.eaten++;
            this.mass += data.mass;
            if (prop.tier > 1) gulp = 'gulp-heavy';
            else gulp ??= 'gulp-soft';
        }

        if (!gulp) return;
        this.pulse = 1;
        if (gulp === 'gulp-heavy' || this.time - this.lastGulp >= 0.12) {
            this.play(gulp);
            this.lastGulp = this.time;
        }
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

    private updateStatus(): void {
        this.district.updateStatus(this.mass, this.tier, this.eaten, this.layout.length);
    }

    private say(text: string, seconds = 1.8): void {
        this.notice = seconds;
        this.district.message(text);
    }

    private readonly toggleMute = (): void => {
        this.muted = !this.muted;
        this.district.setMuted(this.muted);
        if (this.muted) {
            this.music.pause();
        } else {
            this.interacted = true;
            this.resumeMusic();
            this.play('tap');
        }
    };

    private unlockAudio(): void {
        if (this.interacted) return;
        this.interacted = true;
        this.resumeMusic();
    }

    private resumeMusic(): void {
        if (this.ready && this.interacted && !this.muted && this.music.clip && !this.music.playing) this.music.play();
    }

    private play(sound: Sound): void {
        const clip = this.clips.get(sound);
        if (!this.muted && clip) this.effects.playOneShot(clip);
    }

    private onKeyDown(event: EventKeyboard): void {
        const key = event.keyCode;
        if (this.keys.has(key)) return;
        if (key === KeyCode.KEY_M) {
            this.toggleMute();
            this.keys.add(key);
            return;
        }
        this.unlockAudio();
        if (key === KeyCode.KEY_R) this.restart();
        this.keys.add(key);
    }

    private onKeyUp(event: EventKeyboard): void {
        this.keys.delete(event.keyCode);
    }

    private onTouchStart(event: EventTouch): void {
        this.unlockAudio();
        if (this.touchId !== null) return;
        const point = event.getUILocation();
        if (this.district.controlAt(point.x, point.y)) return;
        this.touchId = event.getID();
        this.dragFrom.set(point);
        this.dragTo.set(point);
    }

    private onTouchMove(event: EventTouch): void {
        if (event.getID() === this.touchId) event.getUILocation(this.dragTo);
    }

    private onTouchEnd(event: EventTouch): void {
        if (event.getID() === this.touchId) this.touchId = null;
    }

    private clearInput(): void {
        this.keys.clear();
        this.touchId = null;
    }
}
