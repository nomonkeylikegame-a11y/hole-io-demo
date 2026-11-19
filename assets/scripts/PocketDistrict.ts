import {
    _decorator, Asset, AudioClip, AudioSource, Component, EventKeyboard, EventTouch, Game, game,
    Input, input, JsonAsset, KeyCode, ResolutionPolicy, resources, Texture2D, Vec2, view,
} from 'cc';
import { DistrictRound } from './DistrictRules';
import { Art, DistrictView } from './DistrictView';

const { ccclass } = _decorator;
const SFX = ['gulp-soft', 'gulp-heavy', 'too-big', 'grow', 'tap', 'restart', 'complete'] as const;
type Sound = typeof SFX[number];

@ccclass('PocketDistrict')
export class PocketDistrict extends Component {
    private district!: DistrictView;
    private music!: AudioSource;
    private effects!: AudioSource;
    private readonly clips = new Map<Sound, AudioClip>();
    private readonly round = new DistrictRound();
    private readonly keys = new Set<KeyCode>();
    private readonly dragFrom = new Vec2();
    private readonly dragTo = new Vec2();
    private touchId: number | null = null;

    private time = 0;
    private pulse = 0;
    private bumpCooldown = 0;
    private lastGulp = -1;
    private ready = false;
    private muted = false;
    private interacted = false;

    protected onLoad(): void {
        view.resizeWithBrowserSize(true);
        view.setDesignResolutionSize(1280, 720, ResolutionPolicy.FIXED_HEIGHT);
        this.district = new DistrictView(this.node, this.toggleMute, this.restart);
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
        const resized = this.district.resize();
        if (!this.ready) return;

        const step = Math.min(dt, 0.05);
        this.time += step;
        this.bumpCooldown -= step;

        const frame = this.round.advance(step, ...this.movement());
        const { x, z, finished } = this.round.state;
        for (const prop of frame.changed) this.district.renderProp(prop, x, z);
        for (const prop of frame.swallowed) this.district.removeProp(prop);

        if (frame.blocked && this.bumpCooldown <= 0) {
            this.bumpCooldown = 1.4;
            this.play('too-big');
        }
        if (frame.swallowed.length) {
            this.pulse = 1;
            const heavy = frame.swallowed.some(prop => prop.tier > 1);
            if (heavy || this.time - this.lastGulp >= 0.12) {
                this.play(heavy ? 'gulp-heavy' : 'gulp-soft');
                this.lastGulp = this.time;
            }
            if (frame.grew) this.play('grow');
            if (finished) {
                this.play('complete');
                this.district.showFinish(true);
            }
        }
        if (resized || frame.swallowed.length) this.updateStatus();

        this.pulse = Math.max(0, this.pulse - step * 2.7);
        this.renderRound(1 - Math.exp(-step * 4.7));
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
            this.district.showLoadError();
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
        this.round.reset();
        this.district.resetProps(this.round.props);
        this.clearInput();
        this.time = this.pulse = this.bumpCooldown = 0;
        this.lastGulp = -1;
        this.district.showFinish(false);
        this.renderRound(1);
        this.updateStatus();
    }

    private movement(): [right: number, forward: number] {
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
        return [right, forward];
    }

    private renderRound(blend: number): void {
        const { x, z, radius } = this.round.state;
        this.district.pose(x, z, radius, this.time, this.pulse);
        this.district.follow(x, z, radius, blend);
    }

    private updateStatus(): void {
        const { mass, tier, eaten } = this.round.state;
        this.district.updateStatus(mass, tier, eaten, this.round.total);
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
