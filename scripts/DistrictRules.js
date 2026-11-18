export const BOARD_HALF = 17;
export const CAMERA_YAW = Math.PI * 0.171;
export const TIER_MASS = [0, 10, 30, 66, 120];
export const TIER_RADIUS = [0.68, 0.99, 1.36, 1.82, 2.46];
export const PROPS = [
    { name: 'planter', label: 'chậu cây', count: 24, footprint: 0.26, mass: 1 },
    { name: 'crate', label: 'thùng trái cây', count: 20, footprint: 0.43, mass: 2 },
    { name: 'bench', label: 'ghế băng', count: 14, footprint: 0.71, mass: 4 },
    { name: 'cart', label: 'xe bán hàng', count: 10, footprint: 1.02, mass: 7 },
    { name: 'house', label: 'nhà phố', count: 8, footprint: 1.53, mass: 12 },
];
export function tierFor(mass) {
    let tier = 0;
    while (tier < TIER_MASS.length - 1 && mass >= TIER_MASS[tier + 1]) {
        tier++;
    }
    return tier;
}
export function makeDistrict() {
    const starter = [
        [-1.12, -1.77], [-2.22, -3.64], [-0.51, -4.28], [1.36, -3.47],
        [3.30, -1.61], [4.58, -0.16], [3.10, 1.46], [1.50, 3.15],
        [-0.45, 3.46], [-2.12, 2.66], [-3.56, 1.25], [-4.76, -0.42],
    ];
    const result = starter.map(([x, z], index) => ({ tier: 0, x, z, angle: index * 73 }));
    const homes = [
        [-12, -11], [-7.6, -12.8], [9.1, -12.2], [13.2, -7.4],
        [-12.6, 7.7], [-8.1, 12.1], [7.6, 9.35], [12.8, 12.4],
    ];
    for (const [index, [x, z]] of homes.entries()) {
        result.push({ tier: 4, x, z, angle: index % 2 ? 0 : 90 });
    }
    let seed = 41761;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let tier = 3; tier >= 0; tier--) {
        const prop = PROPS[tier];
        const count = prop.count - (tier === 0 ? starter.length : 0);
        let placed = 0;
        for (let attempt = 0; placed < count && attempt < 3000; attempt++) {
            const x = (random() * 2 - 1) * 15.45;
            const z = (random() * 2 - 1) * 15.45;
            const distance = Math.hypot(x, z);
            if (distance < [2.3, 4.5, 6.6, 8.9][tier])
                continue;
            if (tier >= 2 && (Math.abs(x) < 2.15 || Math.abs(z) < 2.15))
                continue;
            const overlaps = result.some(other => Math.hypot(x - other.x, z - other.z) < prop.footprint + PROPS[other.tier].footprint + 0.62);
            if (overlaps)
                continue;
            result.push({ tier, x, z, angle: random() < 0.5 ? 0 : 90 });
            placed++;
        }
        if (placed !== count)
            throw new Error(`Không đủ chỗ đặt ${prop.name}`);
    }
    return result;
}
