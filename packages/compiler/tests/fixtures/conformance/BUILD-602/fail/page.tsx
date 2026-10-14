import { h } from '@getforma/core'; // expect: BUILD-602

function makePage() { return () => <main>page</main>; }
export const HomePage = makePage();
