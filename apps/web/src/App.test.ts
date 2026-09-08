import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders an explicitly synthetic, read-only estate preview', () => {
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain('Your asset estate');
  expect(html).toContain('Synthetic data only');
  expect(html).toContain('Changes cannot be saved yet');
  expect(html).toContain('qm.ejtbrown.com');
  expect(html).not.toContain('quartermaster.ejtbrown.com');
});
