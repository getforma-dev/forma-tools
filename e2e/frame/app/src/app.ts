// The application the preview-frame lane builds (e2e/frame/build.sh): one
// page whose bundle imports the @getforma/core installed from the packed
// tarball, as an application's does. With `previewFrame: true` the build
// copies the frame's runtime from that same core.
import { createSignal, h, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

mount(() => h('button', { onClick: () => setCount(count() + 1) }, () => `clicked ${count()}`), '#app');
