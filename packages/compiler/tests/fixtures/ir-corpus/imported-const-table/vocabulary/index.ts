// A barrel that renames on the way through: the island asks for `MODIFIERS`,
// the file declares `MOD_KEYS`. Looking up 'MODIFIERS' in modifiers.ts finds
// nothing at all — the alias has to be followed to the real declaration, in
// the module that actually holds the array.
export { MOD_KEYS as MODIFIERS } from './modifiers';
