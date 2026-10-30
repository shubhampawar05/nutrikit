import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';

const received = vi.hoisted(() => [] as unknown[]);
vi.mock('@scalar/api-reference-react', () => ({
  ApiReferenceReact: (props: { configuration: unknown }) => {
    received.push(props.configuration);
    return <div data-testid="scalar" />;
  },
}));
vi.mock('@scalar/api-reference-react/style.css', () => ({}));

const { Reference } = await import('./Reference.tsx');

describe('Reference', () => {
  it('renders the heading and Scalar pointed at /openapi.json', () => {
    renderPage(<Reference />, { path: '/docs/reference' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('API reference');
    expect(screen.getByRole('link', { name: 'OpenAPI 3.1 spec' }).getAttribute('href')).toBe('/openapi.json');
    expect(screen.getByTestId('scalar')).toBeTruthy();
    expect(received.at(-1)).toMatchObject({ url: '/openapi.json' });
  });
});
