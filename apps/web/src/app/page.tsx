import { redirect } from 'next/navigation';

/**
 * Root page — redirects authenticated users to dashboard,
 * unauthenticated users to login.
 * Actual auth check happens in middleware.
 */
export default function RootPage() {
  redirect('/dashboard');
}
