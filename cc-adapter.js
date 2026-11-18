const impl = await System.import(new URL('./engine/cc.js', import.meta.url).href);
export const { _decorator, Asset, AudioClip, AudioSource, Camera, Canvas, Color, Component, DebugMode, Director, EffectAsset, EventKeyboard, EventTouch, Game, game, Graphics, HorizontalTextAlignment, Input, input, JsonAsset, KeyCode, Label, Layers, Material, Mesh, MeshRenderer, Node, primitives, ResolutionPolicy, resources, Texture2D, UITransform, utils, Vec2, Vec3, view } = impl;
export default impl;
