// Audio lifecycle regression; no speakers/network required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.EVENTPLAY_SOURCE || 'D:/Game Mới';
const ts = require(path.join(root, 'node_modules/typescript'));
const howls = [];
class FakeHowl {
  constructor(options) { this.options = options; this.events = {}; this.starts = 0; this.stops = 0; this.active = false; howls.push(this); }
  once(event, fn) { (this.events[event] ||= []).push(fn); }
  emit(event) { const listeners = this.events[event] || []; delete this.events[event]; listeners.forEach(fn => fn()); }
  play() { this.starts++; if (!this.blocked) { this.active = true; this.emit('play'); } return this.starts; }
  playing() { return this.active; }
  stop() { this.stops++; this.active = false; }
  volume(value) { this.level = value; }
  mute(value) { this.muted = value; }
  unload() { this.active = false; }
}
class FakeContext {
  state = 'running'; currentTime = 0;
  createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
  resume() { return Promise.resolve(); }
}
global.window = { AudioContext: FakeContext, setInterval: () => 1, clearInterval() {} };
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/engine/audio.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function('exports', 'require', compiled)(exported, name => {
  assert.equal(name, 'howler'); return { Howl: FakeHowl, Howler: { ctx: new FakeContext() } };
});
const { AudioEngine } = exported;
const music = { id: 'music', category: 'music', src: '/music.mp3', loop: true, volume: .7 };
const engine = new AudioEngine();
engine.play(music);
const first = howls.at(-1);
engine.play(music); engine.unlock(); engine.setVolumes({ music: .4 });
assert.equal(first.starts, 1, 'Same track stays on its original timeline across state changes/interactions');
engine.setVolumes({ muted: true }); engine.setVolumes({ muted: false });
assert.equal(first.starts, 1, 'Mute/unmute does not restart an active track');
assert.equal(first.stops, 0);
engine.play({ ...music, id: 'second', src: '/second.mp3' });
assert.equal(first.stops, 1, 'Changing tracks stops the previous music');
const second = howls.at(-1);
engine.stopMusic(); engine.unlock();
assert.equal(second.starts, 1, 'Exiting clears the request, so later gestures do not resurrect music');
const muted = new AudioEngine();
muted.setVolumes({ muted: true });
const prior = howls.length;
muted.play(music);
assert.equal(howls.length, prior);
muted.setVolumes({ muted: false });
assert.equal(howls.at(-1).starts, 1, 'A muted launch remembers and starts music after unmute');
const retry = new AudioEngine();
retry.play(music);
const blocked = howls.at(-1);
blocked.active = false; blocked.emit('playerror');
blocked.emit('unlock');
assert.equal(blocked.starts, 2, 'Autoplay failure retries when Howler unlocks');
retry.play(music); retry.unlock();
assert.equal(blocked.starts, 2, 'Successful retry never creates overlapping playback');
blocked.active = false; blocked.emit('playerror'); retry.stopMusic(); blocked.emit('unlock');
assert.equal(blocked.starts, 2, 'A delayed unlock cannot play music after exit');
console.log('PASS music continuity, mute/unmute, blocked autoplay retry, track change and exit cleanup');
