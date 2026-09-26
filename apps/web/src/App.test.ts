import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App, Preview } from './App';

it('renders an explicitly synthetic, read-only estate preview', () => {
  const html = renderToStaticMarkup(createElement(Preview));
  expect(html).toContain('Your asset estate');
  expect(html).toContain('Synthetic data only');
  expect(html).toContain('Changes cannot be saved yet');
  expect(html).toContain('qm.ejtbrown.com');
  expect(html).not.toContain('quartermaster.ejtbrown.com');
});

it('waits for session resolution before exposing an authenticated workspace', () => {
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain('Connecting');
  expect(html).toContain('Synthetic records only');
  expect(html).not.toContain('Add asset');
});
