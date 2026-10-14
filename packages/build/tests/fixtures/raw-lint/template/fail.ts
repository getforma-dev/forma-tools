import { template, trustedHtml } from '@getforma/core';
import * as core from '@getforma/core';

export const row = template('<tr><td></td></tr>'); // expect: template

export function cell(markup: string) {
  return core.template(markup); // expect: template in cell
}

export const vouched = template(trustedHtml('<tr></tr>')); // expect: trustedHtml
