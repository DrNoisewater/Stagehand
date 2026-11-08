export const tonelib = { list: [] }; export function useTone(){}

// names the 4.2 app imports (the highway's tone menu); safe empty answers
export const SLOT_COUNT = 9;
export const SLOT_GELS = ['#33c8e0', '#ffb547', '#ff6b3d', '#ff4d8d', '#8c7bff', '#9bdb5a', '#b0b8d4', '#ff8a5c', '#5fd4c4'];
export const TYPE_GELS = { pre: '#ff4d8d', post: '#ff4d8d', amp: '#ff6b3d', cab: '#8c7bff', rack: '#33c8e0' };
export const TYPE_NAMES = { pre: 'Pedal', post: 'Pedal', amp: 'Amp', cab: 'Cabinet', rack: 'Rack' };
export const activeSlot = () => -1; export const assignSlot = () => {}; export const byId = () => null; export const bySlot = () => null;
export const chainText = () => ''; export const freeSlot = () => 0; export const gelOf = () => '#33c8e0'; export const kindLabel = () => '';
export const knobsOf = () => ({}); export const loadTones = async () => []; export const nowPlayingTone = () => null; export const orderedGear = () => [];
export const readingBar = () => ''; export const removeTone = () => {}; export const saveSongTone = () => {}; export const saveTone = () => {};
export const shortGearName = (x) => String(x || ''); export const songToneLibrary = async () => []; export const useSlot = () => {};
