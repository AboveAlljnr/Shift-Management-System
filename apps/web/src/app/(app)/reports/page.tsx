import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="text-muted-foreground mt-2">Reports content coming soon.</p>
    </div>
  );
}

