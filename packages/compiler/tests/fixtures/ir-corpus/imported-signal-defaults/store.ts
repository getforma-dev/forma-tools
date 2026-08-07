// The store module. Neither signal is read in this file — their whole reason
// to exist is to be imported, which is precisely the shape that used to lose
// the default at the file boundary.
import { createSignal } from 'formajs';

export const [ownerInviteToken, setOwnerInviteToken] = createSignal('');
export const [status, setStatus] = createSignal('idle');
