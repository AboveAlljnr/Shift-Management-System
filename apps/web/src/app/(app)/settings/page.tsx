import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground mt-2">Settings content coming soon.</p>
    </div>
  );
}

