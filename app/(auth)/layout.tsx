export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full grid place-items-center bg-background">
      <div className="w-full max-w-md px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-7 w-7 rounded-sm border border-border grid place-items-center mono text-[11px] tracking-wider">
            R/
          </div>
          <div>
            <div className="text-sm font-medium tracking-tight">ResearchOS</div>
            <div className="text-[11px] text-muted-foreground mono">long-horizon research</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
