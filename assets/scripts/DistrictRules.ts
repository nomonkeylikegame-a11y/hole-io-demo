export const BOARD_HALF = 17;
export const CAMERA_YAW = Math.PI * 0.171;
export const STACK_STEP = 0.33;
export const TIER_MASS = [0, 25, 110, 240, 420];
export const TIER_RADIUS = [0.68, 0.99, 1.36, 1.82, 2.46];

export const PROPS = [
    { name: 'block', label: 'khối nhỏ', count: 500, footprint: 0.20, mass: 1 },
    { name: 'crate', label: 'thùng trái cây', count: 20, footprint: 0.43, mass: 2 },
    { name: 'bench', label: 'ghế băng', count: 14, footprint: 0.71, mass: 4 },
    { name: 'cart', label: 'xe bán hàng', count: 10, footprint: 1.02, mass: 7 },
    { name: 'house', label: 'nhà phố', count: 8, footprint: 1.53, mass: 12 },
] as const;

export type StackPattern = 'round' | 'pyramid' | 'square';

export interface Placement {
    tier: number;
    x: number;
    z: number;
    angle: number;
    stack?: { pattern: StackPattern; column: number; level: number };
}

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
