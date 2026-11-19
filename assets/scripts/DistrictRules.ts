export const BOARD_HALF = 32;
export const CAMERA_YAW = Math.PI * 0.171;
const STACK_STEP = 0.33;
const GRAVITY = 15.5;
const MOUTH_REACH = 0.92;
const TIER_MASS = [0, 25, 260, 940, 2350];
export const TIER_RADIUS = [0.68, 0.99, 1.36, 1.82, 2.46];

export const PROPS = [
    { name: 'block', count: 14948, footprint: 0.20, mass: 1 },
    { name: 'crate', count: 20, footprint: 0.43, mass: 2 },
    { name: 'bench', count: 14, footprint: 0.71, mass: 4 },
    { name: 'cart', count: 10, footprint: 1.02, mass: 7 },
    { name: 'house', count: 8, footprint: 1.53, mass: 12 },
] as const;

export type StackPattern = 'round' | 'pyramid' | 'square' | 'ring' | 'cross' | 'steps';

interface Placement {
    tier: number;
    x: number;
    z: number;
    angle: number;
    stack?: { pattern: StackPattern; column: number; level: number };
}

export interface PropState extends Placement {
    height: number;
    fallSpeed: number;
    entry?: { x: number; z: number; depth: number };
}

interface BlockColumn {
    blocks: PropState[];
    settling: boolean;
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

interface TowerShape {
    pattern: StackPattern;
    levels: number;
}

interface Tower extends TowerShape {
    x: number;
    z: number;
}

const STARTERS: readonly Tower[] = [
    { x: -1.12, z: -1.77, pattern: 'round', levels: 6 },
    { x: 3.4, z: -3.9, pattern: 'square', levels: 18 },
    { x: -4.6, z: 2.8, pattern: 'steps', levels: 17 },
    { x: 4.7, z: 3.3, pattern: 'ring', levels: 16 },
    { x: -4.1, z: -4.7, pattern: 'cross', levels: 11 },
    { x: 0.9, z: 6.2, pattern: 'round', levels: 15 },
    { x: -6.8, z: -1.2, pattern: 'pyramid', levels: 6 },
];

const STACK_RECIPES: readonly (TowerShape & { count: number })[] = [
    { pattern: 'round', levels: 6, count: 18 },
    { pattern: 'round', levels: 15, count: 12 },
    { pattern: 'square', levels: 10, count: 15 },
    { pattern: 'square', levels: 18, count: 14 },
    { pattern: 'pyramid', levels: 6, count: 14 },
    { pattern: 'pyramid', levels: 8, count: 13 },
    { pattern: 'ring', levels: 7, count: 10 },
    { pattern: 'ring', levels: 12, count: 1 },
    { pattern: 'ring', levels: 16, count: 8 },
    { pattern: 'cross', levels: 11, count: 12 },
    { pattern: 'steps', levels: 17, count: 10 },
];

const STACK_FOOTPRINT: Record<StackPattern, number> = {
    round: 0.70, square: 0.70, pyramid: 1.04, ring: 1.00, cross: 0.85, steps: 0.90,
};

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
        [-22, -21], [-11, -23], [15, -22], [23, -12],
        [-22, 13], [-11, 23], [12, 19], [23, 22],
    ];
    for (const [index, [x, z]] of homes.entries()) {
        result.push({ tier: 4, x, z, angle: index % 2 ? 0 : 90 });
    }

    let seed = 41761;
    const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const stacks = towerLayout(homes, random);
    const span = BOARD_HALF - 1.6;
    for (let tier = 3; tier > 0; tier--) {
        const prop = PROPS[tier];
        let placed = 0;
        for (let attempt = 0; placed < prop.count && attempt < 3000; attempt++) {
            const x = (random() * 2 - 1) * span;
            const z = (random() * 2 - 1) * span;
            const distance = Math.hypot(x, z);
            if (distance < [0, 4.5, 6.6, 8.9][tier]) continue;
            if (tier >= 2 && (Math.abs(x) < 2.15 || Math.abs(z) < 2.15)) continue;
            if (stacks.some(stack => Math.hypot(x - stack.x, z - stack.z) <
                prop.footprint + STACK_FOOTPRINT[stack.pattern] + 0.30)) continue;
            const overlaps = result.some(other =>
                Math.hypot(x - other.x, z - other.z) < prop.footprint + PROPS[other.tier].footprint + 0.62,
            );
            if (overlaps) continue;
            result.push({ tier, x, z, angle: random() < 0.5 ? 0 : 90 });
            placed++;
        }
        if (placed !== prop.count) throw new Error(`Không đủ chỗ đặt ${prop.name}`);
    }
    const blocks = makeStacks(stacks);
    if (blocks.length !== PROPS[0].count) throw new Error('Số khối nhỏ không khớp bố cục.');
    return [...blocks, ...result];
}

