// The review's b14 (FORMA-126 review, should-fix 5): core re-exported
// wholesale puts every raw sink behind the application's own module name.
export * from '@getforma/core'; // expect: core-reexport
export * as runtime from '@getforma/core/runtime'; // expect: core-reexport
