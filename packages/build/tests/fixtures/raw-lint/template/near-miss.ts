import template from 'lodash.template';
import { template as render } from './my-templates';

// template('<b>x</b>') in a comment.
export const greet = template('Hello <%= name %>');
export const page = render('<main></main>');
export const view = { template: '<p>a key named template</p>' };
export function compile(engine: { template(s: string): string }) {
  return engine.template('<p></p>');
}
