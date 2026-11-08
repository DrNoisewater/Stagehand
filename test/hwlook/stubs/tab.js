export const songToneChoice = {}; export const saveToneChoice = () => {};
// the tab view isn't drawn here: every call on it does nothing
export function createTabView() { return new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => {}) }); }
