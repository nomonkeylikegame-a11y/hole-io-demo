import cc from 'cc';

const url = path => new URL(path, import.meta.url).href;
async function readJson(path) {
    const response = await fetch(url(path));
    if (!response.ok) throw new Error(`Không đọc được ${path} (${response.status})`);
    return response.json();
}

const [effects, scene] = await Promise.all([
    readJson('./effects.json'),
    readJson('./assets/PocketDistrict.scene'),
]);

cc.game.on(cc.Game.EVENT_POST_SUBSYSTEM_INIT, () => {
    for (const effect of effects) Object.assign(new cc.EffectAsset(), effect).onLoaded();

    const builtin = cc.cclegacy.builtinResMgr;
    for (const [name, effectName, textured] of [
        ['missing-material', 'builtin-unlit', false],
        ['missing-effect-material', 'builtin-unlit', false],
        ['ui-graphics-material', 'builtin-graphics', false],
        ['ui-base-material', 'builtin-sprite', false],
        ['ui-sprite-material', 'builtin-sprite', true],
        ['default-clear-stencil', 'builtin-clear-stencil', false],
    ]) {
        const material = new cc.Material(name);
        material.initialize({ effectName, defines: { USE_TEXTURE: textured } });
        builtin.addAsset(name, material);
    }
});

await cc.game.init({
    debugMode: cc.DebugMode.WARN,
    overrideSettings: {
        screen: { frameRate: 60, exactFitScreen: true, designResolution: { width: 1280, height: 720, policy: 3 } },
        rendering: { renderMode: 0 },
        splashScreen: { displayRatio: 0, totalTime: 0 },
    },
});

const registration = cc.cclegacy._RF;
registration.push({}, scene[3].__type__, 'PocketDistrict');
const { PocketDistrict } = await import('./scripts/PocketDistrict.js');
registration.pop();

cc.resources.load = (path, kind, done) => {
    const resourcePath = './assets/resources/' + path;
    if (kind === cc.JsonAsset) {
        readJson(resourcePath + '.json').then(json => {
            const asset = new cc.JsonAsset();
            asset.json = json;
            done(null, asset);
        }, done);
    } else if (kind === cc.Texture2D) {
        cc.assetManager.loadRemote(url(resourcePath.replace(/\/texture$/, '.png')), (error, image) => {
            if (error) return done(error);
            const texture = new cc.Texture2D();
            texture.image = image;
            done(null, texture);
        });
    } else {
        const extension = path === 'audio/side-street' ? '.ogg' : '.wav';
        cc.assetManager.loadRemote(url(resourcePath + extension), done);
    }
};

const asset = cc.deserialize(scene);
const component = asset.scene.getChildByName('Pocket District')?.getComponent(PocketDistrict);
if (!component) throw new Error('Không mở được cảnh Pocket District.');
await cc.game.run();
cc.director.runSceneImmediate(asset.scene);
document.getElementById('status').hidden = true;
