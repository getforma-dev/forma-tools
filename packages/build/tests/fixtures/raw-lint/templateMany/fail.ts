import { templateMany as many } from '@getforma/core';

export function rows(markup: string) {
  return many(markup); // expect: templateMany in rows
}
