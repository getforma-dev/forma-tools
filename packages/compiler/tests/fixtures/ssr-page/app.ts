// Entry point fixture for the SSR IR pipeline test.
// Not imported by any test — generateRealIr() reads it off disk, exactly as
// the esbuild plugin does for a real page.
import { mount, activateIslands } from 'formajs';
import { DashboardPage } from './page';
import { StatusPanel } from './status-panel';

activateIslands({ StatusPanel });

mount(() => DashboardPage(), '#app');
