export const BOARD_HALF = 17;
export const CAMERA_YAW = Math.PI * 0.171;
const STACK_STEP = 0.33;
export const TIER_MASS = [0, 25, 110, 240, 420];
export const TIER_RADIUS = [0.68, 0.99, 1.36, 1.82, 2.46];

export const PROPS = [
    { name: 'block', count: 500, footprint: 0.20, mass: 1 },
    { name: 'crate', count: 20, footprint: 0.43, mass: 2 },
    { name: 'bench', count: 14, footprint: 0.71, mass: 4 },
    { name: 'cart', count: 10, footprint: 1.02, mass: 7 },
    { name: 'house', count: 8, footprint: 1.53, mass: 12 },
] as const;

export type StackPattern = 'round' | 'pyramid' | 'square';

interface Placement {
    tier: number;
    x: number;
    z: number;
    angle: number;
    stack?: { pattern: StackPattern; column: number; level: number };
}

export interface PropState extends Placement {
    height: number;
    swallow: number;
}

interface RoundState {
    x: number;
    z: number;
    radius: number;
    mass: number;
    tier: number;
    eaten: number;
    finished: boolean;
}

interface RoundStep {
    changed: PropState[];
    swallowed: PropState[];
    blocked: boolean;
    grew: boolean;
}

const START_STATE: RoundState = { x: 0, z: 0, radius: TIER_RADIUS[0], mass: 0, tier: 0, eaten: 0, finished: false };

const STACKS: { pattern: StackPattern; x: number; z: number; levels: number }[] = [
    { pattern: 'round', x: -1.12, z: -1.77, levels: 6 },
    { pattern: 'square', x: 3.4, z: -3.95, levels: 6 },
    { pattern: 'pyramid', x: -4.3, z: 2.6, levels: 6 },
    { pattern: 'square', x: -5.7, z: -5.25, levels: 10 },
    { pattern: 'round', x: 6.6, z: 3.75, levels: 7 },
    { pattern: 'round', x: -6.6, z: 7.6, levels: 7 },
    { pattern: 'square', x: 6.2, z: -6.8, levels: 4 },
    { pattern: 'pyramid', x: 4.6, z: 9.1, levels: 6 },
];

export function tierFor(mass: number): number {
    let tier = 0;
    while (tier < TIER_MASS.length - 1 && mass >= TIER_MASS[tier + 1]) {
        tier++;
    }
    return tier;
}

export function makeDistrict(): Placement[] {
    const result: Placement[] = [];
    const homes = [
        [-12, -11], [-7.6, -12.8], [9.1, -12.2], [13.2, -7.4],
        [-12.6, 7.7], [-8.1, 12.1], [7.6, 9.35], [12.8, 12.4],
    ];
    for (const [index, [x, z]] of homes.entries()) {
        result.push({ tier: 4, x, z, angle: index % 2 ? 0 : 90 });
    }

    let seed = 41761;
    const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let tier = 3; tier > 0; tier--) {
        const prop = PROPS[tier];
        let placed = 0;
        for (let attempt = 0; placed < prop.count && attempt < 3000; attempt++) {
            const x = (random() * 2 - 1) * 15.45;
            const z = (random() * 2 - 1) * 15.45;
            const distance = Math.hypot(x, z);
            if (distance < [0, 4.5, 6.6, 8.9][tier]) continue;
            if (tier >= 2 && (Math.abs(x) < 2.15 || Math.abs(z) < 2.15)) continue;
            if (STACKS.some(stack => Math.hypot(x - stack.x, z - stack.z) < prop.footprint + 1.48)) continue;
            const overlaps = result.some(other =>
                Math.hypot(x - other.x, z - other.z) < prop.footprint + PROPS[other.tier].footprint + 0.62,
            );
            if (overlaps) continue;
            result.push({ tier, x, z, angle: random() < 0.5 ? 0 : 90 });
            placed++;
        }
        if (placed !== prop.count) throw new Error(`Không đủ chỗ đặt ${prop.name}`);
    }
    const blocks = makeStacks();
    if (blocks.length !== PROPS[0].count) throw new Error('Số khối nhỏ không khớp bố cục.');
    return [...blocks, ...result];
}

