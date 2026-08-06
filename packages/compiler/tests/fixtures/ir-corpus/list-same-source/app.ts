// Corpus case: two createList() calls over the SAME source array.
// Both derive the base name `todos`, so the second must become `todos#2` —
// otherwise `list:todos:array`, `:item` and the per-property slots are all
// minted twice and the first list becomes unaddressable by name.
import { mount } from 'formajs';
import { ListPage } from './page';

mount(() => ListPage(), '#app');
