// the drum machine isn't needed for the highway's look (the real one imports stage.js, which
// the harness loads in another order than the app, so it would start before the song player)
export const PATTERNS = [{ id: 'rock', name: 'Rock' }];
export const drums = Object.assign(new EventTarget(), { on: false, bpm: 100, start() {}, stop() {}, setBpm() {}, setPattern() {}, tap() {} });