function makeStacks(): Placement[] {
    const blocks: Placement[] = [];
    let column = 0;
    for (const { pattern, x, z, levels } of STACKS) {
        const addColumn = (dx: number, dz: number, angle: number, height: number): void => {
            for (let level = 0; level < height; level++) {
                blocks.push({ tier: 0, x: x + dx, z: z + dz, angle, stack: { pattern, column, level } });
            }
            column++;
        };

        if (pattern === 'round') {
            addColumn(0, 0, 0, levels);
            for (let i = 0; i < 8; i++) {
                const turn = i * Math.PI / 4;
                addColumn(Math.cos(turn) * 0.43, Math.sin(turn) * 0.43, -i * 45, levels);
            }
            continue;
        }

        const half = pattern === 'pyramid' ? 2 : 1;
        for (let row = -half; row <= half; row++) {
            for (let col = -half; col <= half; col++) {
                const inset = pattern === 'pyramid' ? 2 * Math.max(Math.abs(row), Math.abs(col)) : 0;
                addColumn(col * 0.30, row * 0.30, 0, levels - inset);
            }
        }
    }
    return blocks;
}

export class DistrictRound {
    private readonly layout = makeDistrict();
    private readonly columnBase: number[] = [];
    private items: PropState[] = [];
    private stats: RoundState = { ...START_STATE };

    get state(): Readonly<RoundState> {
        return this.stats;
    }

    get props(): readonly Readonly<PropState>[] {
        return this.items;
    }

    get total(): number {
        return this.layout.length;
    }

    reset(): void {
        this.stats = { ...START_STATE };
        this.columnBase.length = 0;
        this.items = this.layout.map(placement => ({
            ...placement,
            height: (placement.stack?.level ?? 0) * STACK_STEP,
            swallow: -1,
        }));
    }

    advance(dt: number, right: number, forward: number): RoundStep {
        const frame: RoundStep = { changed: [], swallowed: [], blocked: false, grew: false };
        if (this.stats.finished) return frame;

        this.move(dt, right, forward);
        const { x, z, radius, tier } = this.stats;
        // Columns are stored bottom-first. Work down so a released block starts falling on the next step.
        for (let index = this.items.length - 1; index >= 0; index--) {
            const prop = this.items[index];
            const data = PROPS[prop.tier];
            if (prop.swallow < 0) {
                if (prop.stack) {
                    const { column, level } = prop.stack;
                    const target = (level - (this.columnBase[column] ?? 0)) * STACK_STEP;
                    if (prop.height > target) {
                        prop.height = Math.max(target, prop.height - dt * 3.5);
                        frame.changed.push(prop);
                        continue;
                    }
                    if (prop.height > 0) continue;
                }

                const distance = Math.hypot(prop.x - x, prop.z - z);
                if (prop.tier > tier) {
                    if (distance < radius * 0.79 + data.footprint * 0.43) frame.blocked = true;
                    continue;
                }
                if (distance > radius - data.footprint * 0.48) continue;
                prop.swallow = 0;
            }

            prop.swallow += dt / (prop.stack ? 0.2 : 0.35);
            if (prop.swallow < 1 - 1e-6) {
                frame.changed.push(prop);
                continue;
            }

            if (prop.stack) this.columnBase[prop.stack.column] = prop.stack.level + 1;
            this.items.splice(index, 1);
            frame.swallowed.push(prop);
            this.stats.eaten++;
            this.stats.mass += data.mass;
        }

        const next = tierFor(this.stats.mass);
        frame.grew = next > tier;
        this.stats.tier = next;
        this.stats.radius += (TIER_RADIUS[next] - radius) * (1 - Math.exp(-dt * 9));
        this.stats.finished = this.stats.eaten === this.total;
        return frame;
    }

    private move(dt: number, right: number, forward: number): void {
        const { radius, tier } = this.stats;
        const distance = (7.65 + 0.18 * tier) * dt / Math.max(1, Math.hypot(right, forward));
        const cos = Math.cos(CAMERA_YAW);
        const sin = Math.sin(CAMERA_YAW);
        const edge = BOARD_HALF - radius * 0.47;
        this.stats.x = Math.max(-edge, Math.min(edge, this.stats.x + (right * cos - forward * sin) * distance));
        this.stats.z = Math.max(-edge, Math.min(edge, this.stats.z + (-right * sin - forward * cos) * distance));
    }
}
