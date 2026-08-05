// Corpus case: ternary children compiled to SHOW_IF, with branches of
// DELIBERATELY UNEQUAL length in both directions (long-then/short-else and
// short-then/long-else). Symmetric branches hide a then_len/else_len swap:
// the two u32s are interchangeable when they are equal, so a reader and an
// emitter that disagree about their order still agree on the output.
import { mount } from 'formajs';
import { TernaryPage } from './page';

mount(() => TernaryPage(), '#app');