function towerLayout(homes: readonly number[][], random: () => number): Tower[] {
    const sites = [];
    for (let row = -7; row <= 7; row++) {
        for (let col = -7; col <= 7; col++) {
            const x = col * 4.05 + (random() - 0.5) * 0.64;
            const z = row * 4.05 + (random() - 0.5) * 0.64;
            if (Math.hypot(x, z) < 3 || STARTERS.some(tower => Math.hypot(x - tower.x, z - tower.z) < 3.0)) continue;
            if (homes.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 2.8)) continue;
            sites.push({ x, z, order: random() });
        }
    }
    sites.sort((a, b) => a.order - b.order);

    const towers = [...STARTERS];
    for (const { pattern, levels, count } of STACK_RECIPES) {
        const reserved = STARTERS.filter(tower => tower.pattern === pattern && tower.levels === levels).length;
        for (let i = reserved; i < count; i++) {
            const site = sites[towers.length - STARTERS.length];
            if (!site) throw new Error('Không đủ chỗ đặt tháp.');
            towers.push({ x: site.x, z: site.z, pattern, levels });
        }
    }
    return towers;
}

function makeStacks(stacks: readonly Tower[]): Placement[] {
    const blocks: Placement[] = [];
    let column = 0;
    for (const { pattern, x, z, levels } of stacks) {
        const addColumn = (dx: number, dz: number, angle: number, height: number): void => {
            for (let level = 0; level < height; level++) {
                blocks.push({ tier: 0, x: x + dx, z: z + dz, angle, stack: { pattern, column, level } });
            }
            column++;
        };

        if (pattern === 'round' || pattern === 'ring') {
            const columns = pattern === 'round' ? 8 : 16;
            const radius = pattern === 'round' ? 0.43 : 0.82;
            if (pattern === 'round') addColumn(0, 0, 0, levels);
            for (let i = 0; i < columns; i++) {
                const turn = i * 2 * Math.PI / columns;
                addColumn(Math.cos(turn) * radius, Math.sin(turn) * radius, -i * 360 / columns, levels);
            }
            continue;
        }

        const halfX = pattern === 'square' ? 1 : 2;
        const halfZ = pattern === 'steps' ? 1 : halfX;
        for (let row = -halfZ; row <= halfZ; row++) {
            for (let col = -halfX; col <= halfX; col++) {
                if (pattern === 'cross' && row !== 0 && col !== 0) continue;
                let inset = 0;
                if (pattern === 'pyramid') inset = 2 * Math.max(Math.abs(row), Math.abs(col));
                if (pattern === 'steps') inset = 3 * (col + halfX);
                addColumn(col * 0.30, row * 0.30, 0, levels - inset);
            }
        }
    }
    return blocks;
}

export class DistrictRound {
    private readonly layout = makeDistrict();
    private readonly items = new Set<PropState>();
    private readonly columns: BlockColumn[] = [];
    private readonly groundProps: PropState[] = [];
    private readonly sinking: PropState[] = [];
    private stats: RoundState = { ...START_STATE };

    get state(): Readonly<RoundState> {
        return this.stats;
    }

    get props(): ReadonlySet<Readonly<PropState>> {
        return this.items;
    }

    get total(): number {
        return this.layout.length;
    }

    reset(): void {
        this.stats = { ...START_STATE };
        this.items.clear();
        this.columns.length = this.groundProps.length = this.sinking.length = 0;
        for (const placement of this.layout) {
            const prop: PropState = { ...placement, height: (placement.stack?.level ?? 0) * STACK_STEP, fallSpeed: 0 };
            this.items.add(prop);
            if (!prop.stack) {
                this.groundProps.push(prop);
                continue;
            }
            const column = this.columns[prop.stack.column] ??= { blocks: [], settling: false };
            column.blocks.push(prop);
        }
    }

