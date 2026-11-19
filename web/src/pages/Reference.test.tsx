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
  it('renders a heading and Scalar pointed at /openapi.json, themed by the site', () => {
    renderPage(<Reference />, { path: '/docs/reference' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('API reference');
    expect(screen.getByTestId('scalar')).toBeTruthy();
    expect(received.at(-1)).toMatchObject({ url: '/openapi.json', theme: 'none' });
  });
});
