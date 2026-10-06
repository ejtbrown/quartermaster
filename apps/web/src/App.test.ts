import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App } from './App';

it('does not ship sample assets or a disabled preview', () => {
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain('A clearer picture');
  expect(html).not.toContain('Synthetic');
  expect(html).not.toContain('sample register');
});

it('waits for session resolution before exposing an authenticated workspace', () => {
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain('Connecting');
  expect(html).toContain('Privacy and data retention');
  expect(html).not.toContain('Add asset');
});