    advance(dt: number, right: number, forward: number): RoundStep {
        const frame: RoundStep = { changed: [], swallowed: [], blocked: false, grew: false };
        if (this.stats.finished) return frame;

        this.move(dt, right, forward);
        this.advanceSinking(dt, frame);
        this.advanceColumns(dt, frame);
        this.catchGroundProps(frame);

        const { radius, tier, mass } = this.stats;
        const next = tierFor(mass);
        frame.grew = next > tier;
        this.stats.tier = next;
        this.stats.radius += (TIER_RADIUS[next] - radius) * (1 - Math.exp(-dt * 9));
        if (this.stats.radius !== radius) this.keepOnBoard();
        this.stats.finished = this.items.size === 0;
        return frame;
    }

    private advanceColumns(dt: number, frame: RoundStep): void {
        const { x, z, radius } = this.stats;
        const reach = radius * MOUTH_REACH - PROPS[0].footprint * 0.48;
        for (const column of this.columns) {
            const base = column.blocks[0];
            if (!base) continue;
            const dx = base.x - x;
            const dz = base.z - z;
            const unsupported = dx * dx + dz * dz <= reach * reach;
            if (!unsupported && !column.settling) continue;

            let support = unsupported ? -Infinity : 0;
            let supportSpeed = 0;
            let entered = 0;
            column.settling = false;
            for (const prop of column.blocks) {
                const previous = prop.height;
                const previousSpeed = prop.fallSpeed;
                const height = this.fall(prop, dt);
                prop.height = Math.max(height, support);
                if (height <= support) prop.fallSpeed = supportSpeed;

                if (unsupported && prop.height <= 0) {
                    this.enterHole(prop, frame);
                    entered++;
                    continue;
                }

                support = prop.height + STACK_STEP;
                supportSpeed = prop.fallSpeed;
                if (prop.fallSpeed > 0) column.settling = true;
                if (prop.height !== previous || prop.fallSpeed !== previousSpeed) frame.changed.push(prop);
            }
            // Every unsupported block starts falling together. Blocks above the lip can land if the hole moves away.
            if (entered) column.blocks.splice(0, entered);
        }
    }

    private catchGroundProps(frame: RoundStep): void {
        const { x, z, radius, tier } = this.stats;
        for (let i = this.groundProps.length - 1; i >= 0; i--) {
            const prop = this.groundProps[i];
            const { footprint } = PROPS[prop.tier];
            const distance = Math.hypot(prop.x - x, prop.z - z);
            if (prop.tier > tier) {
                if (distance < radius * 0.79 + footprint * 0.43) frame.blocked = true;
            } else if (distance <= radius * MOUTH_REACH - footprint * 0.48) {
                this.groundProps.splice(i, 1);
                prop.fallSpeed = 0.4;
                this.enterHole(prop, frame);
            }
        }
    }

    private enterHole(prop: PropState, frame: RoundStep): void {
        const { x, z, radius } = this.stats;
        prop.entry = { x: prop.x - x, z: prop.z - z, depth: radius * 1.55 };
        this.sinking.push(prop);
        frame.changed.push(prop);
    }

    private advanceSinking(dt: number, frame: RoundStep): void {
        for (let i = this.sinking.length - 1; i >= 0; i--) {
            const prop = this.sinking[i];
            prop.height = this.fall(prop, dt);
            if (prop.height > -prop.entry!.depth) {
                frame.changed.push(prop);
                continue;
            }
            this.sinking.splice(i, 1);
            this.items.delete(prop);
            frame.swallowed.push(prop);
            this.stats.eaten++;
            this.stats.mass += PROPS[prop.tier].mass;
        }
    }

    private fall(prop: PropState, dt: number): number {
        const height = prop.height - (prop.fallSpeed + 0.5 * GRAVITY * dt) * dt;
        prop.fallSpeed += GRAVITY * dt;
        return height;
    }

    private move(dt: number, right: number, forward: number): void {
        const distance = (7.65 + 0.18 * this.stats.tier) * dt / Math.max(1, Math.hypot(right, forward));
        const cos = Math.cos(CAMERA_YAW);
        const sin = Math.sin(CAMERA_YAW);
        this.stats.x += (right * cos - forward * sin) * distance;
        this.stats.z += (-right * sin - forward * cos) * distance;
        this.keepOnBoard();
    }

    private keepOnBoard(): void {
        const edge = BOARD_HALF - this.stats.radius - 0.05;
        this.stats.x = Math.max(-edge, Math.min(edge, this.stats.x));
        this.stats.z = Math.max(-edge, Math.min(edge, this.stats.z));
    }
}
