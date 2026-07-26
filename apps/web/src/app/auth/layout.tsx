export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-up">{children}</div>
    </div>
  );
}
