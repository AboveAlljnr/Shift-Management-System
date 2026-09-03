import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Documents' };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Documents</h1>
      <p className="text-muted-foreground mt-2">Documents content coming soon.</p>
    </div>
  );
}

