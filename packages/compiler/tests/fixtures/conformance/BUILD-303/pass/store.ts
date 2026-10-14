import { createSignal } from '@getforma/core';

export const [rows, setRows] = createSignal([] as Array<{ id: number; n: string }>);
