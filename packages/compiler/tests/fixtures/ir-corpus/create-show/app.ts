// Corpus case: createShow() -> SHOW_IF. Includes a show with no else branch
// (zero-length else region) and two shows over the SAME condition, which is
// where the show-name registry has to mint `show:visible` then
// `show:visible#2` rather than the same name twice.
import { mount } from 'formajs';
import { ShowPage } from './page';

mount(() => ShowPage(), '#app');
