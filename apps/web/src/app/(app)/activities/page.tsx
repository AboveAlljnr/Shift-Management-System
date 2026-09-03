import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Activities' };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Activities</h1>
      <p className="text-muted-foreground mt-2">Activities content coming soon.</p>
    </div>
  );
}

