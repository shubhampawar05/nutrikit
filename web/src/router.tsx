// Every page keeps the URL it had on the vanilla site. Pages load on demand.
import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { NotFound } from './pages/NotFound.tsx';

export const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', lazy: async () => ({ Component: (await import('./pages/Home.tsx')).Home }) },
      { path: '/pricing', lazy: async () => ({ Component: (await import('./pages/Pricing.tsx')).Pricing }) },
      { path: '/docs', lazy: async () => ({ Component: (await import('./pages/Docs.tsx')).Docs }) },
      { path: '/docs/reference', lazy: async () => ({ Component: (await import('./pages/Reference.tsx')).Reference }) },
      { path: '/signup', lazy: async () => ({ Component: (await import('./pages/Auth.tsx')).Signup }) },
      { path: '/login', lazy: async () => ({ Component: (await import('./pages/Auth.tsx')).Login }) },
      { path: '/forgot-password', lazy: async () => ({ Component: (await import('./pages/Recovery.tsx')).ForgotPassword }) },
      { path: '/reset-password', lazy: async () => ({ Component: (await import('./pages/Recovery.tsx')).ResetPassword }) },
      { path: '/verify-email', lazy: async () => ({ Component: (await import('./pages/Recovery.tsx')).VerifyEmail }) },
      { path: '/dashboard', lazy: async () => ({ Component: (await import('./pages/Dashboard.tsx')).Dashboard }) },
      { path: '/playground', lazy: async () => ({ Component: (await import('./pages/Playground.tsx')).Playground }) },
      { path: '/admin', lazy: async () => ({ Component: (await import('./pages/Admin.tsx')).Admin }) },
      { path: '*', Component: NotFound },
    ],
  },
];

export const router = createBrowserRouter(routes);
